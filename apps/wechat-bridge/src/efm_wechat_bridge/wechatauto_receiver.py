from __future__ import annotations

import platform
import re
import json
from collections.abc import Callable, Iterable, Mapping
from datetime import UTC, datetime
from typing import Any, Protocol

from .models import InboundEvent, ObservedGroup, OutboxTask
from .dependency_safety import initialize_wechat_dependency, silence_wechat_logging
from .transport import SendResult, SendStatus, TransportHealth

_BINDING_COMMAND = re.compile(r"^绑定\s+\d{6}$")
_SAFE_ID = re.compile(r"^[A-Za-z0-9_.@:-]{1,256}$")
_TEXT_TYPES = {1, "1", "TEXT", "文本"}


class WechatDatabase(Protocol):
    def get_self_info(self) -> object: ...

    def get_sessions(self, limit: int = 500) -> list[Mapping[str, object]]: ...

    def get_new_messages(
        self,
        username: str,
        since_seq: int,
        limit: int = 200,
    ) -> list[Mapping[str, object]]: ...


class WechatautoReceiver:
    """Fail-closed adapter around the pinned library's local database reader."""

    def __init__(
        self,
        *,
        database: WechatDatabase | object,
        enabled_group_ids: Iterable[str],
        robot_user_id: str,
        expected_wechat_version: str = "4.1.15.13",
        version_provider: Callable[[], str | None] | None = None,
    ) -> None:
        self._database = database
        self._enabled_group_ids = frozenset(enabled_group_ids)
        self._robot_user_id = robot_user_id
        self._expected_wechat_version = expected_wechat_version
        self._version_provider = version_provider
        self._scanned_cursors: dict[str, int] = {}
        self._private_targets: dict[str, str] = {}

    def configure_authorized_groups(self, groups: Mapping[str, str]) -> None:
        self._enabled_group_ids = frozenset(groups)

    @classmethod
    def from_live(
        cls,
        *,
        enabled_group_ids: Iterable[str],
        robot_user_id: str,
        expected_wechat_version: str = "4.1.15.13",
    ) -> "WechatautoReceiver":
        if platform.system() != "Windows":
            raise RuntimeError("WECHAT_TRANSPORT_REQUIRES_WINDOWS")
        try:
            from wechatauto import WeChatDB  # type: ignore[import-not-found]
        except (ImportError, OSError) as error:
            raise RuntimeError("WECHATAUTO_IMPORT_FAILED") from error
        try:
            silence_wechat_logging()
            database = initialize_wechat_dependency(WeChatDB)
        except Exception as error:
            raise RuntimeError("WECHAT_DATABASE_INITIALIZATION_FAILED") from error
        return cls(
            database=database,
            enabled_group_ids=enabled_group_ids,
            robot_user_id=robot_user_id,
            expected_wechat_version=expected_wechat_version,
        )

    def health(self) -> TransportHealth:
        try:
            getter = getattr(self._database, "get_self_info")
            info = getter()
            if not info:
                return self._unhealthy("WECHAT_NOT_LOGGED_IN")
            version = self._version_provider() if self._version_provider else self._expected_wechat_version
            if version != self._expected_wechat_version:
                return self._unhealthy("WECHAT_VERSION_MISMATCH", version=version)
            return TransportHealth(
                ready=True,
                login_status="LOGGED_IN",
                wechat_version=version,
                screen_locked=False,
                database_available=True,
                sender_available=False,
            )
        except Exception:
            return self._unhealthy("WECHAT_DATABASE_UNAVAILABLE")

    def observed_groups(self) -> list[ObservedGroup]:
        sessions = self._sessions()
        groups: dict[str, ObservedGroup] = {}
        for session in sessions:
            username = self._safe_string(session.get("username"))
            if not username or not username.endswith("@chatroom"):
                continue
            display_name = next(
                (
                    value
                    for key in ("nickname", "display_name", "name", "remark")
                    if (value := self._safe_string(session.get(key)))
                ),
                self._nickname(username),
            )
            groups[username] = ObservedGroup(
                wechat_group_id=username,
                display_name=display_name[:128],
            )
        return [groups[key] for key in sorted(groups)]

    def poll(self, after_watermark: str | None) -> list[InboundEvent]:
        cursors = self._parse_cursors(after_watermark)
        rows: list[dict[str, object]] = []
        scanned: dict[str, int] = dict(cursors)
        for session in self._sessions():
            username = self._safe_string(session.get("username"))
            if not username:
                continue
            if username.endswith("@chatroom") and username not in self._enabled_group_ids:
                continue
            cursor = cursors.get(username, cursors.get("*", 0))
            for _ in range(100):
                try:
                    messages = getattr(self._database, "get_new_messages")(
                        username,
                        since_seq=cursor,
                        limit=200,
                    )
                except Exception:
                    break
                page_max = cursor
                for raw in messages:
                    if not isinstance(raw, Mapping):
                        continue
                    row = self._hydrate_raw_message(username, raw)
                    row.setdefault("conversation_id", username)
                    rows.append(row)
                    page_max = max(page_max, self._positive_int(row.get("sort_seq")) or 0)
                if page_max <= cursor:
                    break
                cursor = page_max
                scanned[username] = cursor
                if len(messages) < 200:
                    break

        self._scanned_cursors = {key: value for key, value in scanned.items() if key != "*"}

        unique: dict[str, InboundEvent] = {}
        for raw in rows:
            event = self.normalize(raw)
            if event is not None:
                unique[event.message_id] = event
                if event.conversation_type == "PRIVATE":
                    self._private_targets[event.conversation_id] = self._nickname(event.conversation_id)
        return sorted(unique.values(), key=lambda event: (event.sequence or "", event.message_id))

    def scanned_cursors(self) -> dict[str, int]:
        return dict(self._scanned_cursors)

    def private_targets(self) -> dict[str, str]:
        return dict(self._private_targets)

    def normalize(self, raw: Mapping[str, object]) -> InboundEvent | None:
        conversation_id = self._safe_string(raw.get("conversation_id"))
        message_id = self._safe_string(raw.get("server_id"))
        sender_id = self._safe_string(raw.get("sender_username"))
        raw_sender_id = raw.get("sender_id")
        if (
            not conversation_id
            or not message_id
            or not sender_id
            or not _SAFE_ID.fullmatch(conversation_id)
            or not _SAFE_ID.fullmatch(message_id)
            or not _SAFE_ID.fullmatch(sender_id)
            or sender_id == self._robot_user_id
            or raw_sender_id == 2
            or raw.get("is_self") is True
            or raw.get("type") not in _TEXT_TYPES
        ):
            return None

        group = conversation_id.endswith("@chatroom")
        if group and conversation_id not in self._enabled_group_ids:
            return None
        text = raw.get("content")
        if not isinstance(text, str):
            return None
        text = text.strip()
        if not text or len(text) > 2_000:
            return None
        if not group and not _BINDING_COMMAND.fullmatch(text):
            return None

        sort_seq = self._positive_int(raw.get("sort_seq"))
        sent_at = self._datetime(raw.get("create_time"))
        if sort_seq is None or sent_at is None:
            return None
        return InboundEvent(
            message_id=message_id,
            conversation_type="GROUP" if group else "PRIVATE",
            conversation_id=conversation_id,
            sender_id=sender_id,
            sent_at=sent_at,
            text=text,
            sequence=f"{sort_seq:020d}",
        )

    def send(self, task: OutboxTask) -> SendResult:
        del task
        return SendResult(status=SendStatus.FAILED, error_code="WECHAT_SENDER_NOT_CONFIGURED")

    def _sessions(self) -> list[Mapping[str, object]]:
        try:
            sessions = getattr(self._database, "get_sessions")(limit=500)
        except Exception:
            return []
        return [session for session in sessions if isinstance(session, Mapping)]

    def _nickname(self, username: str) -> str:
        try:
            value = self._safe_string(getattr(self._database, "get_nickname")(username))
        except Exception:
            value = None
        return (value or username)[:128]

    def _hydrate_raw_message(self, username: str, raw: Mapping[str, object]) -> dict[str, object]:
        row = dict(raw)
        if self._safe_string(row.get("server_id")):
            return row
        local_id = self._positive_int(row.get("local_id"))
        if local_id is None:
            return row
        try:
            full = getattr(self._database, "get_message_row")(username, local_id)
        except Exception:
            return row
        if not isinstance(full, Mapping) or self._positive_int(full.get("sort_seq")) != self._positive_int(row.get("sort_seq")):
            return row
        row["server_id"] = full.get("server_id")
        return row

    @classmethod
    def _parse_cursors(cls, value: str | None) -> dict[str, int]:
        if value:
            try:
                raw = json.loads(value)
            except (TypeError, ValueError, json.JSONDecodeError):
                raw = None
            if isinstance(raw, dict):
                parsed: dict[str, int] = {}
                for key, item in raw.items():
                    cursor = cls._positive_int(item)
                    if isinstance(key, str) and cursor is not None:
                        parsed[key] = cursor
                return parsed
        legacy = cls._parse_watermark(value)
        return {"*": legacy} if legacy else {}

    def _unhealthy(self, code: str, *, version: str | None = None) -> TransportHealth:
        return TransportHealth(
            ready=False,
            login_status="UNKNOWN",
            wechat_version=version,
            screen_locked=False,
            database_available=False,
            sender_available=False,
            error_code=code,
            detail=code,
        )

    @staticmethod
    def _parse_watermark(value: str | None) -> int:
        if value is None:
            return 0
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return 0
        return max(0, parsed)

    @staticmethod
    def _safe_string(value: object) -> str | None:
        if not isinstance(value, (str, int)):
            return None
        parsed = str(value).strip()
        return parsed or None

    @staticmethod
    def _positive_int(value: object) -> int | None:
        if isinstance(value, bool):
            return None
        try:
            parsed = int(value)  # type: ignore[arg-type]
        except (TypeError, ValueError, OverflowError):
            return None
        return parsed if parsed >= 0 else None

    @staticmethod
    def _datetime(value: object) -> datetime | None:
        if isinstance(value, datetime):
            return value.astimezone(UTC) if value.tzinfo else None
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            try:
                return datetime.fromtimestamp(value, tz=UTC)
            except (OverflowError, OSError, ValueError):
                return None
        if isinstance(value, str):
            try:
                parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError:
                return None
            return parsed.astimezone(UTC) if parsed.tzinfo else None
        return None
