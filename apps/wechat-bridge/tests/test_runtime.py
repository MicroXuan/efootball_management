from __future__ import annotations

import io
import json
import threading
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import UUID

from efm_wechat_bridge.api_client import BridgeApiError
from efm_wechat_bridge.config import BridgeSettings
from efm_wechat_bridge.fake_transport import FakeWechatTransport
from efm_wechat_bridge.models import InboundEvent, ObservedGroup, OutboxTask, SendAck
from efm_wechat_bridge.runtime import BridgeRuntime, StructuredLogger
from efm_wechat_bridge.spool import BridgeSpool
from efm_wechat_bridge.transport import SendResult, SendStatus, TransportHealth


DEVICE_ID = UUID("11111111-1111-4111-8111-111111111111")


def settings(tmp_path: Path, *, send_enabled: bool = True) -> BridgeSettings:
    return BridgeSettings.model_validate({
        "environment": "test",
        "api_url": "https://league.example.com",
        "device_id": DEVICE_ID,
        "state_dir": tmp_path,
        "send_enabled": send_enabled,
        "poll_interval_seconds": 0.5,
        "heartbeat_interval_seconds": 5,
        "EFM_WECHAT_BRIDGE_TOKEN": "runtime-token-" + "x" * 32,
    })


def inbound(message_id: str = "message-1", sequence: str = "0001") -> InboundEvent:
    return InboundEvent(
        message_id=message_id,
        conversation_type="GROUP",
        conversation_id="league@chatroom",
        sender_id="member-wxid",
        sent_at=datetime(2026, 10, 9, 12, 0, tzinfo=UTC),
        text="查询赛程",
        sequence=sequence,
    )


def outgoing() -> OutboxTask:
    return OutboxTask(
        id=UUID("22222222-2222-4222-8222-222222222222"),
        target_type="GROUP",
        target_id="league@chatroom",
        text="赛程回复",
        priority=100,
        scheduled_at=datetime(2026, 10, 9, 12, 0, tzinfo=UTC),
    )


class FakeApi:
    def __init__(self) -> None:
        self.heartbeats: list[dict[str, object]] = []
        self.uploads: list[list[str]] = []
        self.claims = 0
        self.acks: list[tuple[str, SendAck]] = []
        self.claimed: list[OutboxTask] = []
        self.upload_error: Exception | None = None
        self.heartbeat_error: Exception | None = None

    def heartbeat(self, payload: dict[str, object]) -> dict[str, object]:
        if self.heartbeat_error:
            raise self.heartbeat_error
        self.heartbeats.append(payload)
        return {
            "acceptedAt": "2026-10-09T12:00:00Z",
            "enabledGroups": [{
                "wechatGroupId": "league@chatroom",
                "displayName": "CELL 联赛群",
            }],
        }

    def upload_messages(self, events: list[InboundEvent]) -> list[dict[str, object]]:
        if self.upload_error:
            raise self.upload_error
        self.uploads.append([event.message_id for event in events])
        return [
            {"messageId": event.message_id, "status": "ACCEPTED", "inboundId": str(DEVICE_ID), "resultCode": None}
            for event in events
        ]

    def claim_outbox(self, *, limit: int) -> list[OutboxTask]:
        assert limit == 20
        self.claims += 1
        tasks, self.claimed = self.claimed, []
        return tasks

    def ack_outbox(self, message_id: UUID | str, ack: SendAck) -> None:
        self.acks.append((str(message_id), ack))


def make_runtime(
    tmp_path: Path,
    *,
    transport: FakeWechatTransport | None = None,
    api: FakeApi | None = None,
    enable_send: bool = False,
) -> tuple[BridgeRuntime, FakeWechatTransport, FakeApi, BridgeSpool]:
    resolved_transport = transport or FakeWechatTransport(
        groups=[ObservedGroup(wechat_group_id="league@chatroom", display_name="CELL 联赛群")]
    )
    resolved_api = api or FakeApi()
    spool = BridgeSpool(tmp_path / "bridge.sqlite3")
    runtime = BridgeRuntime(
        settings=settings(tmp_path),
        spool=spool,
        api=resolved_api,
        transport=resolved_transport,
        enable_send=enable_send,
    )
    return runtime, resolved_transport, resolved_api, spool


