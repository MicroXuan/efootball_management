from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from pydantic import ValidationError

from efm_wechat_bridge.models import InboundEvent, ObservedGroup, OutboxTask, SendAck


def test_validates_observed_groups_and_exact_inbound_text_limit() -> None:
    group = ObservedGroup(wechat_group_id="room@chatroom", display_name="CELL 联赛群")
    assert group.wechat_group_id == "room@chatroom"

    event = InboundEvent(
        message_id="server-message-1",
        conversation_type="GROUP",
        conversation_id="room@chatroom",
        sender_id="member-wxid",
        sent_at=datetime.now(UTC),
        text="查" * 2_000,
    )
    assert len(event.text) == 2_000

    with pytest.raises(ValidationError):
        event.model_copy(update={"text": "查" * 2_001}, deep=True).__class__.model_validate(
            {**event.model_dump(), "text": "查" * 2_001}
        )


def test_rejects_naive_datetimes() -> None:
    with pytest.raises(ValidationError, match="timezone"):
        InboundEvent(
            message_id="server-message-1",
            conversation_type="PRIVATE",
            conversation_id="contact-wxid",
            sender_id="contact-wxid",
            sent_at=datetime.now(),
            text="绑定 123456",
        )


def test_rejects_unknown_outbox_kinds_and_oversized_text() -> None:
    common = {
        "id": uuid4(),
        "target_type": "GROUP",
        "target_id": "room@chatroom",
        "text": "赛程",
        "priority": 100,
        "scheduled_at": datetime.now(UTC),
    }
    task = OutboxTask(**common)
    assert task.kind == "TEXT"

    with pytest.raises(ValidationError):
        OutboxTask(**common, kind="IMAGE")
    with pytest.raises(ValidationError):
        OutboxTask(**{**common, "text": "x" * 2_001})


def test_send_ack_requires_result_specific_fields() -> None:
    sent = SendAck(status="SENT", readback_message_id="wechat-server-id")
    assert sent.readback_message_id == "wechat-server-id"

    with pytest.raises(ValidationError):
        SendAck(status="SENT")
    with pytest.raises(ValidationError):
        SendAck(status="FAILED", error_code="WINDOW_LOCKED")
