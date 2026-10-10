from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

import httpx
import pytest

from efm_wechat_bridge.api_client import BridgeApiError, EfmBridgeClient
from efm_wechat_bridge.config import BridgeSettings
from efm_wechat_bridge.models import InboundEvent, SendAck

DEVICE_ID = UUID("11111111-1111-4111-8111-111111111111")
TOKEN = "test-bridge-token-" + "x" * 32


def settings(tmp_path: Path) -> BridgeSettings:
    return BridgeSettings.model_validate({
        "environment": "test",
        "api_url": "https://league.example.com",
        "device_id": DEVICE_ID,
        "state_dir": tmp_path,
        "EFM_WECHAT_BRIDGE_TOKEN": TOKEN,
    })


def test_signs_every_request_with_exact_headers_and_unique_nonce(tmp_path: Path) -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"acceptedAt": "2026-10-09T12:00:00.000Z"})

    client = EfmBridgeClient(
        settings(tmp_path),
        transport=httpx.MockTransport(handler),
        now=lambda: datetime(2026, 10, 9, 12, 0, tzinfo=UTC),
        nonce_factory=iter(["nonce-1", "nonce-2"]).__next__,
    )
    heartbeat = {
        "wechatVersion": "4.1.15.13",
        "loginStatus": "LOGGED_IN",
        "screenLocked": False,
        "outboundQueueDepth": 0,
        "observedGroups": [],
    }
    client.heartbeat(heartbeat)
    client.heartbeat(heartbeat)

    assert [request.headers["x-bridge-nonce"] for request in requests] == ["nonce-1", "nonce-2"]
    assert requests[0].headers["authorization"] == f"Bridge {TOKEN}"
    assert requests[0].headers["x-bridge-device"] == str(DEVICE_ID)
    assert requests[0].headers["x-bridge-timestamp"] == "2026-10-09T12:00:00Z"
    assert requests[0].headers["x-bridge-signature"] == "8d04bd89982de907523b18d13d34682241dd2d314e7e5fa9c8d30b99e92f47a4"


def test_retries_replayed_nonce_with_a_fresh_signature(tmp_path: Path) -> None:
    nonces: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        nonces.append(request.headers["x-bridge-nonce"])
        if len(nonces) == 1:
            return httpx.Response(409, json={"error": {"code": "BRIDGE_REQUEST_REPLAYED"}})
        return httpx.Response(200, json={"messages": []})

    client = EfmBridgeClient(
        settings(tmp_path),
        transport=httpx.MockTransport(handler),
        nonce_factory=iter(["replayed", "fresh"]).__next__,
        sleep=lambda _: None,
    )
    assert client.claim_outbox(limit=20) == []
    assert nonces == ["replayed", "fresh"]


def test_retries_rate_limits_and_server_errors_with_bounded_backoff(tmp_path: Path) -> None:
    statuses = iter([429, 503, 200])
    delays: list[float] = []

    def handler(_: httpx.Request) -> httpx.Response:
        status = next(statuses)
        return httpx.Response(status, json={"messages": []} if status == 200 else {"error": {"code": "BUSY"}})

    client = EfmBridgeClient(
        settings(tmp_path),
        transport=httpx.MockTransport(handler),
        sleep=delays.append,
        jitter=lambda: 0,
    )
    assert client.claim_outbox(limit=20) == []
    assert delays == [0.5, 1.0]


def test_treats_authentication_as_terminal_without_leaking_token(tmp_path: Path) -> None:
    attempts = 0

    def handler(_: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return httpx.Response(401, json={"error": {"code": "BRIDGE_UNAUTHORIZED", "message": TOKEN}})

    client = EfmBridgeClient(settings(tmp_path), transport=httpx.MockTransport(handler))
    with pytest.raises(BridgeApiError) as caught:
        client.claim_outbox(limit=20)
    assert caught.value.terminal is True
    assert caught.value.code == "BRIDGE_UNAUTHORIZED"
    assert TOKEN not in str(caught.value)
    assert attempts == 1


def test_reports_timeout_and_invalid_json_without_sensitive_response_content(tmp_path: Path) -> None:
    timeout_client = EfmBridgeClient(
        settings(tmp_path),
        transport=httpx.MockTransport(lambda request: (_ for _ in ()).throw(httpx.ReadTimeout("slow", request=request))),
        sleep=lambda _: None,
    )
    with pytest.raises(BridgeApiError, match="BRIDGE_API_TIMEOUT") as timeout:
        timeout_client.claim_outbox(limit=20)
    assert timeout.value.terminal is False

    invalid_client = EfmBridgeClient(
        settings(tmp_path),
        transport=httpx.MockTransport(lambda _: httpx.Response(200, text=f"bad-json-{TOKEN}")),
    )
    with pytest.raises(BridgeApiError, match="BRIDGE_API_INVALID_RESPONSE") as invalid:
        invalid_client.claim_outbox(limit=20)
    assert TOKEN not in str(invalid.value)


def test_uploads_contract_messages_and_acknowledges_outbox(tmp_path: Path) -> None:
    paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        if request.url.path.endswith("/messages"):
            return httpx.Response(200, json={"results": [{
                "messageId": "message-1", "status": "ACCEPTED", "inboundId": str(DEVICE_ID), "resultCode": None
            }]})
        return httpx.Response(200, json={"ok": True})

    client = EfmBridgeClient(settings(tmp_path), transport=httpx.MockTransport(handler))
    result = client.upload_messages([InboundEvent(
        message_id="message-1",
        conversation_type="GROUP",
        conversation_id="room@chatroom",
        sender_id="member-wxid",
        sent_at=datetime.now(UTC),
        text="查询赛程",
    )])
    client.ack_outbox(DEVICE_ID, SendAck(status="SENT", readback_message_id="wechat-id"))
    assert result[0]["status"] == "ACCEPTED"
    assert paths == [
        "/v1/wechat-bot/bridge/messages",
        f"/v1/wechat-bot/bridge/outbox/{DEVICE_ID}/ack",
    ]
