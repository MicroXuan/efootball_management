from __future__ import annotations

import threading
import time
import sys
from types import SimpleNamespace
from datetime import UTC, datetime
from uuid import UUID

import pytest

from efm_wechat_bridge.models import OutboxTask
from efm_wechat_bridge.transport import SendStatus
from efm_wechat_bridge.wechat_gui_sender import ConversationTarget, WechatGuiSender, WechatautoGuiDriver
from efm_wechat_bridge.windows_session import SessionCheck


class Guard:
    def __init__(self, result: SessionCheck | None = None) -> None:
        self.result = result or SessionCheck(ready=True)

    def check(self, *, require_foreground: bool = False) -> SessionCheck:
        assert require_foreground is True
        return self.result


class Driver:
    def __init__(self) -> None:
        self.target = ConversationTarget(stable_id="league@chatroom", title="CELL 联赛群")
        self.clipboard: object = {"text": "user clipboard"}
        self.restored: object | None = None
        self.pasted: list[str] = []
        self.enter_calls = 0
        self.open_calls = 0
        self.fail_open = False
        self.fail_paste = False
        self.fail_enter = False
        self.readback: str | None = "wechat-server-id"
        self.active = 0
        self.max_active = 0
        self._active_lock = threading.Lock()

    def resolve_exact(self, stable_id: str) -> ConversationTarget | None:
        return None if self.fail_open else self.target

    def open_exact(self, target: ConversationTarget) -> bool:
        self.open_calls += 1
        return not self.fail_open and target == self.target

    def current_title(self) -> str | None:
        return self.target.title

    def capture_clipboard(self) -> object:
        return self.clipboard

    def restore_clipboard(self, value: object) -> None:
        self.restored = value

    def capture_readback_marker(self, stable_id: str) -> object:
        return {"target": stable_id, "sequence": 80}

    def paste_text(self, text: str) -> bool:
        self.pasted.append(text)
        return not self.fail_paste

    def press_enter(self) -> bool:
        self.enter_calls += 1
        with self._active_lock:
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        time.sleep(0.01)
        with self._active_lock:
            self.active -= 1
        if self.fail_enter:
            raise RuntimeError("input status unknown")
        return True

    def read_back(self, stable_id: str, text: str, marker: object, timeout_seconds: float) -> str | None:
        assert marker == {"target": stable_id, "sequence": 80}
        assert timeout_seconds == 8.0
        return self.readback


def task() -> OutboxTask:
    return OutboxTask(
        id=UUID("11111111-1111-4111-8111-111111111111"),
        target_type="GROUP",
        target_id="league@chatroom",
        text="【申花】出价有效：⭐120⭐，倒计时重置为 30 秒。",
        priority=100,
        scheduled_at=datetime(2026, 10, 9, 12, 0, tzinfo=UTC),
    )


def sender(driver: Driver, **kwargs: object) -> WechatGuiSender:
    return WechatGuiSender(
        session_guard=Guard(),
        driver=driver,
        expected_titles={"league@chatroom": "CELL 联赛群"},
        **kwargs,
    )


def test_fails_before_input_when_session_or_exact_target_is_unavailable() -> None:
    driver = Driver()
    locked = WechatGuiSender(
        session_guard=Guard(SessionCheck(ready=False, error_code="WINDOW_SESSION_LOCKED")),
        driver=driver,
        expected_titles={"league@chatroom": "CELL 联赛群"},
    )
    assert locked.send(task()).error_code == "WINDOW_SESSION_LOCKED"
    assert driver.pasted == []

    driver.fail_open = True
    assert sender(driver).send(task()).error_code == "CONVERSATION_NOT_FOUND"
    assert driver.pasted == []


def test_rejects_renamed_or_mismatched_conversation_before_input() -> None:
    driver = Driver()
    driver.target = ConversationTarget(stable_id="league@chatroom", title="已经改名的群")

    result = sender(driver).send(task())

    assert result.status is SendStatus.FAILED
    assert result.error_code == "CONVERSATION_TITLE_MISMATCH"
    assert driver.pasted == []


def test_dry_run_opens_and_confirms_target_without_input() -> None:
    driver = Driver()

    result = sender(driver, dry_run=True).send(task())

    assert result.status is SendStatus.FAILED
    assert result.error_code == "DRY_RUN_CONFIRMED"
    assert driver.open_calls == 1
    assert driver.pasted == []
    assert driver.enter_calls == 0


@pytest.mark.parametrize(
    ("failed_step", "expected_code"),
    [
        ("marker", "READBACK_MARKER_UNAVAILABLE"),
        ("clipboard", "CLIPBOARD_CAPTURE_FAILED"),
        ("rich_clipboard", "CLIPBOARD_CONTENT_UNSUPPORTED"),
    ],
)
def test_preparation_failure_identifies_step_without_entering_text(
    failed_step: str, expected_code: str
) -> None:
    class PreparationDriver(Driver):
        def capture_readback_marker(self, stable_id: str) -> object:
            if failed_step == "marker":
                raise RuntimeError("READBACK_MARKER_UNAVAILABLE")
            return super().capture_readback_marker(stable_id)

        def capture_clipboard(self) -> object:
            if failed_step == "rich_clipboard":
                raise RuntimeError("UNSUPPORTED_CLIPBOARD_CONTENT")
            if failed_step == "clipboard":
                raise OSError("clipboard temporarily busy")
            return super().capture_clipboard()

    driver = PreparationDriver()

    result = sender(driver).send(task())

    assert result.status is SendStatus.FAILED
    assert result.error_code == expected_code
    assert driver.pasted == []
    assert driver.enter_calls == 0


