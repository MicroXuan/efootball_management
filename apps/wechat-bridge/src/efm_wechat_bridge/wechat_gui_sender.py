from __future__ import annotations

import platform
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Protocol

from .models import OutboxTask
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
        self._dry_run = dry_run
        self._readback_timeout_seconds = readback_timeout_seconds

    def configure_authorized_groups(self, groups: Mapping[str, str]) -> None:
        self._expected_titles = dict(groups)

    def send(self, task: OutboxTask) -> SendResult:
        with self._send_lock:
            return self._send_serial(task)

    def _send_serial(self, task: OutboxTask) -> SendResult:
        session = self._session_guard.check(require_foreground=True)
        if not session.ready:
            return SendResult(status=SendStatus.FAILED, error_code=session.error_code)

        expected_title = self._expected_titles.get(task.target_id)
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
            clipboard = self._driver.capture_clipboard()
        except Exception:
            return SendResult(status=SendStatus.FAILED, error_code="SEND_PREPARATION_FAILED")

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
            return cls(gui=WeChatGUI(), database=WeChatDB())
        except Exception as error:
            raise RuntimeError("WECHAT_SENDER_INITIALIZATION_FAILED") from error

    def resolve_exact(self, stable_id: str) -> ConversationTarget | None:
        try:
            sessions = getattr(self._database, "get_sessions")(limit=500)
        except Exception:
            return None
        for session in sessions:
            if not isinstance(session, dict) or str(session.get("username") or "") != stable_id:
                continue
            title = next(
                (
                    str(session[key]).strip()
                    for key in ("nickname", "display_name", "name", "remark")
                    if session.get(key) and str(session[key]).strip()
                ),
                None,
            )
            return ConversationTarget(stable_id=stable_id, title=title) if title else None
        return None

    def open_exact(self, target: ConversationTarget) -> bool:
        try:
            opened = bool(getattr(self._gui, "open_chat")(target.title, exact=True))
        except Exception:
            return False
        self._current = target if opened else None
        return opened

    def current_title(self) -> str | None:
        if self._current is None:
            return None
        try:
            checker = getattr(self._gui, "_chat_is_open")
            return self._current.title if checker(self._current.title) else None
        except Exception:
            return None

    def capture_clipboard(self) -> object:
        import win32clipboard  # type: ignore[import-not-found]

        win32clipboard.OpenClipboard()
        try:
            if win32clipboard.IsClipboardFormatAvailable(win32clipboard.CF_UNICODETEXT):
                return ("text", win32clipboard.GetClipboardData(win32clipboard.CF_UNICODETEXT))
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
        except Exception:
            rows = []
        return {
            (int(row.get("sort_seq") or 0), int(row.get("local_id") or 0))
            for row in rows
            if isinstance(row, dict)
        }

    def paste_text(self, text: str) -> bool:
        try:
            return bool(getattr(self._gui, "input_text")(text))
        except Exception:
            return False

    def press_enter(self) -> bool:
        return bool(getattr(self._gui, "click_send")())

    def read_back(
        self,
        stable_id: str,
        text: str,
        marker: object,
        timeout_seconds: float,
    ) -> str | None:
        previous = marker if isinstance(marker, set) else set()
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
                if identity in previous or row.get("sender_id") != 2 or row.get("content") != text:
                    continue
                server_id = str(row.get("server_id") or "").strip()
                return server_id or f"local:{identity[0]}:{identity[1]}"
            if time.monotonic() >= deadline:
                return None
            self._sleep(min(0.5, max(0.0, deadline - time.monotonic())))
