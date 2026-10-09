from __future__ import annotations

from datetime import UTC, datetime

from efm_wechat_bridge.wechatauto_receiver import WechatautoReceiver


NOW_TS = int(datetime(2026, 10, 9, 12, 0, tzinfo=UTC).timestamp())


def raw_message(**overrides: object) -> dict[str, object]:
    raw: dict[str, object] = {
        "conversation_id": "league@chatroom",
        "server_id": "900000000001",
        "sort_seq": 8001,
        "type": "文本",
        "sender_id": 18,
        "sender_username": "member-wxid",
        "content": "查询赛程",
        "create_time": NOW_TS,
    }
    raw.update(overrides)
    return raw


def test_normalizes_enabled_group_text_with_resolved_sender() -> None:
    receiver = WechatautoReceiver(
        database=object(),
        enabled_group_ids={"league@chatroom"},
        robot_user_id="robot-wxid",
    )

    event = receiver.normalize(raw_message())

    assert event is not None
    assert event.message_id == "900000000001"
    assert event.sequence == "00000000000000008001"
    assert event.conversation_type == "GROUP"
    assert event.sender_id == "member-wxid"
    assert event.sent_at == datetime(2026, 10, 9, 12, 0, tzinfo=UTC)


def test_allows_only_private_binding_commands() -> None:
    receiver = WechatautoReceiver(database=object(), enabled_group_ids=set(), robot_user_id="robot-wxid")
    binding = receiver.normalize(raw_message(
        conversation_id="contact-wxid",
        sender_username="contact-wxid",
        content="  绑定 123456  ",
    ))
    ordinary = receiver.normalize(raw_message(
        server_id="900000000002",
        conversation_id="contact-wxid",
        sender_username="contact-wxid",
        content="你好",
    ))

    assert binding is not None
    assert binding.conversation_type == "PRIVATE"
    assert binding.text == "绑定 123456"
    assert ordinary is None


def test_rejects_disabled_self_non_text_oversized_and_malformed_rows() -> None:
    receiver = WechatautoReceiver(
        database=object(),
        enabled_group_ids={"league@chatroom"},
        robot_user_id="robot-wxid",
    )

    rejected = [
        raw_message(conversation_id="disabled@chatroom"),
        raw_message(sender_username="robot-wxid"),
        raw_message(sender_id=2, sender_username=""),
        raw_message(type="图片"),
        raw_message(content="1" * 2_001),
        raw_message(sender_username="bad sender with spaces"),
        raw_message(server_id=""),
        raw_message(sort_seq=-1),
    ]

    assert all(receiver.normalize(row) is None for row in rejected)


class FakeDatabase:
    def get_sessions(self, limit: int = 500) -> list[dict[str, object]]:
        assert limit == 500
        return [
            {"username": "contact-wxid", "nickname": "联系人"},
            {"username": "league@chatroom", "nickname": "联赛群"},
            {"username": "other@chatroom", "nickname": "其他群"},
        ]

    def get_new_messages(self, username: str, since_seq: int, limit: int = 200) -> list[dict[str, object]]:
        assert since_seq == 8000
        assert limit == 200
        if username == "league@chatroom":
            return [
                raw_message(server_id="900000000003", sort_seq=8003),
                raw_message(server_id="900000000001", sort_seq=8001),
                raw_message(server_id="900000000001", sort_seq=8001),
            ]
        if username == "contact-wxid":
            return [raw_message(
                conversation_id="contact-wxid",
                server_id="900000000002",
                sort_seq=8002,
                sender_username="contact-wxid",
                content="绑定 654321",
            )]
        raise AssertionError("disabled group must not be scanned")


def test_poll_scans_only_enabled_groups_and_private_bindings_then_deduplicates() -> None:
    receiver = WechatautoReceiver(
        database=FakeDatabase(),
        enabled_group_ids={"league@chatroom"},
        robot_user_id="robot-wxid",
    )

    assert [group.wechat_group_id for group in receiver.observed_groups()] == [
        "league@chatroom",
        "other@chatroom",
    ]
    assert [event.message_id for event in receiver.poll("00000000000000008000")] == [
        "900000000001",
        "900000000002",
        "900000000003",
    ]


def test_health_sanitizes_database_failures() -> None:
    class BrokenDatabase:
        def get_self_info(self) -> object:
            raise RuntimeError("key=secret account=wxid_sensitive C:/Users/name/db_storage")

    receiver = WechatautoReceiver(
        database=BrokenDatabase(),
        enabled_group_ids=set(),
        robot_user_id="robot-wxid",
        expected_wechat_version="4.1.15.13",
    )

    health = receiver.health()

    assert health.ready is False
    assert health.error_code == "WECHAT_DATABASE_UNAVAILABLE"
    assert "secret" not in (health.detail or "")
    assert "wxid_sensitive" not in (health.detail or "")