def test_restores_clipboard_and_returns_failed_when_paste_never_reached_enter() -> None:
    driver = Driver()
    driver.fail_paste = True

    result = sender(driver).send(task())

    assert result.status is SendStatus.FAILED
    assert result.error_code == "WECHAT_INPUT_FAILED"
    assert driver.enter_calls == 0
    assert driver.restored == driver.clipboard


def test_success_requires_exact_database_readback() -> None:
    driver = Driver()

    result = sender(driver).send(task())

    assert result.status is SendStatus.SENT
    assert result.readback_message_id == "wechat-server-id"
    assert driver.enter_calls == 1
    assert driver.restored == driver.clipboard


def test_post_enter_failure_is_ambiguous_but_readback_reconciles_it() -> None:
    driver = Driver()
    driver.fail_enter = True
    assert sender(driver).send(task()).status is SendStatus.SENT
    assert driver.enter_calls == 1

    driver.readback = None
    result = sender(driver).send(task())
    assert result.status is SendStatus.AMBIGUOUS
    assert result.error_code == "WECHAT_SEND_UNCONFIRMED"
    assert driver.enter_calls == 2


def test_sends_are_process_serialized() -> None:
    driver = Driver()
    gui_sender = sender(driver)
    results: list[SendStatus] = []
    threads = [threading.Thread(target=lambda: results.append(gui_sender.send(task()).status)) for _ in range(4)]

    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert results == [SendStatus.SENT] * 4
    assert driver.max_active == 1


def test_private_binding_reply_uses_narrow_authorized_contact_map() -> None:
    driver = Driver()
    driver.target = ConversationTarget(stable_id="contact-wxid", title="负责人")
    private_task = task().model_copy(update={"target_type": "PRIVATE", "target_id": "contact-wxid"})
    gui_sender = sender(driver)
    gui_sender.configure_authorized_private_targets({"contact-wxid": "负责人"})

    assert gui_sender.send(private_task).status is SendStatus.SENT


def test_live_driver_uses_contact_database_and_strict_current_uia_title() -> None:
    class Database:
        def get_nickname(self, stable_id: str) -> str:
            return "CELL 联赛群"

        def search_contact(self, title: str) -> list[dict[str, str]]:
            return [{"username": "league@chatroom", "remark": title, "nick_name": ""}]

    class Uia:
        current = "CELL 联赛群分群"

        def current_chat(self) -> str:
            return self.current

        def open_chat(self, title: str) -> bool:
            self.current = title
            return True

    class Gui:
        def __init__(self) -> None:
            self.uia = Uia()

        def _get_uia(self) -> Uia:
            return self.uia

    gui = Gui()
    live = WechatautoGuiDriver(gui=gui, database=Database())
    target = live.resolve_exact("league@chatroom")

    assert target == ConversationTarget(stable_id="league@chatroom", title="CELL 联赛群")
    live._current = target
    assert live.current_title() is None
    assert live.open_exact(target) is True
    assert live.current_title() == "CELL 联赛群"


def test_live_driver_rejects_duplicate_display_names_and_marker_failures() -> None:
    class Database:
        def get_nickname(self, stable_id: str) -> str:
            return "同名群"

        def search_contact(self, title: str) -> list[dict[str, str]]:
            return [
                {"username": "one@chatroom", "remark": title, "nick_name": ""},
                {"username": "two@chatroom", "remark": title, "nick_name": ""},
            ]

        def get_messages(self, stable_id: str, limit: int = 10) -> list[dict[str, object]]:
            raise OSError("database temporarily unavailable")

    live = WechatautoGuiDriver(gui=object(), database=Database())

    assert live.resolve_exact("one@chatroom") is None
    try:
        live.capture_readback_marker("one@chatroom")
    except RuntimeError as error:
        assert str(error) == "READBACK_MARKER_UNAVAILABLE"
    else:
        raise AssertionError("marker capture must fail closed")


def test_live_driver_refuses_enter_without_verified_input() -> None:
    keys = []
    gui = SimpleNamespace(_input=SimpleNamespace(key=lambda key: keys.append(key)))
    live = WechatautoGuiDriver(gui=gui, database=object())
    assert live.press_enter() is False
    assert keys == []


