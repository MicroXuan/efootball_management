# Checkpointed PESDATA Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace long-running PESDATA synchronization with durable 50-record chunks that can pause safely, expose completed review batches immediately, resume idempotently, and finish samples at either their new-item target or source exhaustion.

**Architecture:** The database is the queue and checkpoint store. Each worker claim processes one bounded source chunk, atomically persists its review data and next checkpoint, then returns `CONTINUE` or `STOP` to the in-process runner; startup reconciliation requeues recoverable work. Player import records are written in bulk, and review/publish operations remain independent of the parent run status.

**Tech Stack:** TypeScript 5.9, NestJS 12, Prisma 7 / MySQL, Zod 4, Jest 29, React 19, Ant Design 6, Vitest 3, pnpm 11

**Spec:** `docs/superpowers/specs/2026-10-18-checkpointed-data-sync-redesign.zh-CN.md`

## Global Constraints

- Do not add Redis, RabbitMQ, a cloud queue, or any new runtime dependency.
- Use database checkpoints and the existing application runner; default chunk size is exactly 50 source summaries.
- Sample limit means target new review rows, not maximum source rows scanned.
- Source exhaustion with fewer matches is a successful partial completion, not a failure.
- A pause request lets the current chunk commit and prevents the next chunk from starting.
- Cancel preserves already-created review batches and every published catalog record.
- Full-sync source-missing detection runs only after confirmed source exhaustion.
- Keep published import batches, catalog releases, player cards, team catalog rows, and audit logs during cleanup.
- Use strict TDD for production behavior: observe every new regression test fail before implementation and pass afterward.

## Review Focus

- A source page containing duplicate IDs or IDs already seen in an earlier page must advance the source cursor without double-counting matches; Task 3 and Task 5 add duplicate-page tests.
- A sample whose last page contains more new rows than the remaining target must persist only the required rows and never create match `N+1`; Task 3 adds the boundary test.
- A pause arriving after source fetch but before commit must preserve one complete chunk and stop before the next claim; Task 4 adds the race test.
- A worker that loses its lease while building a batch must not move the cursor or leave an unlinked batch; Task 3 and Task 4 add lease-loss tests.
- Concurrent sample runs across restarts must not stage the same source business key in two pending batches; Task 3 adds the cross-run pending-record test.

---

### Task 1: Durable run state and public contracts

**Files:**
- Create: `apps/api/prisma/migrations/20261018_checkpointed_platform_sync/migration.sql`
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `packages/contracts/src/platform-data-sync.ts`
- Test: `packages/contracts/src/contracts.spec.ts`
- Test: `apps/api/src/platform-data-sync/platform-data-sync.service.spec.ts`

**Interfaces:**
- Produces Prisma enum: `SyncCompletionReason = TARGET_REACHED | SOURCE_EXHAUSTED`.
- Produces run fields on both run models: `matchedCount Int @default(0)`, `chunkSize Int @default(50)`, `chunkIndex Int @default(0)`, `pauseRequestedAt DateTime?`, `completionReason SyncCompletionReason?`; team runs additionally receive `sourceTotal Int?`.
- Produces contract fields on `PlatformSyncRunSummary`: `targetCount: number | null`, `matchedCount: number`, `chunkIndex: number`, `pauseRequested: boolean`, `completionReason: 'TARGET_REACHED' | 'SOURCE_EXHAUSTED' | null`.
- Produces control response status: `'PAUSING' | 'PAUSED' | 'CANCELLED'`.

- [ ] **Step 1: Write failing contract tests**

Add tests named `parses checkpointed sample progress and partial completion` and `accepts a pausing control response`. Assert literal values `targetCount: 100`, `matchedCount: 60`, `chunkIndex: 29`, `pauseRequested: false`, `completionReason: 'SOURCE_EXHAUSTED'`, and `{ status: 'PAUSING' }`.

- [ ] **Step 2: Run the contract tests and verify RED**

Run: `pnpm --filter @efm/contracts test`

Expected: FAIL because the new summary properties and `PAUSING` are rejected or absent.

- [ ] **Step 3: Add schema migration and Prisma model fields**

Define `SyncCompletionReason` and the exact fields from Interfaces. The SQL migration must add nullable/defaulted columns without deleting or rewriting existing business rows.

- [ ] **Step 4: Regenerate Prisma and expose the new Zod contract**

Run: `pnpm db:generate`

Update `PlatformSyncRunSummarySchema` and `ControlledSyncRunSchema` with the exact Interfaces fields. Extend the service mapping test fixtures so both player and team summaries expose persisted values.

- [ ] **Step 5: Apply the additive migration to the configured development database**

