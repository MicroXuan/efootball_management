from __future__ import annotations

import os
import tomllib
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, SecretStr, model_validator


class BridgeSettings(BaseModel):
    """Validated, fail-closed settings for one Windows Bridge process."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    environment: Literal["development", "test", "production"] = "development"
    api_url: HttpUrl
    device_id: UUID
    state_dir: Path
    expected_wechat_version: str = Field(default="4.1.15.13", min_length=1, max_length=64)
    send_enabled: bool = False
    poll_interval_seconds: float = Field(default=2.0, ge=0.5, le=60.0)
    heartbeat_interval_seconds: float = Field(default=20.0, ge=5.0, le=300.0)
    inbound_batch_size: int = Field(default=50, ge=1, le=100)
    outbox_claim_limit: int = Field(default=20, ge=1, le=50)
    request_timeout_seconds: float = Field(default=15.0, ge=1.0, le=60.0)
    bridge_token: SecretStr = Field(alias="EFM_WECHAT_BRIDGE_TOKEN", min_length=32)

    @model_validator(mode="after")
    def require_production_https(self) -> "BridgeSettings":
        if self.environment == "production" and self.api_url.scheme != "https":
            raise ValueError("production API URL must use HTTPS")
        return self

    @classmethod
    def from_toml(
        cls,
        path: str | Path,
        *,
        environ: Mapping[str, str] | None = None,
    ) -> "BridgeSettings":
        config_path = Path(path)
        with config_path.open("rb") as handle:
            document = tomllib.load(handle)
        raw = document.get("bridge")
        if not isinstance(raw, dict):
            raise ValueError("configuration must contain a [bridge] table")
        forbidden = {"token", "bridge_token", "efm_wechat_bridge_token"}
        present = forbidden.intersection(key.lower() for key in raw)
        if present:
            raise ValueError("[bridge] must not contain a token; use EFM_WECHAT_BRIDGE_TOKEN")

        values: dict[str, Any] = dict(raw)
        state_dir = values.get("state_dir")
        if isinstance(state_dir, str):
            candidate = Path(state_dir).expanduser()
            values["state_dir"] = candidate if candidate.is_absolute() else config_path.parent / candidate
        token = (environ or os.environ).get("EFM_WECHAT_BRIDGE_TOKEN")
        if token is not None:
            values["EFM_WECHAT_BRIDGE_TOKEN"] = token
        return cls.model_validate(values)
