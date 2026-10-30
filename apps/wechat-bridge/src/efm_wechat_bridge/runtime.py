from __future__ import annotations

import json
import re
import logging
from logging.handlers import RotatingFileHandler
import sys
import tempfile
import threading
import time
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

    def __init__(self, *, stream: IO[str] | None = None, log_dir: Path | None = None) -> None:
        self._stream = stream or sys.stderr
        self._lock = threading.Lock()
        self._file = None
        if log_dir is not None:
            log_dir.mkdir(parents=True, exist_ok=True)
            self._file = RotatingFileHandler(log_dir / "bridge.jsonl", maxBytes=5_000_000, backupCount=5, encoding="utf-8")
            self._file.setFormatter(logging.Formatter("%(message)s"))

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
            if self._file:
                self._file.emit(logging.LogRecord("bridge", logging.INFO, "", 0, json.dumps(safe, ensure_ascii=False, separators=(",", ":")), (), None))


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
        self._confirmed_account_id: str | None = None
        self._member_retry_at = 0.0
        self._member_failures = 0
        self._authorized_member_groups: frozenset[str] | None = None
        self._doctor_path = settings.state_dir / "doctor.json"
        self._receiver_status: dict[str, object] = {"status": "STARTING", "errorCode": None, "lastSuccessAt": None}
        self._receiver_retry_at = 0.0
        self._receiver_recovery_lock = threading.Lock()
        self._group_error: str | None = None
        self._receiver_failures = 0

    def _receiver_failed(self, code: str, error: Exception | None = None, error_type: str | None = None) -> None:
        previous = self._receiver_status
        self._receiver_status = {**previous, "status": "RECOVERING", "errorCode": code}
        if previous.get("errorCode") != code:
            self.logger.emit("receiver_unhealthy", code=code, error_type=type(error.__cause__ or error).__name__ if error else error_type)

    def _recover_receiver(self) -> None:
        if not self._receiver_recovery_lock.acquire(blocking=False):
            return
        try:
            self._recover_receiver_locked()
        finally:
            self._receiver_recovery_lock.release()

    def _recover_receiver_locked(self) -> None:
        now = time.monotonic()
        if now < self._receiver_retry_at:
            return
        self._receiver_failures += 1
        delay = min(60, 5 * 2 ** min(self._receiver_failures - 1, 4))
        self._receiver_retry_at = now + delay
        self.logger.emit("receiver_recovery_started", attempt=self._receiver_failures, retry_seconds=delay)
        try:
            getattr(self.transport, "recover")()
            self.logger.emit("receiver_reopened", attempt=self._receiver_failures)
        except Exception as error:
            self.logger.emit("receiver_recovery_failed", code=self._error_code(error, "WECHAT_RECOVERY_FAILED"), error_type=type(error).__name__)

    def _receiver_succeeded(self) -> None:
        if self._group_error:
            self._receiver_status = {**self._receiver_status, "lastSuccessAt": datetime.now(UTC).isoformat().replace("+00:00", "Z")}
            return
        if self._receiver_status["status"] == "RECOVERING":
            self.logger.emit("receiver_recovered", attempts=self._receiver_failures)
        self._receiver_status = {"status": "HEALTHY", "errorCode": None, "lastSuccessAt": datetime.now(UTC).isoformat().replace("+00:00", "Z")}
        self._receiver_failures = 0
        self._receiver_retry_at = 0.0

    def doctor(self) -> DoctorReport:
        errors: list[str] = []
        health = self.transport.health()
        if not health.wechat_account_id:
            errors.append("WECHAT_ACCOUNT_UNAVAILABLE")
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
                self._confirmed_account_id = health.wechat_account_id
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
        try:
            health = self.transport.health()
            complete = False
            groups = []
            if health.database_available:
                try:
                    groups = self.transport.observed_groups()
                    complete = True
                    self._group_error = None
                except Exception as error:
                    self._group_error = "WECHAT_GROUP_READ_FAILED"
                    self._receiver_failed("WECHAT_GROUP_READ_FAILED", error)
                    self._recover_receiver()
            else:
                self._receiver_failed(health.error_code or "WECHAT_DATABASE_UNAVAILABLE", error_type=health.error_type)
            payload = self._heartbeat_payload(health, groups)
            payload["observedGroupsComplete"] = complete and health.login_status == "LOGGED_IN"
            response = self.api.heartbeat(payload)
            self._apply_authorized_groups(response)
            self._confirmed_account_id = health.wechat_account_id
            self.logger.emit("heartbeat_ok", receiver_status=self._receiver_status["status"], login_status=health.login_status)
            retention_cutoff = datetime.now(UTC) - timedelta(days=7)
            self.spool.purge_acknowledged(before=retention_cutoff)
            self.spool.purge_completed(before=retention_cutoff)
            if health.ready:
                self._doctor_passed_at = datetime.now(UTC)
            return True
        except Exception as error:
            self._confirmed_account_id = None
            self.logger.emit("heartbeat_failed", code=self._error_code(error, "BRIDGE_API_UNAVAILABLE"))
            return False

    def receive_upload_once(self) -> int:
        try:
            health = self.transport.health()
        except Exception as error:
            self._receiver_failed("WECHAT_HEALTH_CHECK_FAILED", error)
            self._recover_receiver()
            return 0
        if not health.database_available or not health.wechat_account_id:
            self._receiver_failed(health.error_code or "WECHAT_DATABASE_UNAVAILABLE", error_type=health.error_type)
            self._recover_receiver()
            return 0
        if self._confirmed_account_id != health.wechat_account_id:
            if not self.heartbeat_once() or self._confirmed_account_id != health.wechat_account_id:
                return 0
        try:
            cursor_payload = json.dumps(self.spool.scan_cursors(), separators=(",", ":"))
            try:
                events = self.transport.poll(cursor_payload)
            except Exception as error:
                self._receiver_failed(self._error_code(error, "WECHAT_POLL_FAILED"), error)
                self._recover_receiver()
                return 0
            members = getattr(self.transport, "observed_members", lambda: [])()
            self.spool.upsert_observed_members(members)
            if members:
                self.transport.ack_observed_members(members)
            for event in events:
                self.spool.append_inbound(event, sort_key=event.sequence or event.message_id)
            pending = self.spool.pending_inbound(limit=self.settings.inbound_batch_size)
            if not pending:
                self._persist_scan_cursors()
                self._receiver_succeeded()
                return 0
            results = self.api.upload_messages(pending)
            by_id = {
                str(item.get("messageId")): item
                for item in results
                if isinstance(item, dict) and item.get("status") in {"ACCEPTED", "DUPLICATE", "IGNORED"}
            }
            if any(event.message_id not in by_id for event in pending):
                self._receiver_failed("INBOUND_UPLOAD_INCOMPLETE")
                self.logger.emit("inbound_upload_incomplete", count=len(pending))
                return 0
            watermark = max((event.sequence or event.message_id) for event in pending)
            self.spool.ack_inbound([event.message_id for event in pending], watermark=watermark)
            self._persist_scan_cursors()
            self._receiver_succeeded()
            self.logger.emit("inbound_uploaded", count=len(pending))
            return len(pending)
        except Exception as error:
            self._receiver_failed(self._error_code(error, "INBOUND_CYCLE_FAILED"), error)
            self.logger.emit("inbound_cycle_failed", code=self._error_code(error, "INBOUND_CYCLE_FAILED"))
            return 0

    def send_once(self) -> int:
        if not self._send_gate_open():
            return 0
        try:
            health = self.transport.health()
        except Exception as error:
            self.logger.emit("send_health_failed", code=self._error_code(error, "WECHAT_HEALTH_CHECK_FAILED"), error_type=type(error).__name__)
            return 0
        if not health.ready or health.screen_locked or not health.sender_available or not health.wechat_account_id or health.wechat_account_id != self._confirmed_account_id:
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
            send_started = time.monotonic()
            try:
                result = self.transport.send(task)
                self.logger.emit("send_result", task_id=str(task.id), status=result.status.value,
                                 code=result.error_code, duration_ms=round((time.monotonic() - send_started) * 1000))
            except Exception:
                code = "WECHAT_SEND_EXCEPTION"
                self.spool.mark_outbox_ambiguous(task.id, code)
                ack = SendAck(
                    status="AMBIGUOUS",
                    error_code=code,
                    error_message="send outcome requires operator reconciliation",
                )
                self.api.ack_outbox(task.id, ack)
                self._send_blocked.set()
                processed += 1
                break
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

    def upload_members_once(self) -> int:
        if time.monotonic() < self._member_retry_at or self._authorized_member_groups is None:
            return 0
        try:
            health = self.transport.health()
        except Exception as error:
            self.logger.emit("members_health_failed", code=self._error_code(error, "WECHAT_HEALTH_CHECK_FAILED"), error_type=type(error).__name__)
            return 0
        if not health.wechat_account_id or health.wechat_account_id != self._confirmed_account_id:
            return 0
        pending = self.spool.pending_observed_members()
        unauthorized = [m for m in pending if m.wechat_group_id not in self._authorized_member_groups]
        self.spool.ack_observed_members(unauthorized)
        items = [m for m in pending if m.wechat_group_id in self._authorized_member_groups]
        if not items:
            return 0
        try:
            self.api.upload_observed_members(items)
            self.spool.ack_observed_members(items)
            self._member_failures = 0
            self.logger.emit("members_uploaded", count=len(items), pending=self.spool.member_queue_depth())
            return len(items)
        except Exception as error:
            self._member_failures = min(6, self._member_failures + 1)
            self._member_retry_at = time.monotonic() + min(60, 2 ** self._member_failures)
            self.logger.emit("members_upload_failed", code=self._error_code(error, "MEMBERS_UPLOAD_FAILED"), pending=self.spool.member_queue_depth())
            return 0

    def run_forever(self) -> None:
        self.logger.emit("bridge_started", enable_send=self.enable_send)
        workers = [
            threading.Thread(target=self._supervise, args=("members", self.upload_members_once, 5), daemon=True),
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
            **({"wechatAccountId": health.wechat_account_id} if getattr(health, "wechat_account_id", None) else {}),
            "wechatVersion": getattr(health, "wechat_version", None) or self.settings.expected_wechat_version,
            "loginStatus": getattr(health, "login_status", "UNKNOWN"),
            "receiverHealth": dict(self._receiver_status),
            **({"listenerWatermark": snapshot.watermark} if snapshot.watermark else {}),
            "screenLocked": bool(getattr(health, "screen_locked", True)),
            "outboundQueueDepth": snapshot.pending_outbox + snapshot.ambiguous_outbox,
            "observedGroupsComplete": bool(getattr(health, "database_available", False)) and getattr(health, "login_status", "UNKNOWN") == "LOGGED_IN",
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
        self._authorized_member_groups = frozenset(groups)
        contacts = response.get("privateReplyContactIds", [])
        if not isinstance(contacts, list) or len(contacts) > 100 or not all(isinstance(c, str) for c in contacts):
            raise ValueError("HEARTBEAT_INVALID_PRIVATE_CONTACTS")
        configure_private = getattr(self.transport, "configure_private_reply_contacts", None)
        if callable(configure_private) and "privateReplyContactIds" in response:
            configure_private(contacts)


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
        if isinstance(error, (ValueError, RuntimeError)) and error.args and isinstance(error.args[0], str):
            candidate = error.args[0]
            if re.fullmatch(r"[A-Z0-9_]{1,64}", candidate):
                return candidate
        return fallback
