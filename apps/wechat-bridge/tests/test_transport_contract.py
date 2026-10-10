from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from efm_wechat_bridge.fake_transport import FakeWechatTransport
from efm_wechat_bridge.models import InboundEvent, ObservedGroup, OutboxTask
from efm_wechat_bridge.transport import SendResult, SendStatus


def _event(message_id: str, sequence: str, *, sender_id: str = "member-a") -> InboundEvent:
    return InboundEvent(
        message_id=message_id,
        conversation_type="GROUP",
        conversation_id="league@chatroom",
        sender_id=sender_id,
        sent_at=datetime(2026, 10, 9, 12, 0, tzinfo=UTC),
        text="查询赛程",
        sequence=sequence,
    )


def _task() -> OutboxTask:
    return OutboxTask(
        id=UUID("11111111-1111-4111-8111-111111111111"),
        target_type="GROUP",
        target_id="league@chatroom",
        text="测试回复",
        priority=100,
        scheduled_at=datetime(2026, 10, 9, 12, 0, tzinfo=UTC),
    )


def test_fake_transport_exposes_stable_health_and_sorted_inventory() -> None:
    transport = FakeWechatTransport(
        groups=[
            ObservedGroup(wechat_group_id="z@chatroom", display_name="Z 群"),
            ObservedGroup(wechat_group_id="a@chatroom", display_name="A 群"),
        ]
    )

    health = transport.health()

    assert health.ready is True
    assert health.login_status == "LOGGED_IN"
    assert health.wechat_version == "4.1.15.13"
    assert health.screen_locked is False
    assert [group.wechat_group_id for group in transport.observed_groups()] == [
        "a@chatroom",
        "z@chatroom",
    ]


def test_fake_transport_polls_in_stable_order_after_watermark_and_excludes_self() -> None:
    transport = FakeWechatTransport(
        inbound=[
            _event("message-3", "00000000000000000003"),
            _event("message-self", "00000000000000000002", sender_id="robot-wxid"),
            _event("message-1", "00000000000000000001"),
        ],
        robot_user_id="robot-wxid",
    )

    assert [event.message_id for event in transport.poll("00000000000000000001")] == [
        "message-3"
    ]


def test_send_result_states_are_closed_and_fake_results_are_injectable() -> None:
    transport = FakeWechatTransport(
        send_results=[
            SendResult(status=SendStatus.AMBIGUOUS, error_code="READBACK_TIMEOUT"),
            SendResult(status=SendStatus.SENT, readback_message_id="wechat-server-1"),
        ]
    )

    assert transport.send(_task()).status is SendStatus.AMBIGUOUS
    sent = transport.send(_task())
    assert sent.status is SendStatus.SENT
    assert sent.readback_message_id == "wechat-server-1"
    assert {status.value for status in SendStatus} == {"SENT", "FAILED", "AMBIGUOUS"}