Run: `pnpm db:migrate`

Expected: migration `20261018_checkpointed_platform_sync` applies without deleting or rewriting business rows.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `pnpm --filter @efm/contracts test && pnpm --filter @efm/api test -- --runInBand platform-data-sync.service.spec.ts`

Expected: PASS with no schema parse errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma packages/contracts/src/platform-data-sync.ts packages/contracts/src/contracts.spec.ts apps/api/src/platform-data-sync/platform-data-sync.service.spec.ts
git commit -m "feat: add checkpointed sync state"
```

### Task 2: Bulk and transaction-aware player import persistence

**Files:**
- Modify: `apps/api/src/player-import/player-import.service.ts`
- Test: `apps/api/src/player-import/player-import.service.spec.ts`

**Interfaces:**
- Produces: `createBatchForPlatformAdminInTransaction(tx: Prisma.TransactionClient, actorAdminId: string, input: CreateImportBatchRequest): Promise<CreateBatchOutcome>`.
- Existing `createBatchForPlatformAdmin(...)` remains compatible and delegates through the same preparation/persistence path.
- Import record persistence uses `createMany` with literal record rows and updates batch counts in the same transaction.

- [ ] **Step 1: Write failing 100-row and 500-row behavior tests**

Add integration tests `creates a 100-row platform batch within the default transaction budget` and `creates all 500 import records with exact summary counts`. Assert returned `totalCount`, database `importRecord.count`, and hand-derived CREATE/UPDATE/UNCHANGED/INVALID totals; do not assert that a mock was called.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm --filter @efm/api test -- --runInBand player-import.service.spec.ts`

Expected: the 100-row remote-DB regression reproduces `P2028`, or the new transaction-aware entry point is missing. Record which expected failure establishes RED.

- [ ] **Step 3: Extract transaction-aware preparation and bulk persistence**

Thread a `PrismaService | Prisma.TransactionClient` store through duplicate lookup, record review, batch creation, `importRecord.createMany`, and batch summary update. Implement the exact transaction entry point from Interfaces without changing validation, checksum, or 5,000-row limits.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm --filter @efm/api test -- --runInBand player-import.service.spec.ts`

Expected: PASS; 100 and 500 persisted records have exact counts and no `P2028`.

- [ ] **Step 5: Run publisher regressions**

Run: `pnpm --filter @efm/api test -- --runInBand player-import.publisher.spec.ts`

Expected: PASS; publishing, rejecting, duplicate checks, and rollback behavior are unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/player-import/player-import.service.ts apps/api/src/player-import/player-import.service.spec.ts
git commit -m "fix: bulk persist player import records"
```

### Task 3: Player-card chunk processor and exact sample targeting

**Files:**
- Create: `apps/api/src/pesdata-sync/pesdata-player-chunk.processor.ts`
- Create: `apps/api/src/pesdata-sync/pesdata-player-chunk.processor.spec.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata-sync.service.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata-sync.module.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata-sync.types.ts`
- Test: `apps/api/src/pesdata-sync/pesdata-sync.service.spec.ts`

**Interfaces:**
- Consumes Task 1 run fields and Task 2 `createBatchForPlatformAdminInTransaction`.
- Produces: `type SyncChunkOutcome = { disposition: 'CONTINUE' | 'STOP'; status: 'PENDING' | 'PAUSED' | 'READY'; completionReason: SyncCompletionReason | null }`.
- Produces: `PesdataPlayerChunkProcessor.processNextChunk(runId: string): Promise<SyncChunkOutcome>`.
- `PesdataSyncService.executePlatformRun(runId)` becomes a compatibility wrapper that repeatedly invokes chunks only for direct CLI callers; platform runner code uses `processNextChunk`.

- [ ] **Step 1: Write failing processor tests for sample target and source exhaustion**

Add real-database tests for: (a) 100 prior/pending rows followed by 100 genuinely new rows across 50-row pages results in `matchedCount=100`, `scannedCount=200`, exactly 100 staged records, and `TARGET_REACHED`; (b) only 60 new rows before an empty page results in `matchedCount=60`, `READY`, and `SOURCE_EXHAUSTED`; (c) a final page with 12 new rows and only 3 remaining target slots stages exactly 3.

- [ ] **Step 2: Write failing idempotency and review-visibility tests**

Cover duplicate IDs across pages, replaying the same chunk after a simulated pre-checkpoint failure, excluding a source key already present in another READY/VALIDATED sync batch, and exposing the first committed chunk through `listPlayerBatches` while the parent run is still active.

- [ ] **Step 3: Run processor tests and verify RED**

