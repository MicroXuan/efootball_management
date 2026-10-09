from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

StableId = Annotated[str, Field(min_length=1, max_length=256)]
DisplayName = Annotated[str, Field(min_length=1, max_length=128)]
MessageText = Annotated[str, Field(min_length=1, max_length=2_000)]


class BridgeModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class AwareDateTimeModel(BridgeModel):
    @model_validator(mode="after")
    def require_timezone(self) -> "AwareDateTimeModel":
        for field_name in type(self).model_fields:
            value = getattr(self, field_name)
            if isinstance(value, datetime) and value.tzinfo is None:
                raise ValueError(f"{field_name} must include a timezone")
        return self


class ObservedGroup(BridgeModel):
    wechat_group_id: StableId
    display_name: DisplayName


class InboundEvent(AwareDateTimeModel):
    message_id: StableId
    conversation_type: Literal["GROUP", "PRIVATE"]
    conversation_id: StableId
    sender_id: StableId
    sent_at: datetime
    message_type: Literal["TEXT"] = "TEXT"
    text: MessageText
    sequence: Annotated[str, Field(min_length=1, max_length=128)] | None = None


class OutboxTask(AwareDateTimeModel):
    id: UUID
    kind: Literal["TEXT"] = "TEXT"
    target_type: Literal["GROUP", "PRIVATE"]
    target_id: StableId
    text: MessageText
    priority: int = Field(ge=0, le=1_000)
    scheduled_at: datetime


class SendAck(BridgeModel):
    status: Literal["SENT", "FAILED", "AMBIGUOUS"]
    readback_message_id: StableId | None = None
    error_code: Annotated[str, Field(min_length=1, max_length=64)] | None = None
    error_message: Annotated[str, Field(min_length=1, max_length=512)] | None = None

    @model_validator(mode="after")
    def require_status_fields(self) -> "SendAck":
        if self.status == "SENT":
            if not self.readback_message_id:
                raise ValueError("SENT acknowledgement requires readback_message_id")
            if self.error_code or self.error_message:
                raise ValueError("SENT acknowledgement cannot contain error fields")
        else:
            if not self.error_code or not self.error_message:
                raise ValueError("non-SENT acknowledgement requires error_code and error_message")
            if self.readback_message_id:
                raise ValueError("non-SENT acknowledgement cannot contain readback_message_id")
        return self
