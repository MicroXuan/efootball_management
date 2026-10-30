"""Windows-only, no-message diagnostic: locate target, then detect a manual switch."""
import argparse
import json
import time
import tomllib
from datetime import UTC, datetime
from pathlib import Path

from efm_wechat_bridge.wechat_gui_sender import WechatautoGuiDriver
from efm_wechat_bridge.windows_session import NativeWindowsProbe, WindowsSessionGuard


def log(event, **fields):
    print(json.dumps({'at': datetime.now(UTC).isoformat(), 'event': event, **fields}, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=Path('bridge.toml'))
    parser.add_argument('--target-id', required=True)
    parser.add_argument('--expected-title', required=True)
    args = parser.parse_args()
    config = tomllib.loads(args.config.read_text(encoding='utf-8'))['bridge']
    log('no_send_check_started')
    probe = NativeWindowsProbe()
    guard = WindowsSessionGuard(probe, expected_version=config['expected_wechat_version'])
    session = guard.check(require_foreground=True)
    log('foreground', passed=session.ready, code=session.error_code)
    if not session.ready:
        return 2
    driver = WechatautoGuiDriver.from_live()
    target = driver.resolve_exact(args.target_id)
    if target is None or target.title != args.expected_title:
        log('target_identity', passed=False)
        return 2
    started = time.monotonic()
    opened = driver.open_exact(target)
    exact = driver._exact_edit() if opened else None
    log('target_located', passed=exact is not None, title=driver.current_title(),
        duration_ms=round((time.monotonic() - started) * 1000))
    if exact is None:
        return 2
    uia, edit, _ = exact
    value = uia._read_edit_value(edit)
    pattern = edit.GetValuePattern()
    log('input_capability', readable=value is not None, empty=value == '',
        writable=pattern is not None and not pattern.IsReadOnly)
    log('switch_to_other_chat_now', wait_seconds=20)
    time.sleep(20)
    rejected = driver._exact_edit() is None
    log('other_chat_rejected', passed=rejected)
    log('finished', note='No message text entered and no send key invoked')
    return 0 if rejected else 2


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        log('diagnostic_failed', error_type=type(error).__name__)
        raise SystemExit(2)