Run: `pnpm --filter @efm/api test -- --runInBand pesdata-player-chunk.processor.spec.ts`

Expected: FAIL because the processor and chunk outcomes do not exist.

- [ ] **Step 4: Implement one bounded player chunk**

Implement the exact processor interface. Fetch at most `chunkSize=50` summaries from `currentOffset`; derive new-card eligibility from published catalog plus non-cancelled pending import records; clamp accepted new rows to remaining sample target; persist sync items, one review batch/link, counters, next offset, and outcome in one transaction. Empty page sets `SOURCE_EXHAUSTED`; reaching target sets `TARGET_REACHED`; neither is a failure.

- [ ] **Step 5: Fence lease loss and orphan cleanup**

Add a test that invalidates `leaseOwnerToken` between source fetch and persistence. Assert cursor/counters stay unchanged and there is no unlinked import batch. Implement ownership checks inside the persistence transaction.

- [ ] **Step 6: Run player sync tests and verify GREEN**

Run: `pnpm --filter @efm/api test -- --runInBand pesdata-player-chunk.processor.spec.ts pesdata-sync.service.spec.ts`

Expected: PASS; existing direct sync behavior remains compatible and new platform behavior is chunked.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/pesdata-sync
git commit -m "feat: process player sync in durable chunks"
```

### Task 4: Durable scheduling, graceful pause, resume, and cancellation

**Files:**
- Modify: `apps/api/src/platform-data-sync/platform-data-sync.runner.ts`
- Modify: `apps/api/src/platform-data-sync/platform-data-sync.service.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata-sync.service.ts`
- Test: `apps/api/src/platform-data-sync/platform-data-sync.runner.spec.ts`
- Test: `apps/api/src/platform-data-sync/platform-data-sync.service.spec.ts`
- Test: `apps/api/src/pesdata-sync/pesdata-player-chunk.processor.spec.ts`

**Interfaces:**
- Consumes Task 3 `processNextChunk` and `SyncChunkOutcome`.
- Produces runner behavior: a `CONTINUE` result is rescheduled with `queueMicrotask` only after the current key leaves the in-memory `running` map.
- Produces pause behavior: PENDING runs transition directly to PAUSED; RUNNING runs set `pauseRequestedAt` and return `PAUSING`; chunk commit transitions them to PAUSED.
- Produces cancel behavior: only inactive PAUSED/FAILED runs become CANCELLED; review batches and batch links remain.

- [ ] **Step 1: Write failing runner continuation and restart tests**

Assert one scheduled call processes one chunk at a time, `CONTINUE` schedules the next chunk after cleanup, `STOP` does not reschedule, and `onModuleInit` schedules recoverable PENDING runs. Include a stale RUNNING lease test that restores the task to PENDING at its last committed cursor instead of terminal FAILED.

- [ ] **Step 2: Write failing pause race and cancellation preservation tests**

Block a source detail call, request pause, release the call, and assert exactly one chunk commits before PAUSED with no next fetch. Create a PAUSED run with a READY batch, cancel it, and assert the batch/link/records remain queryable.

- [ ] **Step 3: Run focused tests and verify RED**

Run: `pnpm --filter @efm/api test -- --runInBand platform-data-sync.runner.spec.ts platform-data-sync.service.spec.ts pesdata-player-chunk.processor.spec.ts`

Expected: FAIL on continuation scheduling, `PAUSING`, or preserved cancellation data.

- [ ] **Step 4: Implement scheduling and control semantics**

Update the runner and service methods exactly as defined in Interfaces. Audit pause request, completed pause, resume, and cancellation without deleting review data. Resume clears `pauseRequestedAt`, returns PENDING, and schedules from `currentOffset`.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm --filter @efm/api test -- --runInBand platform-data-sync.runner.spec.ts platform-data-sync.service.spec.ts pesdata-player-chunk.processor.spec.ts`

