from __future__ import annotations

import hashlib
import hmac
import time
from collections.abc import Callable, Mapping, Sequence
from datetime import UTC, datetime
from random import random
from typing import Any
from uuid import UUID, uuid4

import httpx
from pydantic import ValidationError

from .config import BridgeSettings
from .models import InboundEvent, OutboxTask, SendAck

MAX_ATTEMPTS = 3


class BridgeApiError(RuntimeError):
    def __init__(self, code: str, *, terminal: bool) -> None:
        super().__init__(code)
        self.code = code
        self.terminal = terminal


class EfmBridgeClient:
    """Small signed HTTP client that never includes secrets or response bodies in errors."""

    def __init__(
        self,
        settings: BridgeSettings,
        *,
        transport: httpx.BaseTransport | None = None,
        now: Callable[[], datetime] | None = None,
        nonce_factory: Callable[[], str] | None = None,
        sleep: Callable[[float], None] | None = None,
        jitter: Callable[[], float] | None = None,
    ) -> None:
        self._settings = settings
        self._token = settings.bridge_token.get_secret_value()
        self._now = now or (lambda: datetime.now(UTC))
        self._nonce_factory = nonce_factory or (lambda: str(uuid4()))
        self._sleep = sleep or time.sleep
        self._jitter = jitter or random
        self._client = httpx.Client(
            base_url=str(settings.api_url).rstrip("/"),
            timeout=httpx.Timeout(settings.request_timeout_seconds),
            verify=True,
            transport=transport,
            headers={"Accept": "application/json", "Content-Type": "application/json"},
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> "EfmBridgeClient":
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def heartbeat(self, payload: Mapping[str, object]) -> dict[str, Any]:
        return self._post("/v1/wechat-bot/bridge/heartbeat", dict(payload))

    def upload_messages(self, events: Sequence[InboundEvent]) -> list[dict[str, Any]]:
        payload = {
            "messages": [
                {
                    "messageId": event.message_id,
                    "conversationType": event.conversation_type,
                    "conversationId": event.conversation_id,
                    "senderId": event.sender_id,
                    "sentAt": event.sent_at.isoformat(),
                    "messageType": event.message_type,
                    "text": event.text,
                    **({"sequence": event.sequence} if event.sequence is not None else {}),
                }
                for event in events
            ]
        }
        response = self._post("/v1/wechat-bot/bridge/messages", payload)
        results = response.get("results")
        if not isinstance(results, list) or not all(isinstance(item, dict) for item in results):
            raise BridgeApiError("BRIDGE_API_INVALID_RESPONSE", terminal=False)
        return results

    def claim_outbox(self, *, limit: int) -> list[OutboxTask]:
        if not 1 <= limit <= 50:
            raise ValueError("limit must be between 1 and 50")
        response = self._post("/v1/wechat-bot/bridge/outbox/claim", {"limit": limit})
        messages = response.get("messages")
        if not isinstance(messages, list):
            raise BridgeApiError("BRIDGE_API_INVALID_RESPONSE", terminal=False)
        try:
            return [self._outbox_task(message) for message in messages]
        except (KeyError, TypeError, ValidationError) as error:
            raise BridgeApiError("BRIDGE_API_INVALID_RESPONSE", terminal=False) from error

    def ack_outbox(self, message_id: UUID | str, ack: SendAck) -> None:
        payload: dict[str, object] = {"status": ack.status}
        if ack.status == "SENT":
            payload["readbackMessageId"] = ack.readback_message_id
        else:
            payload["errorCode"] = ack.error_code
            payload["errorMessage"] = ack.error_message
        self._post(f"/v1/wechat-bot/bridge/outbox/{message_id}/ack", payload)

    def _post(self, path: str, payload: Mapping[str, object]) -> dict[str, Any]:
        last_code = "BRIDGE_API_UNAVAILABLE"
        for attempt in range(MAX_ATTEMPTS):
            headers = self._signed_headers(path)
            try:
                response = self._client.post(path, headers=headers, json=dict(payload))
            except httpx.TimeoutException as error:
                last_code = "BRIDGE_API_TIMEOUT"
                if attempt + 1 == MAX_ATTEMPTS:
                    raise BridgeApiError(last_code, terminal=False) from error
                self._backoff(attempt)
                continue
            except httpx.RequestError as error:
                last_code = "BRIDGE_API_UNAVAILABLE"
                if attempt + 1 == MAX_ATTEMPTS:
                    raise BridgeApiError(last_code, terminal=False) from error
                self._backoff(attempt)
                continue

            if response.is_success:
                try:
                    parsed = response.json()
                except ValueError as error:
                    raise BridgeApiError("BRIDGE_API_INVALID_RESPONSE", terminal=False) from error
                if not isinstance(parsed, dict):
                    raise BridgeApiError("BRIDGE_API_INVALID_RESPONSE", terminal=False)
                return parsed

            code = self._safe_error_code(response)
            if response.status_code in {401, 403}:
                raise BridgeApiError(code, terminal=True)
            retriable = (
                response.status_code == 429
                or response.status_code >= 500
                or (response.status_code == 409 and code == "BRIDGE_REQUEST_REPLAYED")
            )
            if not retriable or attempt + 1 == MAX_ATTEMPTS:
                raise BridgeApiError(code, terminal=False)
            last_code = code
            self._backoff(attempt)
        raise BridgeApiError(last_code, terminal=False)

    def _signed_headers(self, path: str) -> dict[str, str]:
        timestamp_value = self._now().astimezone(UTC).isoformat().replace("+00:00", "Z")
        nonce = self._nonce_factory()
        canonical = f"POST\n{path}\n{timestamp_value}\n{nonce}"
        signature = hmac.new(
            self._token.encode("utf-8"),
            canonical.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return {
            "Authorization": f"Bridge {self._token}",
            "X-Bridge-Device": str(self._settings.device_id),
            "X-Bridge-Timestamp": timestamp_value,
            "X-Bridge-Nonce": nonce,
            "X-Bridge-Signature": signature,
        }

    def _backoff(self, attempt: int) -> None:
        self._sleep(min(5.0, 0.5 * (2**attempt)) + min(0.25, max(0.0, self._jitter() * 0.25)))

    @staticmethod
    def _safe_error_code(response: httpx.Response) -> str:
        fallback = f"BRIDGE_API_HTTP_{response.status_code}"
        try:
            payload = response.json()
        except ValueError:
            return fallback
        if not isinstance(payload, dict):
            return fallback
        error = payload.get("error")
        if not isinstance(error, dict):
            return fallback
        code = error.get("code")
        return code if isinstance(code, str) and 1 <= len(code) <= 64 else fallback

    @staticmethod
    def _outbox_task(payload: object) -> OutboxTask:
        if not isinstance(payload, dict):
            raise TypeError("outbox message must be an object")
        return OutboxTask.model_validate({
            "id": payload["id"],
            "target_type": payload["targetType"],
            "target_id": payload["targetId"],
            "text": payload["text"],
            "priority": payload["priority"],
            "scheduled_at": payload["scheduledAt"],
        })
