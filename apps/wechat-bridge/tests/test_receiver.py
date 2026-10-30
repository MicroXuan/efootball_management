from __future__ import annotations

from datetime import UTC, datetime
from threading import Event, Thread

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


def test_normalizes_group_sender_from_pinned_library_content_prefix() -> None:
    receiver = WechatautoReceiver(
        database=object(),
        enabled_group_ids={"league@chatroom"},
        robot_user_id="robot-wxid",
    )

    event = receiver.normalize(raw_message(
        sender_username="",
        content="wxid_member_123:\n查询赛程",
    ))

    assert event is not None
    assert event.sender_id == "wxid_member_123"
    assert event.text == "查询赛程"


def test_normalizes_group_command_with_database_control_padding() -> None:
    receiver = WechatautoReceiver(
        database=object(),
        enabled_group_ids={"league@chatroom"},
        robot_user_id="robot-wxid",
    )

    event = receiver.normalize(raw_message(
        sender_username="",
        content="wxid_member_123:\n查询赛程\x00\x01\x00",
    ))

    assert event is not None
    assert event.sender_id == "wxid_member_123"
    assert event.text == "查询赛程"


def test_rejects_untrusted_group_sender_prefixes() -> None:
    receiver = WechatautoReceiver(
        database=object(),
        enabled_group_ids={"league@chatroom"},
        robot_user_id="robot-wxid",
    )

    assert receiver.normalize(raw_message(
        sender_username="",
        content="18:\n查询赛程",
    )) is None
    assert receiver.normalize(raw_message(
        sender_username="member-wxid",
        content="wxid_other:\n查询赛程",
    )) is None


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


def test_serializes_database_access_across_health_and_group_scans() -> None:
    class NonThreadSafeDatabase:
        def __init__(self) -> None:
            self.health_entered = Event()
            self.release_health = Event()
            self.concurrent_access = Event()

        def get_self_info(self) -> object:
            self.health_entered.set()
            assert self.release_health.wait(timeout=1)
            return {"username": "robot-wxid"}

        def get_sessions(self, limit: int = 500) -> list[dict[str, object]]:
            if not self.release_health.is_set():
                self.concurrent_access.set()
            return []

    database = NonThreadSafeDatabase()
    receiver = WechatautoReceiver(
        database=database,
        enabled_group_ids=set(),
        robot_user_id="robot-wxid",
    )
    health_thread = Thread(target=receiver.health)
    groups_thread = Thread(target=receiver.observed_groups)

    health_thread.start()
    assert database.health_entered.wait(timeout=1)
    groups_thread.start()
    database.concurrent_access.wait(timeout=0.1)
    database.release_health.set()
    health_thread.join(timeout=1)
    groups_thread.join(timeout=1)

    assert database.concurrent_access.is_set() is False


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


def test_private_message_without_sender_index_uses_verified_conversation_identity() -> None:
    class PrivateDatabase:
        def get_sessions(self, limit: int = 500) -> list[dict[str, object]]:
            return [{"username": "contact-wxid"}]

        def get_nickname(self, username: str) -> str:
            return "管理员微信"

        def get_new_messages(self, username: str, since_seq: int, limit: int = 200) -> list[dict[str, object]]:
            return [{"local_id": 42, "type": "文本", "sender_id": 3, "sender_username": "",
                     "create_time": NOW_TS, "content": "帮助", "sort_seq": 8100}] if since_seq < 8100 else []

        def get_message_row(self, username: str, local_id: int) -> dict[str, object]:
            return {"local_id": 42, "sort_seq": 8100, "sender_id": 3, "server_id": "private-server-id"}

    receiver = WechatautoReceiver(database=PrivateDatabase(), enabled_group_ids=set(), robot_user_id="robot-wxid")

    event = receiver.poll(None)[0]

    assert event.conversation_type == "PRIVATE"
    assert event.sender_id == "contact-wxid"
    assert event.text == "帮助"


