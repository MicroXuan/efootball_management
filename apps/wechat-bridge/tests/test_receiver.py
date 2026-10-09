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
        raw_message(content="大家晚上好，这是普通群聊"),
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

    def get_nickname(self, username: str) -> str:
        return {
            "contact-wxid": "联系人",
            "league@chatroom": "联赛群",
            "other@chatroom": "其他群",
        }[username]

    def get_message_row(self, username: str, local_id: int) -> dict[str, object]:
        return {
            "server_id": f"server-{username}-{local_id}",
            "sort_seq": local_id,
        }

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


def test_pinned_library_rows_are_hydrated_with_server_id_and_contact_name() -> None:
    class PinnedShapeDatabase:
        def get_sessions(self, limit: int = 500) -> list[dict[str, object]]:
            return [{"username": "league@chatroom", "unread": 1, "summary": "120"}]

        def get_nickname(self, username: str) -> str:
            assert username == "league@chatroom"
            return "CELL 联赛群"

        def get_new_messages(self, username: str, since_seq: int, limit: int = 200) -> list[dict[str, object]]:
            return [{
                "local_id": 81,
                "type": "文本",
                "sender_id": 18,
                "sender_username": "member-wxid",
                "create_time": NOW_TS,
                "content": "120",
                "sort_seq": 8001,
            }]

        def get_message_row(self, username: str, local_id: int) -> dict[str, object]:
            assert (username, local_id) == ("league@chatroom", 81)
            return {"server_id": 900000000001, "sort_seq": 8001}

    receiver = WechatautoReceiver(
        database=PinnedShapeDatabase(),
        enabled_group_ids={"league@chatroom"},
        robot_user_id="robot-wxid",
    )

    assert receiver.observed_groups()[0].display_name == "CELL 联赛群"
    assert receiver.poll(None)[0].message_id == "900000000001"


def test_poll_paginates_and_tracks_each_conversation_without_skipping_filtered_rows() -> None:
    class BacklogDatabase:
        def get_sessions(self, limit: int = 500) -> list[dict[str, object]]:
            return [{"username": "contact-wxid"}, {"username": "league@chatroom"}]

        def get_nickname(self, username: str) -> str:
            return username

        def get_new_messages(self, username: str, since_seq: int, limit: int = 200) -> list[dict[str, object]]:
            if username == "contact-wxid" and since_seq == 0:
                return [raw_message(
                    conversation_id=username,
                    server_id=f"private-{index}",
                    local_id=index,
                    sort_seq=index,
                    sender_username=username,
                    content="普通私聊",
                ) for index in range(1, 201)]
            if username == "contact-wxid" and since_seq == 200:
                return [raw_message(
                    conversation_id=username,
                    server_id="binding-201",
                    local_id=201,
                    sort_seq=201,
                    sender_username=username,
                    content="绑定 123456",
                )]
            if username == "league@chatroom":
                return [raw_message(server_id="group-10", local_id=10, sort_seq=10)] if since_seq < 10 else []
            return []

        def get_message_row(self, username: str, local_id: int) -> dict[str, object]:
            return {"server_id": f"server-{username}-{local_id}", "sort_seq": local_id}

    receiver = WechatautoReceiver(
        database=BacklogDatabase(),
        enabled_group_ids={"league@chatroom"},
        robot_user_id="robot-wxid",
    )

    events = receiver.poll('{"contact-wxid":0,"league@chatroom":0}')

    assert [event.text for event in events] == ["查询赛程", "绑定 123456"]
    assert receiver.scanned_cursors() == {"contact-wxid": 201, "league@chatroom": 10}
    assert receiver.private_targets() == {"contact-wxid": "contact-wxid"}
