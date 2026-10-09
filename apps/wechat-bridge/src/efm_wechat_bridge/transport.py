from __future__ import annotations

from enum import Enum
from typing import Protocol, runtime_checkable

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .models import InboundEvent, ObservedGroup, OutboxTask


class TransportHealth(BaseModel):
    model_config = ConfigDict(extra="forbid")

    ready: bool
    login_status: str = Field(min_length=1, max_length=32)
    wechat_version: str | None = Field(default=None, max_length=64)
    screen_locked: bool
    database_available: bool
    sender_available: bool
    error_code: str | None = Field(default=None, max_length=64)
    detail: str | None = Field(default=None, max_length=256)

    @model_validator(mode="after")
    def validate_error(self) -> "TransportHealth":
        if self.ready and self.error_code:
            raise ValueError("ready transport cannot have an error code")
        if not self.ready and not self.error_code:
            raise ValueError("unready transport requires an error code")
        return self


class SendStatus(str, Enum):
    SENT = "SENT"
    FAILED = "FAILED"
    AMBIGUOUS = "AMBIGUOUS"


class SendResult(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: SendStatus
    readback_message_id: str | None = Field(default=None, min_length=1, max_length=256)
    error_code: str | None = Field(default=None, min_length=1, max_length=64)

    @model_validator(mode="after")
    def validate_result(self) -> "SendResult":
        if self.status is SendStatus.SENT:
            if not self.readback_message_id or self.error_code:
                raise ValueError("SENT requires readback_message_id and no error_code")
        elif not self.error_code or self.readback_message_id:
            raise ValueError("FAILED and AMBIGUOUS require error_code and no readback_message_id")
        return self


@runtime_checkable
class WechatTransport(Protocol):
    def health(self) -> TransportHealth: ...

    def observed_groups(self) -> list[ObservedGroup]: ...

    def poll(self, after_watermark: str | None) -> list[InboundEvent]: ...

    def send(self, task: OutboxTask) -> SendResult: ...

