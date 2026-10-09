from __future__ import annotations

import json
import sys
import tempfile
import threading
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import IO, Any, Protocol

from pydantic import BaseModel, ConfigDict

from .config import BridgeSettings
from .models import InboundEvent, OutboxTask, SendAck
from .spool import BridgeSpool
from .transport import SendStatus, WechatTransport


class BridgeApi(Protocol):
    def heartbeat(self, payload: Mapping[str, object]) -> dict[str, Any]: ...

    def upload_messages(self, events: Sequence[InboundEvent]) -> list[dict[str, Any]]: ...

    def claim_outbox(self, *, limit: int) -> list[OutboxTask]: ...

    def ack_outbox(self, message_id: object, ack: SendAck) -> None: ...


class DoctorReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    passed: bool
    checked_at: datetime
    errors: list[str]
    observed_group_count: int


class StructuredLogger:
    """JSON-lines logger that accepts codes and counters, never exception messages."""

    def __init__(self, *, stream: IO[str] | None = None) -> None:
        self._stream = stream or sys.stderr
        self._lock = threading.Lock()

    def emit(self, event: str, **fields: object) -> None:
        safe: dict[str, object] = {"event": event, "at": datetime.now(UTC).isoformat()}
        for key, value in fields.items():
            if key in {"token", "text", "message", "path", "exception", "body"}:
                continue
            if isinstance(value, (str, int, float, bool)) or value is None:
                safe[key] = value
        with self._lock:
            self._stream.write(json.dumps(safe, ensure_ascii=False, separators=(",", ":")) + "\n")
            self._stream.flush()