def test_doctor_fails_closed_when_transport_or_api_is_unhealthy(tmp_path: Path) -> None:
    unhealthy = TransportHealth(
        ready=False,
        login_status="UNKNOWN",
        screen_locked=True,
        database_available=False,
        sender_available=False,
        error_code="WINDOW_SESSION_LOCKED",
    )
    runtime, _, api, _ = make_runtime(tmp_path, transport=FakeWechatTransport(health=unhealthy), enable_send=True)

    report = runtime.doctor()

    assert report.passed is False
    assert "WINDOW_SESSION_LOCKED" in report.errors
    assert api.heartbeats == []
    assert runtime.send_once() == 0


def test_heartbeat_reports_inventory_and_applies_authorized_group_config(tmp_path: Path) -> None:
    runtime, transport, api, _ = make_runtime(tmp_path)

    report = runtime.doctor()

    assert report.passed is True
    assert api.heartbeats[0]["observedGroups"] == [
        {"wechatGroupId": "league@chatroom", "displayName": "CELL 联赛群"}
    ]
    assert transport.authorized_groups == {"league@chatroom": "CELL 联赛群"}


def test_receive_spools_uploads_then_acknowledges_and_advances_watermark(tmp_path: Path) -> None:
    runtime, transport, api, spool = make_runtime(tmp_path)
    transport.inject_inbound(inbound())

    assert runtime.receive_upload_once() == 1

    assert api.uploads == [["message-1"]]
    assert spool.pending_inbound(limit=50) == []
    assert spool.watermark() == "0001"


def test_api_outage_leaves_inbound_durable_for_redelivery(tmp_path: Path) -> None:
    api = FakeApi()
    api.upload_error = BridgeApiError("BRIDGE_API_UNAVAILABLE", terminal=False)
    runtime, transport, _, spool = make_runtime(tmp_path, api=api)
    transport.inject_inbound(inbound())

    assert runtime.receive_upload_once() == 0

    assert [event.message_id for event in spool.pending_inbound(limit=50)] == ["message-1"]
    assert spool.watermark() is None


def test_send_claims_only_after_fresh_doctor_and_maps_all_results(tmp_path: Path) -> None:
    api = FakeApi()
    api.claimed = [outgoing()]
    transport = FakeWechatTransport(send_results=[
        SendResult(status=SendStatus.SENT, readback_message_id="wechat-id-1")
    ])
    runtime, _, _, spool = make_runtime(tmp_path, api=api, transport=transport, enable_send=True)

    assert runtime.send_once() == 0
    assert api.claims == 0
    assert runtime.doctor().passed is True
    assert runtime.send_once() == 1
    assert api.acks[0][1].status == "SENT"
    assert spool.outbox_record(outgoing().id).status == "COMPLETED"  # type: ignore[union-attr]


def test_ambiguous_send_is_acknowledged_once_and_stops_later_sends(tmp_path: Path) -> None:
    api = FakeApi()
    second = outgoing().model_copy(update={"id": UUID("33333333-3333-4333-8333-333333333333")})
    api.claimed = [outgoing(), second]
    transport = FakeWechatTransport(send_results=[
        SendResult(status=SendStatus.AMBIGUOUS, error_code="WECHAT_SEND_UNCONFIRMED"),
        SendResult(status=SendStatus.SENT, readback_message_id="must-not-send"),
    ])
    runtime, _, _, spool = make_runtime(tmp_path, api=api, transport=transport, enable_send=True)
    assert runtime.doctor().passed is True

    assert runtime.send_once() == 1

    assert len(transport.sent_tasks) == 1
    assert api.acks[0][1].status == "AMBIGUOUS"
    assert spool.outbox_record(outgoing().id).status == "AMBIGUOUS"  # type: ignore[union-attr]


