from __future__ import annotations

from dataclasses import replace

from efm_wechat_bridge.windows_session import SessionSnapshot, WindowsSessionGuard


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