class BridgeRuntime:
    DOCTOR_MAX_AGE = timedelta(minutes=10)

    def __init__(
        self,
        *,
        settings: BridgeSettings,
        spool: BridgeSpool,
        api: BridgeApi,
        transport: WechatTransport,
        enable_send: bool = False,
        logger: StructuredLogger | None = None,
    ) -> None:
        self.settings = settings
        self.spool = spool
        self.api = api
        self.transport = transport
        self.enable_send = enable_send
        self.logger = logger or StructuredLogger()
        self._stop = threading.Event()
        self._send_blocked = threading.Event()
        self._doctor_passed_at: datetime | None = None
        self._doctor_path = settings.state_dir / "doctor.json"

    def doctor(self) -> DoctorReport:
        errors: list[str] = []
        health = self.transport.health()
        if not health.ready:
            errors.append(health.error_code or "TRANSPORT_UNHEALTHY")
        try:
            self.settings.state_dir.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=self.settings.state_dir, prefix="doctor-", delete=True):
                pass
        except OSError:
            errors.append("STATE_DIRECTORY_NOT_WRITABLE")

        groups = self.transport.observed_groups() if health.database_available else []
        if not errors:
            try:
                response = self.api.heartbeat(self._heartbeat_payload(health, groups))
                self._apply_authorized_groups(response)
            except Exception as error:
                errors.append(self._error_code(error, "BRIDGE_API_UNAVAILABLE"))

        checked_at = datetime.now(UTC)
        report = DoctorReport(
            passed=not errors,
            checked_at=checked_at,
            errors=errors,
            observed_group_count=len(groups),
        )
        if report.passed:
            self._doctor_passed_at = checked_at
            self._write_doctor_record(report)
        else:
            self._send_blocked.set()
        return report

    def heartbeat_once(self) -> bool:
        health = self.transport.health()
        groups = self.transport.observed_groups() if health.database_available else []
        try:
            response = self.api.heartbeat(self._heartbeat_payload(health, groups))
            self._apply_authorized_groups(response)
            retention_cutoff = datetime.now(UTC) - timedelta(days=7)
            self.spool.purge_acknowledged(before=retention_cutoff)
            self.spool.purge_completed(before=retention_cutoff)
            if health.ready:
                self._doctor_passed_at = datetime.now(UTC)
            return True
        except Exception as error:
            self.logger.emit("heartbeat_failed", code=self._error_code(error, "BRIDGE_API_UNAVAILABLE"))
            return False

    def receive_upload_once(self) -> int:
        try:
            cursor_payload = json.dumps(self.spool.scan_cursors(), separators=(",", ":"))
            events = self.transport.poll(cursor_payload)
            for event in events:
                self.spool.append_inbound(event, sort_key=event.sequence or event.message_id)
            pending = self.spool.pending_inbound(limit=self.settings.inbound_batch_size)
            if not pending:
                self._persist_scan_cursors()
                return 0
            results = self.api.upload_messages(pending)
            by_id = {
                str(item.get("messageId")): item
                for item in results
                if isinstance(item, dict) and item.get("status") in {"ACCEPTED", "DUPLICATE", "IGNORED"}
            }
            if any(event.message_id not in by_id for event in pending):
                self.logger.emit("inbound_upload_incomplete", count=len(pending))
                return 0
            watermark = max((event.sequence or event.message_id) for event in pending)
            self.spool.ack_inbound([event.message_id for event in pending], watermark=watermark)
            self._persist_scan_cursors()
            return len(pending)
        except Exception as error:
            self.logger.emit("inbound_cycle_failed", code=self._error_code(error, "INBOUND_CYCLE_FAILED"))
            return 0

    def send_once(self) -> int:
        if not self._send_gate_open():
            return 0
        health = self.transport.health()
        if not health.ready or health.screen_locked or not health.sender_available:
            return 0
        try:
            tasks = self.api.claim_outbox(limit=self.settings.outbox_claim_limit)
        except Exception as error:
            self.logger.emit("outbox_claim_failed", code=self._error_code(error, "OUTBOX_CLAIM_FAILED"))
            return 0

        processed = 0
        for task in tasks:
            existing = self.spool.outbox_record(task.id)
            if existing and existing.readback_message_id:
                ack = SendAck(status="SENT", readback_message_id=existing.readback_message_id)
                self.api.ack_outbox(task.id, ack)
                processed += 1
                continue
            if existing and existing.status in {"IN_FLIGHT", "AMBIGUOUS"}:
                if existing.status == "IN_FLIGHT":
                    self.spool.mark_outbox_ambiguous(task.id, "PROCESS_RESTART_DURING_SEND")
                ack = SendAck(
                    status="AMBIGUOUS",
                    error_code=existing.last_error_code or "PROCESS_RESTART_DURING_SEND",
                    error_message="send outcome requires operator reconciliation",
                )
                self.api.ack_outbox(task.id, ack)
                self._send_blocked.set()
                processed += 1
                break

            self.spool.remember_outbox(task)
            self.spool.mark_outbox_in_flight(task.id)
            result = self.transport.send(task)
            if result.status is SendStatus.SENT:
                ack = SendAck(status="SENT", readback_message_id=result.readback_message_id)
                self.spool.complete_outbox(task.id, ack)
                self.api.ack_outbox(task.id, ack)
            elif result.status is SendStatus.AMBIGUOUS:
                code = result.error_code or "WECHAT_SEND_UNCONFIRMED"
                self.spool.mark_outbox_ambiguous(task.id, code)
                ack = SendAck(
                    status="AMBIGUOUS",
                    error_code=code,
                    error_message="send outcome requires operator reconciliation",
                )
                self.api.ack_outbox(task.id, ack)
                self._send_blocked.set()
            else:
                code = result.error_code or "WECHAT_SEND_FAILED"
                ack = SendAck(status="FAILED", error_code=code, error_message="send failed before confirmation")
                self.spool.retry_outbox(task.id, code)
                self.api.ack_outbox(task.id, ack)
            processed += 1
            if result.status is SendStatus.AMBIGUOUS:
                break
        return processed

    def _persist_scan_cursors(self) -> None:
        getter = getattr(self.transport, "scanned_cursors", None)
        if callable(getter):
            self.spool.update_scan_cursors(getter())

    def run_forever(self) -> None:
        workers = [
            threading.Thread(
                target=self._supervise,
                args=("receive", self.receive_upload_once, self.settings.poll_interval_seconds),
                daemon=True,
            ),
            threading.Thread(
                target=self._supervise,
                args=("heartbeat", self.heartbeat_once, self.settings.heartbeat_interval_seconds),
                daemon=True,
            ),
            threading.Thread(
                target=self._supervise,
                args=("send", self.send_once, self.settings.poll_interval_seconds),
                daemon=True,
            ),
        ]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join()

    def request_stop(self) -> None:
        self._stop.set()

    def _supervise(self, name: str, operation: object, interval: float) -> None:
        while not self._stop.is_set():
            try:
                operation()  # type: ignore[operator]
            except Exception as error:
                self._send_blocked.set()
                self.logger.emit("runtime_loop_crashed", loop=name, code=self._error_code(error, "LOOP_CRASHED"))
                self._stop.set()
                return
            self._stop.wait(interval)

    def _send_gate_open(self) -> bool:
        if not self.enable_send or not self.settings.send_enabled or self._send_blocked.is_set():
            return False
        checked_at = self._doctor_passed_at or self._load_doctor_record()
        return checked_at is not None and datetime.now(UTC) - checked_at <= self.DOCTOR_MAX_AGE

    def _heartbeat_payload(self, health: object, groups: Sequence[object]) -> dict[str, object]:
        snapshot = self.spool.health_snapshot()
        return {
            "wechatVersion": getattr(health, "wechat_version", None) or self.settings.expected_wechat_version,
            "loginStatus": getattr(health, "login_status", "UNKNOWN"),
            **({"listenerWatermark": snapshot.watermark} if snapshot.watermark else {}),
            "screenLocked": bool(getattr(health, "screen_locked", True)),
            "outboundQueueDepth": snapshot.pending_outbox + snapshot.ambiguous_outbox,
            "observedGroups": [
                {"wechatGroupId": group.wechat_group_id, "displayName": group.display_name}
                for group in groups
            ],
        }

    def _apply_authorized_groups(self, response: Mapping[str, object]) -> None:
        raw = response.get("enabledGroups")
        if not isinstance(raw, list):
            raise ValueError("HEARTBEAT_RESPONSE_MISSING_GROUPS")
        groups: dict[str, str] = {}
        for item in raw:
            if not isinstance(item, dict):
                raise ValueError("HEARTBEAT_RESPONSE_INVALID_GROUP")
            group_id, display_name = item.get("wechatGroupId"), item.get("displayName")
            if not isinstance(group_id, str) or not group_id or not isinstance(display_name, str) or not display_name:
                raise ValueError("HEARTBEAT_RESPONSE_INVALID_GROUP")
            groups[group_id] = display_name
        configure = getattr(self.transport, "configure_authorized_groups", None)
        if not callable(configure):
            raise ValueError("TRANSPORT_CONFIGURATION_UNSUPPORTED")
        configure(groups)

    def _write_doctor_record(self, report: DoctorReport) -> None:
        payload = {
            "passed": report.passed,
            "checkedAt": report.checked_at.isoformat(),
            "deviceId": str(self.settings.device_id),
            "expectedWechatVersion": self.settings.expected_wechat_version,
        }
        self._doctor_path.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")

    def _load_doctor_record(self) -> datetime | None:
        try:
            payload = json.loads(self._doctor_path.read_text(encoding="utf-8"))
            if payload.get("passed") is not True or payload.get("deviceId") != str(self.settings.device_id):
                return None
            if payload.get("expectedWechatVersion") != self.settings.expected_wechat_version:
                return None
            checked_at = datetime.fromisoformat(str(payload["checkedAt"]))
            return checked_at.astimezone(UTC) if checked_at.tzinfo else None
        except (OSError, ValueError, TypeError, KeyError, json.JSONDecodeError):
            return None

    @staticmethod
    def _error_code(error: Exception, fallback: str) -> str:
        code = getattr(error, "code", None)
        if isinstance(code, str) and 1 <= len(code) <= 64:
            return code
        if isinstance(error, ValueError) and error.args and isinstance(error.args[0], str):
            candidate = error.args[0]
            if candidate.isupper() and 1 <= len(candidate) <= 64:
                return candidate
        return fallback