def test_private_message_without_server_id_gets_stable_local_identity_only_after_row_verification() -> None:
    class PrivateDatabase:
        def get_sessions(self, limit: int = 500) -> list[dict[str, object]]:
            return [{"username": "contact-wxid"}]

        def get_nickname(self, username: str) -> str:
            return "管理员微信"

        def get_new_messages(self, username: str, since_seq: int, limit: int = 200) -> list[dict[str, object]]:
            return [{"local_id": 43, "type": "文本", "sender_id": 3, "sender_username": "",
                     "create_time": NOW_TS, "content": "帮助", "sort_seq": 8101}] if since_seq < 8101 else []

        def get_message_row(self, username: str, local_id: int) -> dict[str, object]:
            return {"local_id": 43, "sort_seq": 8101, "sender_id": 3, "server_id": ""}

    receiver = WechatautoReceiver(database=PrivateDatabase(), enabled_group_ids=set(), robot_user_id="robot-wxid")

    first = receiver.poll(None)[0]
    second = receiver.poll(None)[0]

    assert first.message_id.startswith("local:")
    assert first.message_id == second.message_id
    assert first.sender_id == "contact-wxid"


def test_private_command_is_retried_when_message_detail_temporarily_unavailable() -> None:
    class DelayedDetailDatabase:
        def __init__(self) -> None:
            self.detail_available = False

        def get_sessions(self, limit: int = 500) -> list[dict[str, object]]:
            return [{"username": "new-admin-wxid"}]

        def get_nickname(self, username: str) -> str:
            return "新管理员"

        def get_new_messages(self, username: str, since_seq: int, limit: int = 200) -> list[dict[str, object]]:
            return [{"local_id": 45, "type": "文本", "sender_id": 3, "sender_username": "",
                     "create_time": NOW_TS, "content": "帮助", "sort_seq": 8102}] if since_seq < 8102 else []

        def get_message_row(self, username: str, local_id: int) -> dict[str, object]:
            if not self.detail_available:
                raise OSError("database snapshot temporarily unavailable")
            return {"local_id": 45, "sort_seq": 8102, "sender_id": 3,
                    "server_id": "new-admin-message"}

    database = DelayedDetailDatabase()
    receiver = WechatautoReceiver(database=database, enabled_group_ids=set(), robot_user_id="robot-wxid")

    assert receiver.poll(None) == []
    assert receiver.scanned_cursors() == {}

    database.detail_available = True
    assert [event.message_id for event in receiver.poll(None)] == ["new-admin-message"]
    assert receiver.scanned_cursors() == {"new-admin-wxid": 8102}


def test_private_traditional_help_is_normalized_before_upload() -> None:
    receiver = WechatautoReceiver(database=object(), enabled_group_ids=set(), robot_user_id="robot-wxid")

    event = receiver.normalize(raw_message(
        conversation_id="contact-wxid", sender_username="contact-wxid", content="幫助",
    ))

    assert event is not None
    assert event.text == "帮助"


def test_private_message_with_unverified_sender_is_not_inferred_from_chat_identity() -> None:
    class PrivateDatabase:
        def get_sessions(self, limit: int = 500) -> list[dict[str, object]]:
            return [{"username": "contact-wxid"}]

        def get_new_messages(self, username: str, since_seq: int, limit: int = 200) -> list[dict[str, object]]:
            return [{"local_id": 44, "type": "文本", "sender_id": 3, "sender_username": "",
                     "create_time": NOW_TS, "content": "帮助", "sort_seq": 8102}]

        def get_message_row(self, username: str, local_id: int) -> dict[str, object]:
            return {"local_id": 44, "sort_seq": 8102, "sender_id": 7, "server_id": ""}

    receiver = WechatautoReceiver(database=PrivateDatabase(), enabled_group_ids=set(), robot_user_id="robot-wxid")

    assert receiver.poll(None) == []


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


