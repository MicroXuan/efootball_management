from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from efm_wechat_bridge.config import BridgeSettings


def write_config(tmp_path: Path, content: str) -> Path:
    path = tmp_path / "bridge.toml"
    path.write_text(content, encoding="utf-8")
    return path


def valid_config(tmp_path: Path, **overrides: object) -> Path:
    values: dict[str, object] = {
        "environment": "production",
        "api_url": "https://league.example.com",
        "device_id": "11111111-1111-4111-8111-111111111111",
        "state_dir": str(tmp_path / "state"),
    }
    values.update(overrides)
    lines = ["[bridge]"]
    for key, value in values.items():
        rendered = str(value).lower() if isinstance(value, bool) else f'"{value}"'
        if isinstance(value, int | float):
            rendered = str(value)
        lines.append(f"{key} = {rendered}")
    return write_config(tmp_path, "\n".join(lines))


def test_requires_https_in_production_and_accepts_http_for_local_development(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EFM_WECHAT_BRIDGE_TOKEN", "x" * 32)
    with pytest.raises(ValidationError, match="HTTPS"):
        BridgeSettings.from_toml(valid_config(tmp_path, api_url="http://league.example.com"))

    settings = BridgeSettings.from_toml(
        valid_config(tmp_path, environment="development", api_url="http://127.0.0.1:3000")
    )
    assert str(settings.api_url).rstrip("/") == "http://127.0.0.1:3000"


def test_requires_opaque_device_id_and_token_from_environment(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("EFM_WECHAT_BRIDGE_TOKEN", raising=False)
    with pytest.raises(ValidationError, match="EFM_WECHAT_BRIDGE_TOKEN"):
        BridgeSettings.from_toml(valid_config(tmp_path))

    monkeypatch.setenv("EFM_WECHAT_BRIDGE_TOKEN", "secret-token-" + "y" * 32)
    with pytest.raises(ValidationError, match="device_id"):
        BridgeSettings.from_toml(valid_config(tmp_path, device_id="friendly-device-name"))

    with pytest.raises(ValueError, match="must not contain"):
        BridgeSettings.from_toml(write_config(tmp_path, """
[bridge]
environment = "production"
api_url = "https://league.example.com"
device_id = "11111111-1111-4111-8111-111111111111"
state_dir = "state"
token = "do-not-store-this"
"""))


def test_defaults_to_send_disabled_and_enforces_safe_bounds(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EFM_WECHAT_BRIDGE_TOKEN", "z" * 32)
    settings = BridgeSettings.from_toml(valid_config(tmp_path))
    assert settings.send_enabled is False
    assert settings.poll_interval_seconds == 2.0
    assert settings.inbound_batch_size == 50
    assert settings.outbox_claim_limit == 20

    for field, value in [
        ("poll_interval_seconds", 0.1),
        ("inbound_batch_size", 101),
        ("outbox_claim_limit", 51),
    ]:
        with pytest.raises(ValidationError):
            BridgeSettings.from_toml(valid_config(tmp_path, **{field: value}))