Expected: PASS with deterministic fetch counts and no leaked timers.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/platform-data-sync apps/api/src/pesdata-sync
git commit -m "feat: pause and resume chunked sync safely"
```

### Task 5: Team-shell chunk processor and full-sync finalization

**Files:**
- Create: `apps/api/src/pesdata-sync/pesdata-team-chunk.processor.ts`
- Create: `apps/api/src/pesdata-sync/pesdata-team-chunk.processor.spec.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata-team-sync.service.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata-sync.module.ts`
- Modify: `apps/api/src/platform-data-sync/platform-data-sync.runner.ts`
- Test: `apps/api/src/pesdata-sync/pesdata-team-sync.service.spec.ts`

**Interfaces:**
- Consumes Task 1 state fields and Task 4 runner outcome contract.
- Produces: `PesdataTeamChunkProcessor.processNextChunk(runId: string): Promise<SyncChunkOutcome>`.
- Sample `matchedCount` counts only new team shells; incremental/full counts remain available as added/updated/missing counters.

- [ ] **Step 1: Write failing team chunk tests**

Cover 50-row page boundaries, existing catalog rows before new rows, source exhaustion below target, duplicate IDs across pages, pause after one committed chunk, replay without duplicate items, and target clamping at exactly N new teams.

- [ ] **Step 2: Write failing full-sync finalization test**

Pause a full sync before source exhaustion and assert no `SOURCE_MISSING` item exists. Resume through an empty source page and assert missing items are generated once, after exhaustion only.

- [ ] **Step 3: Run tests and verify RED**

Run: `pnpm --filter @efm/api test -- --runInBand pesdata-team-chunk.processor.spec.ts pesdata-team-sync.service.spec.ts`

Expected: FAIL because the team chunk processor does not exist.

- [ ] **Step 4: Implement bounded team chunks**

Implement the exact processor interface, persist team review items and run checkpoint atomically, and invoke crest loading before the transaction. Keep item-level failures isolated. Run source-missing finalization only on the terminal empty page of FULL mode.

- [ ] **Step 5: Wire the team processor into runner and controls**

Use the same `CONTINUE`/`STOP`, pause request, resume, lease, and cancellation semantics as player cards. Do not duplicate scheduler policy in the team service.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run: `pnpm --filter @efm/api test -- --runInBand pesdata-team-chunk.processor.spec.ts pesdata-team-sync.service.spec.ts platform-data-sync.runner.spec.ts`

Expected: PASS; source-missing is absent before exhaustion and unique after finalization.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/pesdata-sync apps/api/src/platform-data-sync/platform-data-sync.runner.ts
git commit -m "feat: process team sync in durable chunks"
```

### Task 6: Admin progress, partial completion, and live review controls

**Files:**
- Modify: `apps/api/src/platform-data-sync/platform-data-sync.service.ts`
- Modify: `apps/admin-web/src/platform/data-sync/sync-run-card.tsx`
- Modify: `apps/admin-web/src/platform/data-sync/player-sync-panel.tsx`
- Modify: `apps/admin-web/src/platform/data-sync/team-sync-panel.tsx`
- Modify: `apps/admin-web/src/platform/data-sync/data-sync-page.tsx`
- Modify: `apps/admin-web/src/platform/data-sync/use-sync-run.ts`
- Test: `apps/admin-web/src/platform/data-sync/sync-run-card.spec.tsx`
- Test: `apps/admin-web/src/platform/data-sync/player-sync-panel.spec.tsx`
- Test: `apps/admin-web/src/platform/data-sync/team-sync-panel.spec.tsx`
- Test: `apps/admin-web/src/platform/data-sync/data-sync-page.spec.tsx`

**Interfaces:**
- Consumes Task 1 summary fields and Task 4 `PAUSING` response.
- UI copy: sample progress `新增 60/100 · 已检查 1,420`; partial completion label `部分完成`; phase `正在暂停，当前分片完成后停止`.
- Review tables remain enabled and refresh while parent status is PENDING, RUNNING, PAUSED, READY, FAILED, or CANCELLED.

- [ ] **Step 1: Write failing component tests**

Assert exact progress copy for 60/100 and 1,420 scans, `SOURCE_EXHAUSTED` renders `部分完成`, pause response renders `正在暂停`, and active/paused player and team panels still fetch and expose review actions.

- [ ] **Step 2: Run component tests and verify RED**

Run: `pnpm --filter @efm/admin-web exec vitest run src/platform/data-sync/sync-run-card.spec.tsx src/platform/data-sync/player-sync-panel.spec.tsx src/platform/data-sync/team-sync-panel.spec.tsx src/platform/data-sync/data-sync-page.spec.tsx`

Expected: FAIL on missing progress fields/copy or disabled live review behavior.

- [ ] **Step 3: Map persisted progress in API summaries**

Return the Task 1 fields for player and team run mapping. `resumable` is true only for PAUSED or inactive FAILED; `pauseRequested` comes only from persisted state.

- [ ] **Step 4: Implement admin UI behavior and copy**

Separate source scanning from matched progress. Keep review panels mounted and independently refreshable while a run is active or paused. Change cancellation description to state that existing review batches remain available.

- [ ] **Step 5: Run component and service tests and verify GREEN**

Run: `pnpm --filter @efm/admin-web exec vitest run src/platform/data-sync && pnpm --filter @efm/api test -- --runInBand platform-data-sync.service.spec.ts`

