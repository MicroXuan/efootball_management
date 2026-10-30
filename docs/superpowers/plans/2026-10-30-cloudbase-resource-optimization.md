# CloudBase resource optimization implementation plan

> Execute with superpowers:executing-plans, using TDD and a final independent review.

Goal: reduce idle database work without changing mini-program contracts, auction deadlines, or valuation snapshot semantics.

Architecture: retain existing NestJS workers and database transactions. Auction mutations keep the local worker awake across transaction commit (120 seconds, exceeding Prisma's 60 second transaction timeout); idle scans back off to 5 seconds with fallback for external changes. Active auctions retain 500 ms checks. Valuation background checks discover the next opening and check at its boundary, with a 30 second reconciliation ceiling and mutation wakeups. Existing request-time and roster-mutation snapshot compensation remains unchanged.

Constraints: work on dev, preserve pre-existing edits, no schema changes, no production writes/configuration/deployments. Explicit localhost DATABASE_URL with verify database for every API test. Instance downsizing, CDN changes and response compression require live resource/traffic evidence and are not applied blindly.

Review focus: transaction commit after a worker empty read; short paused-auction resumes; active auction countdown and automatic advancement; valuation window edit during pending background read; slow/erroring tasks must not overlap or permanently stop scheduling.

- [x] Add failing timer tests for idle query budgets, mutation wakeups, active deadlines, and slow/error recovery.
- [x] Implement auction idle backoff plus bounded activity hints from all low-level start/resume/recovery paths. Keep direct tick behavior and settlement transactions unchanged.
- [x] Implement valuation boundary-aware background scheduling and mutation activity hints; keep direct initialization API unchanged.
- [x] Run focused tests, full unit suites, typecheck, lint, and relevant isolated e2e regressions (including league teams and my leagues).
- [x] Review diff independently, fix material issues, record exact validation and deployment limits; stop and remove only the disposable test database created for this task.

## Accepted scope addition

User explicitly requested and confirmed: both manual and abnormal pauses automatically cancel the batch after one continuous hour. Preserve completed/pending-review results; void only unfinished lots. Resume within one hour retains the existing manual-resume remaining time; abnormal recovery continues its existing explicit 30-second restart. Repeated recovery detection must not reset the timeout. Add nullable pausedAt and index, backfill existing paused rows conservatively, check expiry under database locks on resume/recover, and cancel via an idempotent background transaction. This supersedes the earlier no-schema-change constraint. No target environment migration/deployment without identifying its database and controlled rollout.

- [x] Add pausedAt migration and boundary tests; reject late resume/recovery.
- [x] Add indexed low-frequency cancellation worker with transactional recheck, preserve finalized lots, and test duplicate runs/restarts.
- [x] Run migration and e2e tests only on the dedicated localhost verify database; document production migration requirement.

Validation and review ledger: see 2026-10-30-cloudbase-resource-verification.md. Ruling: do not deploy or downsize without live metrics and target verification; mixed old/new auction writers must be drained during migration. Independent review findings addressed through boundary tests and explicit controlled rollout requirements.
