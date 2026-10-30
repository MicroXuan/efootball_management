from __future__ import annotations

import platform
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Protocol

from .models import OutboxTask
from .dependency_safety import initialize_wechat_dependency, silence_wechat_logging
from .transport import SendResult, SendStatus
from .windows_session import SessionCheck


@dataclass(frozen=True, slots=True)
class ConversationTarget:
    stable_id: str
    title: str


class SenderSessionGuard(Protocol):
    def check(self, *, require_foreground: bool = False) -> SessionCheck: ...


class GuiDriver(Protocol):
    def resolve_exact(self, stable_id: str) -> ConversationTarget | None: ...

    def open_exact(self, target: ConversationTarget) -> bool: ...

    def current_title(self) -> str | None: ...

    def capture_clipboard(self) -> object: ...

    def restore_clipboard(self, value: object) -> None: ...

    def capture_readback_marker(self, stable_id: str) -> object: ...

    def paste_text(self, text: str) -> bool: ...

    def press_enter(self) -> bool: ...

    def read_back(
        self,
        stable_id: str,
        text: str,
        marker: object,
        timeout_seconds: float,
    ) -> str | None: ...


class WechatGuiSender:
    _send_lock = threading.Lock()

    def __init__(
        self,
        *,
        session_guard: SenderSessionGuard,
        driver: GuiDriver,
        expected_titles: Mapping[str, str],
        dry_run: bool = False,
        readback_timeout_seconds: float = 8.0,
    ) -> None:
        self._session_guard = session_guard
        self._driver = driver
        self._expected_titles = dict(expected_titles)
        self._authorized_private_targets: dict[str, str] = {}
        self._dry_run = dry_run
        self._readback_timeout_seconds = readback_timeout_seconds

    def configure_authorized_groups(self, groups: Mapping[str, str]) -> None:
        self._expected_titles = dict(groups)

    def configure_authorized_private_targets(self, targets: Mapping[str, str]) -> None:
        self._authorized_private_targets = dict(targets)

    def send(self, task: OutboxTask) -> SendResult:
        with self._send_lock:
            return self._send_serial(task)

    def _send_serial(self, task: OutboxTask) -> SendResult:
        session = self._session_guard.check(require_foreground=True)
        if not session.ready:
            return SendResult(status=SendStatus.FAILED, error_code=session.error_code)

        expected_title = (
            self._expected_titles.get(task.target_id)
            if task.target_type == "GROUP"
            else self._authorized_private_targets.get(task.target_id)
        )
        if not expected_title:
            return SendResult(status=SendStatus.FAILED, error_code="CONVERSATION_NOT_AUTHORIZED")
        target = self._driver.resolve_exact(task.target_id)
        if target is None or target.stable_id != task.target_id:
            return SendResult(status=SendStatus.FAILED, error_code="CONVERSATION_NOT_FOUND")
        if target.title != expected_title:
            return SendResult(status=SendStatus.FAILED, error_code="CONVERSATION_TITLE_MISMATCH")
        if not self._driver.open_exact(target):
            return SendResult(status=SendStatus.FAILED, error_code="CONVERSATION_OPEN_FAILED")
        if self._driver.current_title() != expected_title:
            return SendResult(status=SendStatus.FAILED, error_code="CONVERSATION_TITLE_MISMATCH")
        if self._dry_run:
            return SendResult(status=SendStatus.FAILED, error_code="DRY_RUN_CONFIRMED")

        try:
            marker = self._driver.capture_readback_marker(task.target_id)
        except Exception:
            return SendResult(status=SendStatus.FAILED, error_code="READBACK_MARKER_UNAVAILABLE")
        try:
            clipboard = self._driver.capture_clipboard()
        except Exception as error:
            code = (
                "CLIPBOARD_CONTENT_UNSUPPORTED"
                if isinstance(error, RuntimeError) and str(error) == "UNSUPPORTED_CLIPBOARD_CONTENT"
                else "CLIPBOARD_CAPTURE_FAILED"
            )
            return SendResult(status=SendStatus.FAILED, error_code=code)

        entered = False
        try:
            if not self._driver.paste_text(task.text):
                return SendResult(status=SendStatus.FAILED, error_code="WECHAT_INPUT_FAILED")
            entered = True
            try:
                pressed = self._driver.press_enter()
            except Exception:
                pressed = False
            if not pressed and not entered:
                return SendResult(status=SendStatus.FAILED, error_code="WECHAT_ENTER_FAILED")
            try:
                readback_id = self._driver.read_back(
                    task.target_id,
                    task.text,
                    marker,
                    self._readback_timeout_seconds,
                )
            except Exception:
                readback_id = None
            if readback_id:
                return SendResult(status=SendStatus.SENT, readback_message_id=readback_id)
            return SendResult(status=SendStatus.AMBIGUOUS, error_code="WECHAT_SEND_UNCONFIRMED")
        finally:
            try:
                self._driver.restore_clipboard(clipboard)
            except Exception:
                pass


