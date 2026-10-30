from __future__ import annotations

import subprocess
from types import SimpleNamespace
from dataclasses import replace
from pathlib import Path

from efm_wechat_bridge.windows_session import NativeWindowsProbe, SessionSnapshot, WindowsSessionGuard


class Probe:
    def __init__(self, snapshot: SessionSnapshot) -> None:
        self.snapshot = snapshot
        self.foreground_calls = 0

    def inspect(self) -> SessionSnapshot:
        return self.snapshot

    def foreground_wechat(self) -> bool:
        self.foreground_calls += 1
        return self.snapshot.foregroundable


def healthy() -> SessionSnapshot:
    return SessionSnapshot(
        is_windows=True,
        interactive=True,
        unlocked=True,
        wechat_running=True,
        wechat_visible=True,
        executable_name="Weixin.exe",
        wechat_version="4.1.15.13",
        foregroundable=True,
    )


def test_accepts_only_expected_interactive_unlocked_wechat_session() -> None:
    guard = WindowsSessionGuard(Probe(healthy()), expected_version="4.1.15.13")

    result = guard.check(require_foreground=True)

    assert result.ready is True
    assert result.error_code is None


def test_rejects_non_windows_session_zero_lock_missing_window_and_wrong_version() -> None:
    cases = [
        (replace(healthy(), is_windows=False), "WINDOWS_REQUIRED"),
        (replace(healthy(), interactive=False), "INTERACTIVE_SESSION_REQUIRED"),
        (replace(healthy(), unlocked=False), "WINDOW_SESSION_LOCKED"),
        (replace(healthy(), wechat_running=False), "WECHAT_NOT_RUNNING"),
        (replace(healthy(), wechat_visible=False), "WECHAT_WINDOW_NOT_VISIBLE"),
        (replace(healthy(), executable_name="notepad.exe"), "WECHAT_EXECUTABLE_MISMATCH"),
        (replace(healthy(), wechat_version="4.1.16.0"), "WECHAT_VERSION_MISMATCH"),
    ]

    for snapshot, expected in cases:
        result = WindowsSessionGuard(Probe(snapshot), expected_version="4.1.15.13").check()
        assert result.ready is False
        assert result.error_code == expected


def test_requires_confirmed_foreground_ownership_before_input() -> None:
    probe = Probe(replace(healthy(), foregroundable=False))

    result = WindowsSessionGuard(probe, expected_version="4.1.15.13").check(require_foreground=True)

    assert result.ready is False
    assert result.error_code == "WECHAT_FOREGROUND_FAILED"
    assert probe.foreground_calls == 1


def test_native_probe_requires_active_wts_connection(monkeypatch) -> None:
    monkeypatch.setattr("efm_wechat_bridge.windows_session.platform.system", lambda: "Windows")
    monkeypatch.setattr(NativeWindowsProbe, "_interactive_session", staticmethod(lambda: True))
    monkeypatch.setattr(NativeWindowsProbe, "_session_connected", staticmethod(lambda: False))
    monkeypatch.setattr(NativeWindowsProbe, "_input_desktop_available", staticmethod(lambda: True))
    monkeypatch.setattr(NativeWindowsProbe, "_find_wechat_window", staticmethod(lambda: (None, None)))

    snapshot = NativeWindowsProbe().inspect()

    assert snapshot.interactive is False


def test_file_version_passes_executable_path_over_stdin(monkeypatch) -> None:
    executable = Path(r"D:\my soft\Weixin\Weixin.exe")

    def powershell(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        stdout = "4.1.15.50\n" if kwargs.get("input") == str(executable) else ""
        return subprocess.CompletedProcess(command, 0, stdout=stdout, stderr="")

    monkeypatch.setattr("efm_wechat_bridge.windows_session.subprocess.run", powershell)

    assert NativeWindowsProbe._file_version(executable) == "4.1.15.50"


def test_foreground_probe_handles_64_bit_window_handles_and_win32_failures(monkeypatch) -> None:
    class Function:
        def __init__(self, result=True, *, error: Exception | None = None) -> None:
            self.result = result
            self.error = error
            self.calls: list[tuple[object, ...]] = []

        def __call__(self, *args: object) -> object:
            self.calls.append(args)
            if self.error:
                raise self.error
            return self.result

    handle = 0x000001F234567890
    show = Function()
    activate = Function()
    current = Function(handle)
    user32 = SimpleNamespace(
        ShowWindow=show,
        SetForegroundWindow=activate,
        GetForegroundWindow=current,
    )
    monkeypatch.setattr("efm_wechat_bridge.windows_session.platform.system", lambda: "Windows")
    monkeypatch.setattr(
        "efm_wechat_bridge.windows_session.ctypes.windll",
        SimpleNamespace(user32=user32),
        raising=False,
    )
    probe = NativeWindowsProbe()
    probe._window_handle = handle

    assert probe.foreground_wechat() is True
    assert show.calls == []
    assert activate.calls == []

    current.result = 0
    user32.IsIconic = Function(True)
    user32.SetForegroundWindow = Function(error=OSError("win32 failure"))
    assert probe.foreground_wechat() is False
    assert show.calls[0][0].value == handle


def test_version_cache_invalidates_when_executable_changes(tmp_path, monkeypatch):
    path = tmp_path / 'Weixin.exe'
    path.write_bytes(b'first')
    calls = []
    monkeypatch.setattr(NativeWindowsProbe, '_file_version', staticmethod(lambda p: calls.append(p) or '4.1.15.50'))
    probe = NativeWindowsProbe()
    assert probe._cached_file_version(path) == '4.1.15.50'
    assert probe._cached_file_version(path) == '4.1.15.50'
    assert len(calls) == 1
    path.write_bytes(b'updated-binary')
    assert probe._cached_file_version(path) == '4.1.15.50'
    assert len(calls) == 2


def test_foreground_checks_actual_window_even_if_activation_returns_false(monkeypatch):
    class Fn:
        def __init__(self, fn):
            self.fn = fn
        def __call__(self, *args):
            return self.fn(*args)
    current = [0]
    handle = 0x123456789
    def activate(window):
        current[0] = window.value
        return False
    user32 = SimpleNamespace(
        ShowWindow=Fn(lambda *a: True), IsIconic=Fn(lambda *a: False),
        SetForegroundWindow=Fn(activate), GetForegroundWindow=Fn(lambda: current[0]))
    monkeypatch.setattr('efm_wechat_bridge.windows_session.platform.system', lambda: 'Windows')
    monkeypatch.setattr('efm_wechat_bridge.windows_session.ctypes.windll', SimpleNamespace(user32=user32), raising=False)
    probe = NativeWindowsProbe()
    probe._window_handle = handle
    assert probe.foreground_wechat()


def test_foreground_stays_closed_when_os_refuses_activation(monkeypatch):
    class Fn:
        def __init__(self, result):
            self.result = result
            self.calls = 0
        def __call__(self, *args):
            self.calls += 1
            return self.result
    activate = Fn(False)
    user32 = SimpleNamespace(ShowWindow=Fn(True), IsIconic=Fn(False),
                             SetForegroundWindow=activate, GetForegroundWindow=Fn(10))
    monkeypatch.setattr('efm_wechat_bridge.windows_session.platform.system', lambda: 'Windows')
    monkeypatch.setattr('efm_wechat_bridge.windows_session.ctypes.windll', SimpleNamespace(user32=user32), raising=False)
    monkeypatch.setattr('efm_wechat_bridge.windows_session.time.sleep', lambda seconds: None)
    probe = NativeWindowsProbe()
    probe._window_handle = 20
    assert probe.foreground_wechat() is False
    assert activate.calls == 3