def test_live_driver_refuses_to_destroy_non_text_clipboard(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = SimpleNamespace(
        CF_UNICODETEXT=13,
        OpenClipboard=lambda: None,
        CloseClipboard=lambda: None,
        IsClipboardFormatAvailable=lambda _format: False,
        CountClipboardFormats=lambda: 1,
    )
    monkeypatch.setitem(sys.modules, "win32clipboard", fake)
    live = WechatautoGuiDriver(gui=object(), database=object())

    with pytest.raises(RuntimeError, match="UNSUPPORTED_CLIPBOARD_CONTENT"):
        live.capture_clipboard()

class ExactEdit:
    def __init__(self):
        self.HasKeyboardFocus = False
        self.value = ''
    def GetRuntimeId(self):
        return [1, 42]
    def SetFocus(self):
        self.HasKeyboardFocus = True

class ExactUia:
    def __init__(self):
        self.edit = ExactEdit()
        self.title = 'CELL 联赛群'
    def current_chat(self):
        return self.title
    def _chat_input(self):
        return self.edit
    def _set_text(self, edit, text):
        edit.value = text
        return True
    def _read_edit_value(self, edit):
        return edit.value

def exact_driver():
    uia = ExactUia()
    keys = []
    gui = SimpleNamespace(_get_uia=lambda: uia,
                          _input=SimpleNamespace(key=lambda key: keys.append(key)),
                          input_text=lambda text: pytest.fail('coordinate input must never be used'))
    driver = WechatautoGuiDriver(gui=gui, database=object())
    driver._current = ConversationTarget(stable_id='league@chatroom', title='CELL 联赛群')
    return driver, uia, keys

def test_exact_edit_is_used_for_input_and_one_enter():
    driver, uia, keys = exact_driver()
    assert driver.paste_text('帮助回复')
    assert uia.edit.value == '帮助回复'
    assert driver.press_enter()
    assert keys == [0x0D]

@pytest.mark.parametrize('change', ['title', 'focus', 'text', 'control'])
def test_live_driver_refuses_enter_if_target_changes_after_input(change):
    driver, uia, keys = exact_driver()
    assert driver.paste_text('帮助回复')
    if change == 'title':
        uia.title = 'AI灵感群'
    elif change == 'focus':
        uia.edit.HasKeyboardFocus = False
    elif change == 'text':
        uia.edit.value = '其他内容'
    else:
        uia.edit.GetRuntimeId = lambda: [1, 99]
    assert driver.press_enter() is False
    assert keys == []

def test_live_driver_does_not_overwrite_existing_draft_or_unreadable_edit():
    for value in ['已有草稿', None]:
        driver, uia, keys = exact_driver()
        uia.edit.value = value
        assert driver.paste_text('帮助回复') is False
        assert uia.edit.value == value
        assert keys == []


def test_live_driver_does_not_fallback_when_direct_edit_is_unsupported():
    driver, uia, keys = exact_driver()
    uia._set_text = lambda edit, text: False
    assert driver.paste_text('帮助回复') is False
    assert driver.press_enter() is False
    assert keys == []


def test_live_driver_requires_new_verified_input_for_each_enter():
    driver, uia, keys = exact_driver()
    assert driver.paste_text('帮助回复')
    assert driver.press_enter()
    assert driver.press_enter() is False
    assert keys == [0x0D]


def test_readback_accepts_new_sequence_despite_wechat_clock_behind_windows():
    class Database:
        rows = [{'sort_seq': 1000, 'local_id': 21, 'create_time': 100,
                 'sender_id': 3, 'content': '帮助'}]
        def get_messages(self, stable_id, limit=10):
            return self.rows
    database = Database()
    driver = WechatautoGuiDriver(gui=object(), database=database)
    marker = driver.capture_readback_marker('league@chatroom')
    database.rows = [{'sort_seq': 2000, 'local_id': 22, 'create_time': 101,
                      'sender_id': 2, 'content': '帮助回复'}]
    assert driver.read_back('league@chatroom', '帮助回复', marker, 0) == 'local:2000:22'


def test_readback_rejects_older_identical_reply_even_if_not_in_snapshot():
    class Database:
        rows = [{'sort_seq': 2000, 'local_id': 22, 'sender_id': 3, 'content': '帮助'}]
        def get_messages(self, stable_id, limit=10):
            return self.rows
    database = Database()
    driver = WechatautoGuiDriver(gui=object(), database=database)
    marker = driver.capture_readback_marker('league@chatroom')
    database.rows = [{'sort_seq': 1000, 'local_id': 18, 'create_time': datetime.now(UTC).timestamp(),
                      'sender_id': 2, 'content': '帮助回复'}]
    assert driver.read_back('league@chatroom', '帮助回复', marker, 0) is None


@pytest.mark.parametrize('sender_id,content', [(3, '帮助回复'), (2, '其他正文')])
def test_readback_still_requires_robot_sender_and_exact_content(sender_id, content):
    class Database:
        rows = []
        def get_messages(self, stable_id, limit=10):
            return self.rows
    database = Database()
    driver = WechatautoGuiDriver(gui=object(), database=database)
    marker = driver.capture_readback_marker('league@chatroom')
    database.rows = [{'sort_seq': 2000, 'local_id': 22, 'sender_id': sender_id, 'content': content}]
    assert driver.read_back('league@chatroom', '帮助回复', marker, 0) is None
    assert driver.read_back('other@chatroom', content, marker, 0) is None