class WechatautoGuiDriver:
    """Pinned wechatauto GUI/database adapter, imported only on Windows."""

    def __init__(
        self,
        *,
        gui: object,
        database: object,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._gui = gui
        self._database = database
        self._sleep = sleep
        self._current: ConversationTarget | None = None
        self._prepared_input: tuple[tuple[int, ...], str] | None = None

    @classmethod
    def from_live(cls) -> "WechatautoGuiDriver":
        if platform.system() != "Windows":
            raise RuntimeError("WECHAT_SENDER_REQUIRES_WINDOWS")
        try:
            from wechatauto import WeChatDB  # type: ignore[import-not-found]
            from wechatauto.guia import WeChatGUI  # type: ignore[import-not-found]
        except (ImportError, OSError) as error:
            raise RuntimeError("WECHATAUTO_IMPORT_FAILED") from error
        try:
            silence_wechat_logging()
            gui = initialize_wechat_dependency(WeChatGUI)
            database = initialize_wechat_dependency(WeChatDB)
            return cls(gui=gui, database=database)
        except Exception as error:
            raise RuntimeError("WECHAT_SENDER_INITIALIZATION_FAILED") from error

    def resolve_exact(self, stable_id: str) -> ConversationTarget | None:
        try:
            title = str(getattr(self._database, "get_nickname")(stable_id) or "").strip()
            matches = getattr(self._database, "search_contact")(title)
        except Exception:
            return None
        exact_ids = {
            str(item.get("username") or "")
            for item in matches
            if isinstance(item, dict)
            and title
            and title in {
                str(item.get("remark") or "").strip(),
                str(item.get("nick_name") or "").strip(),
            }
        }
        if exact_ids != {stable_id}:
            return None
        return ConversationTarget(stable_id=stable_id, title=title)

    def open_exact(self, target: ConversationTarget) -> bool:
        self._prepared_input = None
        self._current = None
        try:
            uia = getattr(self._gui, "_get_uia")()
            opened = bool(uia and (uia.current_chat() == target.title or uia.open_chat(target.title))
                          and uia.current_chat() == target.title)
        except Exception:
            return False
        self._prepared_input = None
        self._current = target if opened else None
        return opened

    def current_title(self) -> str | None:
        if self._current is None:
            return None
        try:
            uia = getattr(self._gui, "_get_uia")()
            actual = str(uia.current_chat() or "").strip() if uia else ""
            return actual if actual == self._current.title else None
        except Exception:
            return None

    def capture_clipboard(self) -> object:
        import win32clipboard  # type: ignore[import-not-found]

        win32clipboard.OpenClipboard()
        try:
            if win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_UNICODETEXT):
                return ("text", win32clipboard.GetClipboardData(win32clipboard.CF_UNICODETEXT))
            if win32clipboard.CountClipboardFormats():
                raise RuntimeError("UNSUPPORTED_CLIPBOARD_CONTENT")
            return ("empty", None)
        finally:
            win32clipboard.CloseClipboard()

    def restore_clipboard(self, value: object) -> None:
        import win32clipboard  # type: ignore[import-not-found]

        kind, content = value if isinstance(value, tuple) and len(value) == 2 else ("empty", None)
        win32clipboard.OpenClipboard()
        try:
            win32clipboard.EmptyClipboard()
            if kind == "text" and isinstance(content, str):
                win32clipboard.SetClipboardText(content, win32clipboard.CF_UNICODETEXT)
        finally:
            win32clipboard.CloseClipboard()

    def capture_readback_marker(self, stable_id: str) -> object:
        try:
            rows = getattr(self._database, "get_messages")(stable_id, limit=10)
        except Exception as error:
            raise RuntimeError("READBACK_MARKER_UNAVAILABLE") from error
        return {
            "target_id": stable_id,
            "identities": {
                (int(row.get("sort_seq") or 0), int(row.get("local_id") or 0))
                for row in rows
                if isinstance(row, dict)
            },
        }

    def _exact_edit(self):
        # Never fall back to OCR/coordinate input after checking a UIA title.
        if self._current is None:
            return None
        uia = getattr(self._gui, "_get_uia")()
        if uia is None or uia.current_chat() != self._current.title:
            return None
        edit = uia._chat_input()
        if edit is None:
            return None
        identity = tuple(edit.GetRuntimeId())
        if not identity:
            return None
        return uia, edit, identity

    def paste_text(self, text: str) -> bool:
        self._prepared_input = None
        try:
            exact = self._exact_edit()
            if exact is None:
                return False
            uia, edit, identity = exact
            # Unknown content is not an empty draft; never overwrite a user's text.
            if uia._read_edit_value(edit) != "":
                return False
            edit.SetFocus()
            current = self._exact_edit()
            if current is None or current[2] != identity or not edit.HasKeyboardFocus:
                return False
            # ValuePattern targets this control directly, with no global paste,
            # coordinate click, pinyin fallback or implicit Enter.
            if not uia._set_text(edit, text):
                return False
            current = self._exact_edit()
            if (current is None or current[2] != identity
                    or not edit.HasKeyboardFocus or uia._read_edit_value(edit) != text):
                return False
            self._prepared_input = (identity, text)
            return True
        except Exception:
            return False

    def press_enter(self) -> bool:
        prepared = self._prepared_input
        self._prepared_input = None
        try:
            exact = self._exact_edit()
            if prepared is None or exact is None:
                return False
            uia, edit, identity = exact
            if (identity != prepared[0] or not edit.HasKeyboardFocus
                    or uia._read_edit_value(edit) != prepared[1]):
                return False
            getattr(self._gui, "_input").key(0x0D)
            return True
        except Exception:
            return False

    def read_back(
        self,
        stable_id: str,
        text: str,
        marker: object,
        timeout_seconds: float,
    ) -> str | None:
        if not isinstance(marker, dict) or marker.get("target_id") != stable_id:
            return None
        previous = marker.get("identities")
        if not isinstance(previous, set):
            return None
        # WeChat timestamps and the Windows wall clock can differ. Compare the
        # target conversation's sequence watermark, never unrelated clocks.
        watermark = max(previous, default=(0, 0))
        deadline = time.monotonic() + timeout_seconds
        while True:
            try:
                rows = getattr(self._database, "get_messages")(stable_id, limit=10)
            except Exception:
                rows = []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                identity = (int(row.get("sort_seq") or 0), int(row.get("local_id") or 0))
                if (
                    identity in previous
                    or identity <= watermark
                    or row.get("sender_id") != 2
                    or row.get("content") != text
                ):
                    continue
                server_id = str(row.get("server_id") or "").strip()
                return server_id or f"local:{identity[0]}:{identity[1]}"
            if time.monotonic() >= deadline:
                return None
            self._sleep(min(0.5, max(0.0, deadline - time.monotonic())))