Expected: PASS with the exact Chinese copy and contract parsing.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/platform-data-sync/platform-data-sync.service.ts apps/admin-web/src/platform/data-sync
git commit -m "feat: show chunked sync progress and live reviews"
```

### Task 7: Recoverable sync-data cleanup command

**Files:**
- Create: `apps/api/src/platform-data-sync/platform-data-sync-cleanup.ts`
- Create: `apps/api/src/platform-data-sync/platform-data-sync-cleanup.cli.ts`
- Create: `apps/api/src/platform-data-sync/platform-data-sync-cleanup.spec.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `inspectPlatformSyncCleanup(prisma): Promise<PlatformSyncCleanupCounts>`.
- Produces: `clearPlatformSyncData(prisma): Promise<{ before: PlatformSyncCleanupCounts; after: PlatformSyncCleanupCounts }>`.
- CLI is dry-run unless passed `--execute`; output contains counts only, never row contents or credentials.
- Deletes runs/items/links and sync-linked non-published batches; preserves PUBLISHED batches/releases, catalog data, and audit logs.

- [ ] **Step 1: Write failing cleanup integration test**

Seed one published linked batch, one READY linked batch, player/team runs and items, catalog rows, releases, and audit rows. Assert cleanup zeros sync runs/items/links and removes only READY batch/records while published batch/release/catalog/audit counts remain literal pre-cleanup values.

- [ ] **Step 2: Run test and verify RED**

Run: `pnpm --filter @efm/api test -- --runInBand platform-data-sync-cleanup.spec.ts`

Expected: FAIL because cleanup functions do not exist.

- [ ] **Step 3: Implement transactional cleanup and dry-run CLI**

Resolve deletable batch IDs before deleting links, execute the exact cleanup order from the spec inside one transaction, and return before/after counts. Add scripts `data-sync:clear` in API and root packages.

- [ ] **Step 4: Run cleanup test and verify GREEN**

Run: `pnpm --filter @efm/api test -- --runInBand platform-data-sync-cleanup.spec.ts`

Expected: PASS and preserved business-row assertions remain unchanged.

- [ ] **Step 5: Run dry-run against configured database**

Run: `pnpm data-sync:clear`

Expected: prints the current counts and an explicit dry-run message; changes no rows.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/platform-data-sync/platform-data-sync-cleanup* apps/api/package.json package.json
git commit -m "feat: add safe sync data cleanup command"
```

### Task 8: Database cleanup, full regression, and operational acceptance

**Files:**
- Modify if required by observed failures: files already owned by Tasks 1–7 only
- Verify: `docs/development/pesdata-sync.md`
- Verify: `docs/development/pesdata-team-sync.md`

**Interfaces:**
- Consumes Tasks 1–7 and their CLI/scripts.
- Produces a clean sync workspace with published business data unchanged.

- [ ] **Step 1: Confirm the configured database is on the expected migration**

Run: `pnpm db:status`

Expected: database schema is up to date and includes `20261018_checkpointed_platform_sync`.

- [ ] **Step 2: Run complete pre-cleanup verification**

Run: `pnpm verify`

Expected: lint, typecheck, all unit tests, e2e tests, and builds exit 0. Report any pre-existing failure by exact test/command before proceeding.

- [ ] **Step 3: Inspect cleanup target and record preservation counts**

Run: `pnpm data-sync:clear`

Expected: dry-run count output identifies sync runs/items/links and non-published linked batches only. Independently record counts for published batches, catalog releases, player cards, team catalog rows, and audit logs.

- [ ] **Step 4: Execute the user-authorized cleanup**

Run: `pnpm data-sync:clear -- --execute`

Expected: sync runs/items/links and non-published linked batches are zero. Published batches, releases, cards, teams, and audit counts equal Step 3.

- [ ] **Step 5: Run post-cleanup verification**

Run: `pnpm verify`

Expected: all commands exit 0 against the cleaned database.

- [ ] **Step 6: Perform live acceptance in increasing scope**

Start a 10-new-player sample, verify one or more review batches appear before completion, pause/resume if multiple chunks are needed, then run a 100-new-player sample. Verify target/exhaustion copy, exact matched counts, review actions while paused, and no active run left stuck beyond its lease.

- [ ] **Step 7: Update operational documentation and commit**

Document chunk progress, partial completion, pause semantics, recovery, dry-run cleanup, and acceptance commands in the two PESDATA development guides.

```bash
git add docs/development/pesdata-sync.md docs/development/pesdata-team-sync.md
git commit -m "docs: document checkpointed data sync operations"
```