def test_discovers_normal_chat_identity_without_uploading_its_content() -> None:
    receiver = WechatautoReceiver(database=object(), enabled_group_ids={"league@chatroom"}, robot_user_id="robot-wxid")
    assert receiver.normalize(raw_message(content="今天晚上见")) is None
    members = receiver.observed_members()
    assert len(members) == 1
    assert members[0].wechat_contact_id == "member-wxid"
    assert members[0].display_name is None
    assert "今天晚上见" not in members[0].model_dump_json()
    receiver.normalize(raw_message(content="别的群", conversation_id="other@chatroom"))
    receiver.normalize(raw_message(content="私聊", conversation_id="contact-wxid"))
    assert len(receiver.observed_members()) == 1


def test_mixed_chat_load_compacts_members_and_preserves_commands_across_restart(tmp_path):
    from efm_wechat_bridge.spool import BridgeSpool

    receiver = WechatautoReceiver(database=object(), enabled_group_ids={"league@chatroom"}, robot_user_id="robot-wxid")
    spool_path = tmp_path / "mixed.sqlite"
    spool = BridgeSpool(spool_path)
    expected_ids = []
    for index in range(1500):
        text = "我的赛程" if index % 50 == 0 else str(100 + index) if index % 10 == 0 else "普通聊天不上传"
        event = receiver.normalize(raw_message(server_id=str(900000000000 + index), sort_seq=8000 + index,
            sender_username=f"wxid_member_{index % 30}", content=text))
        if event:
            expected_ids.append(event.message_id)
            spool.append_inbound(event, sort_key=event.sequence)
        members = receiver.observed_members()
        spool.upsert_observed_members(members)
        receiver.ack_observed_members(members)
    assert len(expected_ids) == 150
    spool = BridgeSpool(spool_path)
    members = spool.pending_observed_members()
    assert len(members) == 30
    assert {m.wechat_contact_id for m in members} == {f"wxid_member_{i}" for i in range(30)}
    first = spool.pending_inbound(limit=100)
    assert [e.message_id for e in first] == expected_ids[:100]
    assert "普通聊天" not in repr(members)
    spool.ack_observed_members(members)
    assert spool.pending_observed_members() == []
    assert spool.health_snapshot().pending_inbound == 150
    spool.ack_inbound([e.message_id for e in first], watermark=first[-1].sequence)
    assert [e.message_id for e in spool.pending_inbound(limit=100)] == expected_ids[100:]


def test_private_administrator_commands_require_same_stable_sender() -> None:
    receiver = WechatautoReceiver(database=object(), enabled_group_ids=set(), robot_user_id="robot-wxid")
    commands = ["晋级 M12 主队 原因：弃权", "转会 P2 T1 T2 500 原因：同意", "球队", "阵容 T1", "拍卖列表", "拍卖 A1", "开始拍卖 A1", "暂停拍卖 A1", "继续拍卖 A1", "取消拍卖 A1 原因：取消", "恢复拍卖 A1 原因：已核对", "审核成交 L1", "调整成交 L1 T2 100 原因：核实", "作废成交 L1 原因：无效", "帮助", "联赛", "赛季", "切换联赛 CELL", "切换赛季 第一季", "赛程2", "赛程 2",
                "报分 M12 2:1 原因：核实", "确认 AABBCCDDEEFF", "取消 AABBCCDDEEFF", "操作 AABBCCDDEEFF"]
    for text in commands:
        raw = raw_message(conversation_id="contact-wxid", sender_username="contact-wxid", content=text)
        assert receiver.normalize(raw) is not None
        assert receiver.normalize({**raw, "sender_username": "other-wxid"}) is None
    assert receiver.normalize(raw_message(conversation_id="contact-wxid", sender_username="contact-wxid", content="随便聊天")) is None


def test_restart_private_target_names_only_use_server_authorized_stable_contacts() -> None:
    receiver = WechatautoReceiver(database=object(), enabled_group_ids=set(), robot_user_id="robot-wxid")
    assert receiver.private_reply_names(["contact-wxid", "league@chatroom", "bad id"]) == {"contact-wxid": "contact-wxid"}
