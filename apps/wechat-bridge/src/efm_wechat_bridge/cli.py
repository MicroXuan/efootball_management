from __future__ import annotations

import argparse
import json
import signal
from pathlib import Path

from .api_client import EfmBridgeClient
from .config import BridgeSettings
from .runtime import BridgeRuntime
from .spool import BridgeSpool
from .transport import LiveWechatTransport
from .wechat_gui_sender import WechatGuiSender, WechatautoGuiDriver
from .wechatauto_receiver import WechatautoReceiver
from .windows_session import NativeWindowsProbe, WindowsSessionGuard


def build_runtime(config_path: Path, *, enable_send: bool) -> BridgeRuntime:
    settings = BridgeSettings.from_toml(config_path)
    probe = NativeWindowsProbe()
    guard = WindowsSessionGuard(probe, expected_version=settings.expected_wechat_version)
    receiver = WechatautoReceiver.from_live(
        enabled_group_ids=(),
        robot_user_id="__resolved_by_sender_id__",
        expected_wechat_version=settings.expected_wechat_version,
    )
    driver = WechatautoGuiDriver.from_live()
    sender = WechatGuiSender(
        session_guard=guard,
        driver=driver,
        expected_titles={},
        dry_run=not enable_send,
    )
    transport = LiveWechatTransport(receiver=receiver, sender=sender, session_guard=guard)
    return BridgeRuntime(
        settings=settings,
        spool=BridgeSpool(settings.state_dir / "bridge.sqlite3"),
        api=EfmBridgeClient(settings),
        transport=transport,
        enable_send=enable_send,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="efm-wechat-bridge")
    parser.add_argument("--config", type=Path, default=Path("bridge.toml"))
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("doctor")
    run = subparsers.add_parser("run")
    mode = run.add_mutually_exclusive_group()
    mode.add_argument("--dry-send", action="store_true", default=True)
    mode.add_argument("--enable-send", action="store_true")
    args = parser.parse_args(argv)

    runtime = build_runtime(args.config, enable_send=bool(getattr(args, "enable_send", False)))
    report = runtime.doctor()
    if args.command == "doctor":
        print(json.dumps(report.model_dump(mode="json"), ensure_ascii=False))
        return 0 if report.passed else 2
    if not report.passed:
        return 2
    if args.enable_send and not runtime.settings.send_enabled:
        return 3
    signal.signal(signal.SIGINT, lambda *_: runtime.request_stop())
    signal.signal(signal.SIGTERM, lambda *_: runtime.request_stop())
    runtime.run_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

