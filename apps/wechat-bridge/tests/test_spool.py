from __future__ import annotations

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

from efm_wechat_bridge.models import InboundEvent, OutboxTask, SendAck
from efm_wechat_bridge.spool import BridgeSpool


def event(message_id: str, *, text: str | None = None) -> InboundEvent:
    return InboundEvent(
        message_id=message_id,
        conversation_type="GROUP",
        conversation_id="room@chatroom",
        sender_id="member-wxid",
        sent_at=datetime.now(UTC),
        text=text or message_id,
    )


def task(task_id=None, *, text: str = "赛程回复") -> OutboxTask:
    return OutboxTask(
        id=task_id or uuid4(),
        target_type="GROUP",
        target_id="room@chatroom",
        text=text,
        priority=100,
        scheduled_at=datetime.now(UTC),
    )


def test_bootstraps_wal_schema_and_appends_idempotently(tmp_path: Path) -> None:
    path = tmp_path / "bridge.sqlite3"
    spool = BridgeSpool(path)
    assert spool.append_inbound(event("message-1"), sort_key="0002") is True
    assert spool.append_inbound(event("message-1", text="duplicate body"), sort_key="0002") is False

    with sqlite3.connect(path) as connection:
        assert connection.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"
        assert connection.execute("SELECT COUNT(*) FROM inbound_spool").fetchone()[0] == 1


def test_returns_a_bounded_stable_order_and_advances_watermark_only_on_ack(tmp_path: Path) -> None:
    spool = BridgeSpool(tmp_path / "bridge.sqlite3")
    spool.append_inbound(event("message-c"), sort_key="0002")
    spool.append_inbound(event("message-b"), sort_key="0001")
    spool.append_inbound(event("message-a"), sort_key="0001")

    assert [item.message_id for item in spool.pending_inbound(limit=2)] == ["message-a", "message-b"]
    assert spool.watermark() is None
    assert spool.ack_inbound(["message-a", "message-b"], watermark="0001") == 2
    assert spool.watermark() == "0001"
    assert [item.message_id for item in spool.pending_inbound(limit=2)] == ["message-c"]


def test_persists_per_conversation_scan_cursors_and_in_flight_state(tmp_path: Path) -> None:
    spool = BridgeSpool(tmp_path / "bridge.sqlite3")
    spool.update_scan_cursors({"group@chatroom": 201, "contact-wxid": 88})
    outgoing = task()
    spool.remember_outbox(outgoing)
    spool.mark_outbox_in_flight(outgoing.id)

    restarted = BridgeSpool(tmp_path / "bridge.sqlite3")

    assert restarted.scan_cursors() == {"contact-wxid": 88, "group@chatroom": 201}
    assert restarted.outbox_record(outgoing.id).status == "IN_FLIGHT"  # type: ignore[union-attr]


def test_reopens_with_unacknowledged_messages_after_an_api_commit_crash(tmp_path: Path) -> None:
    path = tmp_path / "bridge.sqlite3"
    first_process = BridgeSpool(path)
    first_process.append_inbound(event("message-1"), sort_key="0001")
    assert [item.message_id for item in first_process.pending_inbound(limit=50)] == ["message-1"]

    restarted = BridgeSpool(path)
    assert [item.message_id for item in restarted.pending_inbound(limit=50)] == ["message-1"]
    restarted.ack_inbound(["message-1"], watermark="0001")
    assert restarted.pending_inbound(limit=50) == []


def test_deduplicates_outbox_and_preserves_ambiguous_state(tmp_path: Path) -> None:
    spool = BridgeSpool(tmp_path / "bridge.sqlite3")
    outgoing = task()
    assert spool.remember_outbox(outgoing) is True
    assert spool.remember_outbox(outgoing) is False
    spool.mark_outbox_ambiguous(outgoing.id, "READBACK_TIMEOUT")
    record = spool.outbox_record(outgoing.id)
    assert record is not None
    assert record.status == "AMBIGUOUS"
    assert record.last_error_code == "READBACK_TIMEOUT"

    spool.complete_outbox(outgoing.id, SendAck(status="SENT", readback_message_id="wechat-id-1"))
    completed = spool.outbox_record(outgoing.id)
    assert completed is not None
    assert completed.status == "COMPLETED"
    assert completed.readback_message_id == "wechat-id-1"


def test_purges_only_completed_outbox_older_than_retention(tmp_path: Path) -> None:
    spool = BridgeSpool(tmp_path / "bridge.sqlite3")
    old, recent, ambiguous = task(), task(), task()
    for outgoing in [old, recent, ambiguous]:
        spool.remember_outbox(outgoing)
    spool.complete_outbox(old.id, SendAck(status="SENT", readback_message_id="old-readback"))
    spool.complete_outbox(recent.id, SendAck(status="SENT", readback_message_id="recent-readback"))
    spool.mark_outbox_ambiguous(ambiguous.id, "UNCERTAIN")
    with sqlite3.connect(tmp_path / "bridge.sqlite3") as connection:
        connection.execute(
            "UPDATE outbox_spool SET completed_at = ? WHERE task_id = ?",
            ((datetime.now(UTC) - timedelta(days=8)).isoformat(), str(old.id)),
        )

    assert spool.purge_completed(before=datetime.now(UTC) - timedelta(days=7)) == 1
    assert spool.outbox_record(old.id) is None
    assert spool.outbox_record(recent.id) is not None
    assert spool.outbox_record(ambiguous.id) is not None


def test_supports_concurrent_readers_and_writers(tmp_path: Path) -> None:
    spool = BridgeSpool(tmp_path / "bridge.sqlite3")

    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(pool.map(
            lambda index: spool.append_inbound(event(f"message-{index:03d}"), sort_key=f"{index:04d}"),
            range(100),
        ))

    assert all(results)
    assert len(spool.pending_inbound(limit=100)) == 100
    snapshot = spool.health_snapshot()
    assert snapshot.pending_inbound == 100
    assert snapshot.ambiguous_outbox == 0
