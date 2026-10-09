from __future__ import annotations

from collections import deque
from collections.abc import Iterable

from .models import InboundEvent, ObservedGroup, OutboxTask
from .transport import SendResult, SendStatus, TransportHealth


class FakeWechatTransport:
    """Deterministic transport used by runtime tests without importing Windows libraries."""

    def __init__(
        self,
        *,
        health: TransportHealth | None = None,
        groups: Iterable[ObservedGroup] = (),
        inbound: Iterable[InboundEvent] = (),
        send_results: Iterable[SendResult] = (),
        robot_user_id: str = "robot-wxid",
    ) -> None:
        self._health = health or TransportHealth(
            ready=True,
            login_status="LOGGED_IN",
            wechat_version="4.1.15.13",
            screen_locked=False,
            database_available=True,
            sender_available=True,
        )
        self._groups = list(groups)
        self._inbound = list(inbound)
        self._send_results = deque(send_results)
        self._robot_user_id = robot_user_id
        self.sent_tasks: list[OutboxTask] = []

    def set_health(self, health: TransportHealth) -> None:
        self._health = health

    def inject_inbound(self, event: InboundEvent) -> None:
        self._inbound.append(event)

    def inject_send_result(self, result: SendResult) -> None:
        self._send_results.append(result)

    def health(self) -> TransportHealth:
        return self._health.model_copy(deep=True)

    def observed_groups(self) -> list[ObservedGroup]:
        unique = {group.wechat_group_id: group for group in self._groups}
        return [unique[key].model_copy(deep=True) for key in sorted(unique)]

    def poll(self, after_watermark: str | None) -> list[InboundEvent]:
        return sorted(
            (
                event.model_copy(deep=True)
                for event in self._inbound
                if event.sender_id != self._robot_user_id
                and (after_watermark is None or (event.sequence or "") > after_watermark)
            ),
            key=lambda event: (event.sequence or "", event.message_id),
        )

    def send(self, task: OutboxTask) -> SendResult:
        self.sent_tasks.append(task.model_copy(deep=True))
        if self._send_results:
            return self._send_results.popleft().model_copy(deep=True)
        return SendResult(status=SendStatus.FAILED, error_code="FAKE_SEND_RESULT_MISSING")

