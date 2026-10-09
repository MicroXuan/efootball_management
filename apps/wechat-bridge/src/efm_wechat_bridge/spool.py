from __future__ import annotations

import sqlite3
import json
from collections.abc import Iterable
from contextlib import closing
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal
from uuid import UUID

from .models import InboundEvent, OutboxTask, SendAck

OutboxLocalStatus = Literal["PENDING", "IN_FLIGHT", "AMBIGUOUS", "COMPLETED"]


@dataclass(frozen=True, slots=True)
class OutboxRecord:
    task: OutboxTask
    status: OutboxLocalStatus
    readback_message_id: str | None
    last_error_code: str | None
    completed_at: datetime | None


@dataclass(frozen=True, slots=True)
class SpoolHealthSnapshot:
    pending_inbound: int
    pending_outbox: int
    ambiguous_outbox: int
    watermark: str | None


class BridgeSpool:
    """Durable delivery state with one short SQLite transaction per operation."""

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._bootstrap()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=5.0, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA busy_timeout = 5000")
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def _bootstrap(self) -> None:
        with closing(self._connect()) as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute("PRAGMA synchronous = FULL")
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS inbound_spool (
                    message_id TEXT PRIMARY KEY,
                    sort_key TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'ACKED')),
                    created_at TEXT NOT NULL,
                    acked_at TEXT
                );
                CREATE INDEX IF NOT EXISTS inbound_spool_pending_order_idx
                    ON inbound_spool(status, sort_key, message_id);

                CREATE TABLE IF NOT EXISTS outbox_spool (
                    task_id TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'PENDING'
                        CHECK (status IN ('PENDING', 'IN_FLIGHT', 'AMBIGUOUS', 'COMPLETED')),
                    readback_message_id TEXT,
                    last_error_code TEXT,
                    created_at TEXT NOT NULL,
                    completed_at TEXT
                );
                CREATE INDEX IF NOT EXISTS outbox_spool_status_created_idx
                    ON outbox_spool(status, created_at);

                CREATE TABLE IF NOT EXISTS bridge_metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
            """)

            definition = connection.execute(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='outbox_spool'"
            ).fetchone()
            if definition and "IN_FLIGHT" not in str(definition[0]):
                connection.executescript("""
                    ALTER TABLE outbox_spool RENAME TO outbox_spool_legacy;
                    CREATE TABLE outbox_spool (
                        task_id TEXT PRIMARY KEY,
                        payload_json TEXT NOT NULL,
                        status TEXT NOT NULL DEFAULT 'PENDING'
                            CHECK (status IN ('PENDING', 'IN_FLIGHT', 'AMBIGUOUS', 'COMPLETED')),
                        readback_message_id TEXT,
                        last_error_code TEXT,
                        created_at TEXT NOT NULL,
                        completed_at TEXT
                    );
                    INSERT INTO outbox_spool SELECT * FROM outbox_spool_legacy;
                    DROP TABLE outbox_spool_legacy;
                    CREATE INDEX outbox_spool_status_created_idx
                        ON outbox_spool(status, created_at);
                """)

    def append_inbound(self, event: InboundEvent, *, sort_key: str) -> bool:
        if not sort_key:
            raise ValueError("sort_key must not be empty")
        now = datetime.now(UTC).isoformat()
        with closing(self._connect()) as connection:
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO inbound_spool
                    (message_id, sort_key, payload_json, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (event.message_id, sort_key, event.model_dump_json(), now),
            )
            return cursor.rowcount == 1

    def pending_inbound(self, *, limit: int) -> list[InboundEvent]:
        if not 1 <= limit <= 100:
            raise ValueError("limit must be between 1 and 100")
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """
                SELECT payload_json FROM inbound_spool
                WHERE status = 'PENDING'
                ORDER BY sort_key ASC, message_id ASC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [InboundEvent.model_validate_json(row["payload_json"]) for row in rows]

    def ack_inbound(self, message_ids: Iterable[str], *, watermark: str) -> int:
        unique_ids = tuple(dict.fromkeys(message_ids))
        if not unique_ids:
            return 0
        if not watermark:
            raise ValueError("watermark must not be empty")
        placeholders = ",".join("?" for _ in unique_ids)
        now = datetime.now(UTC).isoformat()
        with closing(self._connect()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            try:
                present = connection.execute(
                    f"SELECT COUNT(*) FROM inbound_spool WHERE message_id IN ({placeholders})",
                    unique_ids,
                ).fetchone()[0]
                if present != len(unique_ids):
                    raise ValueError("cannot acknowledge unknown inbound messages")
                cursor = connection.execute(
                    f"""
                    UPDATE inbound_spool SET status = 'ACKED', acked_at = ?
                    WHERE message_id IN ({placeholders}) AND status = 'PENDING'
                    """,
                    (now, *unique_ids),
                )
                connection.execute(
                    """
                    INSERT INTO bridge_metadata(key, value, updated_at)
                    VALUES ('listener_watermark', ?, ?)
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                    """,
                    (watermark, now),
                )
                connection.execute("COMMIT")
                return cursor.rowcount
            except BaseException:
                connection.execute("ROLLBACK")
                raise

    def watermark(self) -> str | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT value FROM bridge_metadata WHERE key = 'listener_watermark'"
            ).fetchone()
        return str(row["value"]) if row else None

    def remember_outbox(self, task: OutboxTask) -> bool:
        with closing(self._connect()) as connection:
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO outbox_spool(task_id, payload_json, created_at)
                VALUES (?, ?, ?)
                """,
                (str(task.id), task.model_dump_json(), datetime.now(UTC).isoformat()),
            )
            return cursor.rowcount == 1

    def mark_outbox_in_flight(self, task_id: UUID | str) -> None:
        with closing(self._connect()) as connection:
            cursor = connection.execute(
                "UPDATE outbox_spool SET status = 'IN_FLIGHT' WHERE task_id = ? AND status = 'PENDING'",
                (str(task_id),),
            )
            if cursor.rowcount != 1:
                raise KeyError(f"unknown or non-pending outbox task: {task_id}")

    def scan_cursors(self) -> dict[str, int]:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT value FROM bridge_metadata WHERE key = 'conversation_scan_cursors'"
            ).fetchone()
        if not row:
            return {}
        try:
            raw = json.loads(str(row["value"]))
        except (TypeError, ValueError, json.JSONDecodeError):
            return {}
        if not isinstance(raw, dict):
            return {}
        return {
            str(key): int(value)
            for key, value in raw.items()
            if isinstance(key, str) and isinstance(value, int) and value >= 0
        }

    def update_scan_cursors(self, cursors: dict[str, int]) -> None:
        safe = {
            key: value for key, value in sorted(cursors.items())
            if key and isinstance(value, int) and value >= 0
        }
        now = datetime.now(UTC).isoformat()
        payload = json.dumps(safe, ensure_ascii=False, separators=(",", ":"))
        with closing(self._connect()) as connection:
            connection.execute(
                """
                INSERT INTO bridge_metadata(key, value, updated_at)
                VALUES ('conversation_scan_cursors', ?, ?)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                """,
                (payload, now),
            )

    def mark_outbox_ambiguous(self, task_id: UUID | str, error_code: str) -> None:
        if not error_code:
            raise ValueError("error_code must not be empty")
        with closing(self._connect()) as connection:
            cursor = connection.execute(
                """
                UPDATE outbox_spool
                SET status = 'AMBIGUOUS', last_error_code = ?
                WHERE task_id = ? AND status != 'COMPLETED'
                """,
                (error_code, str(task_id)),
            )
            if cursor.rowcount != 1:
                raise KeyError(f"unknown or completed outbox task: {task_id}")

    def complete_outbox(self, task_id: UUID | str, ack: SendAck) -> None:
        now = datetime.now(UTC).isoformat()
        with closing(self._connect()) as connection:
            cursor = connection.execute(
                """
                UPDATE outbox_spool
                SET status = 'COMPLETED', readback_message_id = ?, last_error_code = ?, completed_at = ?
                WHERE task_id = ?
                """,
                (ack.readback_message_id, ack.error_code, now, str(task_id)),
            )
            if cursor.rowcount != 1:
                raise KeyError(f"unknown outbox task: {task_id}")

    def outbox_record(self, task_id: UUID | str) -> OutboxRecord | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                """
                SELECT payload_json, status, readback_message_id, last_error_code, completed_at
                FROM outbox_spool WHERE task_id = ?
                """,
                (str(task_id),),
            ).fetchone()
        if not row:
            return None
        completed_at = datetime.fromisoformat(row["completed_at"]) if row["completed_at"] else None
        return OutboxRecord(
            task=OutboxTask.model_validate_json(row["payload_json"]),
            status=row["status"],
            readback_message_id=row["readback_message_id"],
            last_error_code=row["last_error_code"],
            completed_at=completed_at,
        )

    def purge_completed(self, *, before: datetime) -> int:
        if before.tzinfo is None:
            raise ValueError("before must include a timezone")
        with closing(self._connect()) as connection:
            cursor = connection.execute(
                "DELETE FROM outbox_spool WHERE status = 'COMPLETED' AND completed_at < ?",
                (before.astimezone(UTC).isoformat(),),
            )
            return cursor.rowcount

    def health_snapshot(self) -> SpoolHealthSnapshot:
        with closing(self._connect()) as connection:
            pending_inbound = connection.execute(
                "SELECT COUNT(*) FROM inbound_spool WHERE status = 'PENDING'"
            ).fetchone()[0]
            outbox_counts = dict(connection.execute(
                "SELECT status, COUNT(*) FROM outbox_spool GROUP BY status"
            ).fetchall())
            row = connection.execute(
                "SELECT value FROM bridge_metadata WHERE key = 'listener_watermark'"
            ).fetchone()
        return SpoolHealthSnapshot(
            pending_inbound=pending_inbound,
            pending_outbox=outbox_counts.get("PENDING", 0) + outbox_counts.get("IN_FLIGHT", 0),
            ambiguous_outbox=outbox_counts.get("AMBIGUOUS", 0),
            watermark=str(row["value"]) if row else None,
        )