def test_retryable_failed_send_can_be_reclaimed_and_succeed(tmp_path: Path) -> None:
    api = FakeApi()
    api.claimed = [outgoing()]
    transport = FakeWechatTransport(send_results=[
        SendResult(status=SendStatus.FAILED, error_code="WINDOW_NOT_READY"),
        SendResult(status=SendStatus.SENT, readback_message_id="wechat-id-after-retry"),
    ])
    runtime, _, _, spool = make_runtime(tmp_path, api=api, transport=transport, enable_send=True)
    assert runtime.doctor().passed is True

    assert runtime.send_once() == 1
    assert spool.outbox_record(outgoing().id).status == "PENDING"  # type: ignore[union-attr]
    api.claimed = [outgoing()]
    assert runtime.send_once() == 1

    assert [ack.status for _, ack in api.acks] == ["FAILED", "SENT"]
    assert spool.outbox_record(outgoing().id).status == "COMPLETED"  # type: ignore[union-attr]


def test_lock_transition_stops_before_claiming_or_consuming_outbox(tmp_path: Path) -> None:
    runtime, transport, api, _ = make_runtime(tmp_path, enable_send=True)
    assert runtime.doctor().passed is True
    transport.set_health(TransportHealth(
        ready=False,
        login_status="LOGGED_IN",
        wechat_version="4.1.15.13",
        screen_locked=True,
        database_available=True,
        sender_available=False,
        error_code="WINDOW_SESSION_LOCKED",
    ))

    assert runtime.send_once() == 0
    assert api.claims == 0


def test_supervised_runtime_stops_within_bound_and_logs_only_safe_codes(tmp_path: Path) -> None:
    stream = io.StringIO()
    api = FakeApi()
    api.heartbeat_error = RuntimeError("secret-token=do-not-log")
    runtime, _, _, _ = make_runtime(tmp_path, api=api)
    runtime.logger = StructuredLogger(stream=stream)
    thread = threading.Thread(target=runtime.run_forever)
    thread.start()
    runtime.request_stop()
    thread.join(timeout=2)

    assert thread.is_alive() is False
    log_text = stream.getvalue()
    assert "do-not-log" not in log_text
    for line in log_text.splitlines():
        json.loads(line)


def test_successful_heartbeat_refreshes_long_running_send_gate(tmp_path: Path) -> None:
    runtime, _, api, _ = make_runtime(tmp_path, enable_send=True)
    assert runtime.doctor().passed is True
    runtime._doctor_passed_at = datetime.now(UTC) - timedelta(minutes=11)
    api.claimed = [outgoing()]

    assert runtime.heartbeat_once() is True
    assert runtime.send_once() == 1


def test_restarted_in_flight_send_becomes_ambiguous_without_resending(tmp_path: Path) -> None:
    api = FakeApi()
    api.claimed = [outgoing()]
    transport = FakeWechatTransport(send_results=[
        SendResult(status=SendStatus.SENT, readback_message_id="must-not-send")
    ])
    runtime, _, _, spool = make_runtime(tmp_path, api=api, transport=transport, enable_send=True)
    spool.remember_outbox(outgoing())
    spool.mark_outbox_in_flight(outgoing().id)
    assert runtime.doctor().passed is True

    assert runtime.send_once() == 1

    assert transport.sent_tasks == []
    assert api.acks[0][1].status == "AMBIGUOUS"
    assert spool.outbox_record(outgoing().id).status == "AMBIGUOUS"  # type: ignore[union-attr]


def test_runtime_persists_per_conversation_scan_cursors_only_after_upload(tmp_path: Path) -> None:
    runtime, transport, _, spool = make_runtime(tmp_path)
    transport.inject_inbound(inbound(sequence="0010"))
    transport.scanned = {"league@chatroom": 10, "contact-wxid": 200}

    assert runtime.receive_upload_once() == 1
    assert spool.scan_cursors() == {"league@chatroom": 10, "contact-wxid": 200}
