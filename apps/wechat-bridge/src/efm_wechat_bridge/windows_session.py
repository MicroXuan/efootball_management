from __future__ import annotations

import ctypes
import os
import platform
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from pydantic import BaseModel, ConfigDict, Field, model_validator


@dataclass(frozen=True, slots=True)
class SessionSnapshot:
    is_windows: bool
    interactive: bool
    unlocked: bool
    wechat_running: bool
    wechat_visible: bool
    executable_name: str | None
    wechat_version: str | None
    foregroundable: bool


class SessionCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ready: bool
    error_code: str | None = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def validate_result(self) -> "SessionCheck":
        if self.ready == bool(self.error_code):
            raise ValueError("ready checks have no error; failed checks require an error")
        return self


class SessionProbe(Protocol):
    def inspect(self) -> SessionSnapshot: ...

    def foreground_wechat(self) -> bool: ...


class WindowsSessionGuard:
    def __init__(self, probe: SessionProbe, *, expected_version: str) -> None:
        self._probe = probe
        self._expected_version = expected_version

    def check(self, *, require_foreground: bool = False) -> SessionCheck:
        snapshot = self._probe.inspect()
        checks = (
            (snapshot.is_windows, "WINDOWS_REQUIRED"),
            (snapshot.interactive, "INTERACTIVE_SESSION_REQUIRED"),
            (snapshot.unlocked, "WINDOW_SESSION_LOCKED"),
            (snapshot.wechat_running, "WECHAT_NOT_RUNNING"),
            (snapshot.wechat_visible, "WECHAT_WINDOW_NOT_VISIBLE"),
            (
                snapshot.executable_name is not None
                and snapshot.executable_name.lower() in {"weixin.exe", "wechat.exe"},
                "WECHAT_EXECUTABLE_MISMATCH",
            ),
            (snapshot.wechat_version == self._expected_version, "WECHAT_VERSION_MISMATCH"),
        )
        for valid, code in checks:
            if not valid:
                return SessionCheck(ready=False, error_code=code)
        if require_foreground and not self._probe.foreground_wechat():
            return SessionCheck(ready=False, error_code="WECHAT_FOREGROUND_FAILED")
        return SessionCheck(ready=True)


class NativeWindowsProbe:
    """Small Win32 probe with no import-time Windows dependency."""

    def __init__(self) -> None:
        self._window_handle: int | None = None
        self._process_path: Path | None = None

    def inspect(self) -> SessionSnapshot:
        if platform.system() != "Windows":
            return SessionSnapshot(False, False, False, False, False, None, None, False)
        interactive = self._interactive_session() and self._session_connected()
        unlocked = self._input_desktop_available()
        window, process_path = self._find_wechat_window()
        self._window_handle = window
        self._process_path = process_path
        executable = process_path.name if process_path else None
        version = self._file_version(process_path) if process_path else None
        visible = bool(window)
        return SessionSnapshot(
            is_windows=True,
            interactive=interactive,
            unlocked=unlocked,
            wechat_running=process_path is not None,
            wechat_visible=visible,
            executable_name=executable,
            wechat_version=version,
            foregroundable=visible and unlocked,
        )

    def foreground_wechat(self) -> bool:
        if not self._window_handle or platform.system() != "Windows":
            return False
        user32 = ctypes.windll.user32
        user32.ShowWindow(self._window_handle, 9)
        if not user32.SetForegroundWindow(self._window_handle):
            return False
        return int(user32.GetForegroundWindow()) == self._window_handle

    @staticmethod
    def _interactive_session() -> bool:
        session_id = ctypes.c_uint(0)
        ok = ctypes.windll.kernel32.ProcessIdToSessionId(os.getpid(), ctypes.byref(session_id))
        return bool(ok) and session_id.value != 0

    @staticmethod
    def _session_connected() -> bool:
        session_id = ctypes.c_uint(0)
        kernel32 = ctypes.windll.kernel32
        if not kernel32.ProcessIdToSessionId(os.getpid(), ctypes.byref(session_id)):
            return False
        buffer = ctypes.c_void_p()
        size = ctypes.c_ulong(0)
        # WTS_CURRENT_SERVER_HANDLE, WTSConnectState; WTSActive == 0.
        wtsapi32 = ctypes.windll.wtsapi32
        ok = wtsapi32.WTSQuerySessionInformationW(
            0,
            session_id.value,
            8,
            ctypes.byref(buffer),
            ctypes.byref(size),
        )
        if not ok or not buffer.value or size.value < ctypes.sizeof(ctypes.c_int):
            return False
        try:
            return ctypes.cast(buffer, ctypes.POINTER(ctypes.c_int)).contents.value == 0
        finally:
            wtsapi32.WTSFreeMemory(buffer)

    @staticmethod
    def _input_desktop_available() -> bool:
        user32 = ctypes.windll.user32
        desktop = user32.OpenInputDesktop(0, False, 0x0100)
        if not desktop:
            return False
        user32.CloseDesktop(desktop)
        return True

    @staticmethod
    def _find_wechat_window() -> tuple[int | None, Path | None]:
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
        found: list[tuple[int, Path]] = []
        callback_type = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)

        def visit(hwnd: int, _: int) -> bool:
            if not user32.IsWindowVisible(hwnd):
                return True
            pid = ctypes.c_ulong()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            handle = kernel32.OpenProcess(0x1000, False, pid.value)
            if not handle:
                return True
            try:
                size = ctypes.c_ulong(32768)
                buffer = ctypes.create_unicode_buffer(size.value)
                if kernel32.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
                    path = Path(buffer.value)
                    if path.name.lower() in {"weixin.exe", "wechat.exe"}:
                        found.append((int(hwnd), path))
                        return False
            finally:
                kernel32.CloseHandle(handle)
            return True

        callback = callback_type(visit)
        user32.EnumWindows(callback, 0)
        return found[0] if found else (None, None)

    @staticmethod
    def _file_version(path: Path) -> str | None:
        command = [
            "powershell.exe",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "(Get-Item -LiteralPath $args[0]).VersionInfo.FileVersion",
            str(path),
        ]
        try:
            completed = subprocess.run(command, capture_output=True, text=True, timeout=5, check=False)
        except (OSError, subprocess.SubprocessError):
            return None
        value = completed.stdout.strip()
        return value if completed.returncode == 0 and value else None
