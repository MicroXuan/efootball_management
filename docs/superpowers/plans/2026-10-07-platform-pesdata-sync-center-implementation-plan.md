# Platform PESDATA Data Sync Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a platform-only browser module where administrators can start, monitor, review, resume, and publish PESDATA player-card and team-shell synchronization without loading large result sets into the browser.

**Architecture:** Reuse the existing `ExternalSyncRun`/`ImportBatch` and `TeamCatalogSyncRun`/`TeamCatalogSyncItem` pipelines, adding a platform orchestration module, database-backed leases, asynchronous execution, and paginated review APIs. The admin web adds one `/platform/data-sync` page with player-card and team-shell tabs; ordinary user import authorization remains separate from platform administrator authorization.

**Tech Stack:** TypeScript 5.9, NestJS 12, Prisma 7/MariaDB, Zod 4 contracts, React 19, Ant Design 6, Vitest/Testing Library, Jest.

**Spec:** `docs/superpowers/specs/2026-10-07-platform-pesdata-sync-center-design.zh-CN.md`

## Global Constraints

- Only platform administrators may access `/v1/admin/data-sync/*`; enforce `AdminAuthGuard`, `AdminScopeGuard`, and `@PlatformAdminOnly()`.
- The browser and mini program must never call PESDATA directly; all source requests stay in the API process.
- Sync creation returns `202 Accepted` with a run ID and never waits for the remote sync to finish.
- Player cards and team shells default to staged review; neither pipeline may publish automatically.
- Player-card publication remains atomic at `ImportBatch` granularity.
- Team-shell updates must not overwrite an already assigned `LeagueTeam` display snapshot.
- List endpoints use server-side filtering and pagination; `pageSize` accepts only `20` or `50` and defaults to `20`.
- The UI defaults to pending and failed work and must not expose an “全部加载” action.
- Batch mutation requests contain explicit IDs and accept at most `100` IDs; exceeding the limit returns a validation error rather than truncating.
- Leaving the page must not stop a task; a process restart marks stale work resumable and requires explicit administrator resume.
- Preserve the CLI sync commands and make them share the same database lease as browser-started jobs.
- Every mutation records a concrete audit action; never emit a generic “其他后台操作”.
- Do not log or return PESDATA signatures, cookies, secrets, or complete upstream responses.

## Review Focus

- **Stale lease after an API crash:** startup reconciliation must clear only expired leases, preserve checkpoints, and expose the run as resumable; pinned by Task 2 recovery tests.
- **Platform admin/user identity collision:** a platform admin ID must never pass through ordinary `catalog.import.*` authorization; pinned by Task 3 authorization-boundary tests.
- **Duplicate start and double publication:** concurrent requests must resolve to one active run or one published result without duplicate rows; pinned by Tasks 4 and 6 concurrency tests.
- **Large filtered result sets:** totals, pages, and selected rows must remain correct when the underlying run contains more than one page; pinned by Tasks 5, 8, and 9 pagination tests.
- **Partial failure during batch actions:** successful items must remain committed, failed items must remain visible with their own error, and the response must report both counts; pinned by Task 6 batch-operation tests.

---

## File Structure

### Shared contracts

- Create `packages/contracts/src/platform-data-sync.ts`: request, run-summary, overview, pagination, player-batch/record, team-item, and batch-result schemas.
- Modify `packages/contracts/src/index.ts`: export the new contracts.
- Modify `packages/contracts/src/contracts.spec.ts`: schema boundary tests.

### API persistence and execution

- Modify `apps/api/prisma/schema.prisma`: heartbeat, lease-expiry, and current-phase fields on both sync run models.
- Create `apps/api/prisma/migrations/20261007_platform_data_sync_center/migration.sql`: additive run-state migration and supporting indexes.
- Modify `apps/api/src/player-import/player-import.service.ts`: explicit platform-admin read/create/cancel entry points with a shared authorization-free core.
- Modify `apps/api/src/player-import/player-import.publisher.ts`: explicit platform-admin publish entry point with a shared transactional core.
- Modify `apps/api/src/player-import/player-import.module.ts`: import `AdminModule` for platform authorization.
- Modify `apps/api/src/pesdata-sync/pesdata-sync.service.ts`: separate run creation from execution, update heartbeat/phase, and support the platform import entry point.
- Modify `apps/api/src/pesdata-sync/pesdata-team-sync.service.ts`: separate run creation from execution, resume from stored offset, and update heartbeat/phase.
- Create `apps/api/src/platform-data-sync/platform-data-sync.runner.ts`: background scheduling, promise error containment, and startup stale-run reconciliation.
- Create `apps/api/src/platform-data-sync/platform-data-sync.service.ts`: overview, paginated queries, explicit review mutations, and audit logging.
- Create `apps/api/src/platform-data-sync/platform-data-sync.controller.ts`: platform-only HTTP surface and `202` responses.
- Create `apps/api/src/platform-data-sync/platform-data-sync.module.ts`: module wiring.
- Modify `apps/api/src/app.module.ts`: register the platform data-sync module.
- Modify `apps/api/src/team-catalog/admin-team-catalog.controller.ts`: remove legacy sync endpoints while retaining team catalog search/custom creation.
- Modify `apps/api/src/team-catalog/team-catalog.service.ts`: expose transaction-safe single/batch review primitives to the platform service.

### Admin web

- Create `apps/admin-web/src/platform/data-sync/data-sync-page.tsx`: page shell, tabs, overview, and polling ownership.
- Create `apps/admin-web/src/platform/data-sync/use-sync-run.ts`: terminal-aware polling hook.
- Create `apps/admin-web/src/platform/data-sync/sync-run-card.tsx`: shared run controls and progress presentation.
- Create `apps/admin-web/src/platform/data-sync/player-sync-panel.tsx`: player runs, batches, records, filters, drawer, and publication.
- Create `apps/admin-web/src/platform/data-sync/team-sync-panel.tsx`: team runs, paginated differences, drawer, and batch review actions.
- Create matching `*.spec.tsx` files in the same directory.
- Modify `apps/admin-web/src/app.tsx`: lazy route for `/platform/data-sync`.
- Modify `apps/admin-web/src/application-shell.tsx`: platform navigation entry.
- Modify `apps/admin-web/src/design-system/icons.tsx`: add the `sync` icon.
- Modify `apps/admin-web/src/leagues/teams-page.tsx`: remove the legacy sync card.
- Delete `apps/admin-web/src/leagues/team-catalog-sync-card.tsx` and its test after the replacement tests pass.
- Modify `apps/admin-web/src/styles.css`: responsive sync-center layout, metrics, table filters, and drawer presentation.

### Documentation

- Modify `docs/development/pesdata-sync.md`: browser workflow, state meanings, restart recovery, and CLI fallback.
- Modify `docs/development/pesdata-team-sync.md`: new platform location and review workflow.

---

### Task 1: Define the platform data-sync contracts

**Files:**
- Create: `packages/contracts/src/platform-data-sync.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`

**Interfaces:**
- Consumes: existing `ResourceIdSchema`, `ImportBatchSchema`, `ImportRecordSchema`, and `TeamCatalogCandidateSchema`.
- Produces: `StartPlatformSyncRequest`, `PlatformSyncRunSummary`, `PlatformSyncRunPage`, `PlatformDataSyncOverview`, `PlayerSyncBatchPage`, `PlayerImportRecordPage`, `TeamSyncItemPage`, `BatchMutationRequest`, and `BatchMutationResult` schemas/types.

- [ ] **Step 1: Write failing schema tests**

Add tests that assert:

```ts
assert.equal(StartPlatformSyncRequestSchema.parse({ mode: 'sample', limit: 2 }).mode, 'sample');
assert.throws(() => PlatformPageRequestSchema.parse({ page: 1, pageSize: 100 }));
assert.throws(() => BatchMutationRequestSchema.parse({ ids: Array.from({ length: 101 }, () => crypto.randomUUID()) }));
assert.equal(TeamSyncItemPageSchema.parse({ items: [], page: 1, pageSize: 20, total: 981, summary: { pending: 0, failed: 70, published: 911, rejected: 0 } }).total, 981);
```

- [ ] **Step 2: Run the contract test and verify it fails**

Run: `pnpm --filter @efm/contracts test`

Expected: FAIL because `platform-data-sync` schemas are not exported.

- [ ] **Step 3: Implement the contract schemas**

Define exact bounded enums and fields:

```ts
type StartPlatformSyncRequest = { mode: 'sample' | 'incremental' | 'full'; limit?: number };
type PlatformPageRequest = { page: number; pageSize: 20 | 50; status?: string[]; changeType?: string[]; errorCode?: string; sourceLeagueId?: string; query?: string; sortBy?: string; sortOrder?: 'asc' | 'desc' };
type BatchMutationRequest = { ids: string[] }; // 1..100 unique resource IDs
type BatchMutationResult = { requestedCount: number; succeededIds: string[]; failed: Array<{ id: string; code: string; message: string }> };
```

Run summaries must include `currentPhase`, `heartbeatAt`, `leaseExpiresAt`, `resumable`, actor ID, timestamps, counters, and error code/message. Paged schemas must include `{ items, page, pageSize, total, summary }`.

- [ ] **Step 4: Run contract tests and typecheck**

Run: `pnpm --filter @efm/contracts test && pnpm --filter @efm/contracts typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/platform-data-sync.ts packages/contracts/src/index.ts packages/contracts/src/contracts.spec.ts
git commit -m "feat(contracts): define platform data sync APIs"
```

### Task 2: Add durable leases and stale-run recovery state

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261007_platform_data_sync_center/migration.sql`
- Create: `apps/api/src/platform-data-sync/platform-data-sync.runner.spec.ts`
- Create: `apps/api/src/platform-data-sync/platform-data-sync.runner.ts`

**Interfaces:**
- Consumes: `PrismaService`, `ExternalSyncRun`, and `TeamCatalogSyncRun`.
- Produces: `PlatformDataSyncRunner.reconcileStaleRuns(now?: Date): Promise<{ players: number; teams: number }>` and lease helpers used by Tasks 4 and 5.

- [ ] **Step 1: Write failing migration and recovery tests**

Test both run types with these cases:

```ts
it('marks an expired PENDING or RUNNING run failed with PROCESS_INTERRUPTED and clears its lease');
it('does not touch a RUNNING run whose leaseExpiresAt is in the future');
it('preserves currentOffset and all counters while reconciling');
```

Assert recovered rows have `status: 'FAILED'`, `activeLeaseKey: null`, `errorCode: 'PROCESS_INTERRUPTED'`, and unchanged checkpoints.

- [ ] **Step 2: Run the runner test and verify it fails**

Run: `pnpm --filter @efm/api test -- --runInBand platform-data-sync.runner.spec.ts`

Expected: FAIL because the fields and runner do not exist.

- [ ] **Step 3: Add minimal additive run-state fields**

Add nullable `currentPhase VARCHAR(64)`, `heartbeatAt DATETIME(3)`, and `leaseExpiresAt DATETIME(3)` to both run tables plus indexes on `(status, lease_expires_at)`. Do not rewrite existing rows or remove current unique `activeLeaseKey` constraints. Use a shared `SYNC_LEASE_MS = 60_000` constant for initial acquisition and renewal.

- [ ] **Step 4: Implement stale-run reconciliation**

Implement `reconcileStaleRuns(now = new Date())` as two guarded `updateMany` operations. Only rows with `status` in `PENDING|RUNNING`, non-null lease, and `leaseExpiresAt < now` are marked interrupted. Preserve offsets/counters/items.

- [ ] **Step 5: Generate Prisma client and run tests**

Run: `pnpm db:generate && pnpm --filter @efm/api test -- --runInBand platform-data-sync.runner.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20261007_platform_data_sync_center apps/api/src/platform-data-sync/platform-data-sync.runner.ts apps/api/src/platform-data-sync/platform-data-sync.runner.spec.ts
git commit -m "feat(data-sync): persist leases and recover stale runs"
```

### Task 3: Separate platform-admin player import authorization

**Files:**
- Modify: `apps/api/src/player-import/player-import.module.ts`
- Modify: `apps/api/src/player-import/player-import.service.ts`
- Modify: `apps/api/src/player-import/player-import.service.spec.ts`
- Modify: `apps/api/src/player-import/player-import.publisher.ts`
- Modify: `apps/api/src/player-import/player-import.publisher.spec.ts`

**Interfaces:**
- Consumes: `AdminAuthorizationService.requirePlatformAdmin(adminId)` and existing ordinary-user permission methods.
- Produces: `createBatchForPlatformAdmin`, `getBatchForPlatformAdmin`, `listRecordsForPlatformAdmin`, `cancelBatchForPlatformAdmin`, and `PlayerImportPublisher.publishForPlatformAdmin`.

- [ ] **Step 1: Write failing authorization-boundary tests**

Add tests asserting:

```ts
await service.createBatchForPlatformAdmin(adminId, input);
expect(adminAuthorization.requirePlatformAdmin).toHaveBeenCalledWith(adminId);
expect(userAuthorization.can).not.toHaveBeenCalled();

await expect(service.createBatch(userId, input)).resolves.toBeDefined();
expect(userAuthorization.can).toHaveBeenCalledWith(userId, 'catalog.import.create');
```

Mirror the same separation for `publishForPlatformAdmin` versus `publish`.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `pnpm --filter @efm/api test -- --runInBand player-import.service.spec.ts player-import.publisher.spec.ts`

Expected: FAIL because the platform methods do not exist.

- [ ] **Step 3: Refactor creation/read/cancel around shared private cores**

Add these exact public signatures:

```ts
createBatchForPlatformAdmin(actorAdminId: string, input: CreateImportBatchRequest): Promise<{ batch: ImportBatchResponse; created: boolean }>;
getBatchForPlatformAdmin(actorAdminId: string, batchId: string): Promise<ImportBatchResponse>;
listRecordsForPlatformAdmin(actorAdminId: string, batchId: string, query: PlatformImportRecordQuery): Promise<PlayerImportRecordPage>;
cancelBatchForPlatformAdmin(actorAdminId: string, batchId: string): Promise<ImportBatchResponse>;
```

Each method first calls `requirePlatformAdmin`; ordinary methods keep existing scope checks. Shared private cores perform data work without re-authorizing.

- [ ] **Step 4: Refactor publishing around one transactional core**

Add:

```ts
publishForPlatformAdmin(actorAdminId: string, batchId: string): Promise<ImportBatchResponse>;
```

Both public publish methods authorize independently and call the same idempotent transaction. Keep invalid-record and already-published behavior unchanged.

- [ ] **Step 5: Run focused tests**

Run: `pnpm --filter @efm/api test -- --runInBand player-import.service.spec.ts player-import.publisher.spec.ts`

Expected: PASS, including the review-focus identity-collision assertions.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/player-import
git commit -m "refactor(player-import): add platform admin entry points"
```

### Task 4: Make both PESDATA pipelines queueable and resumable

**Files:**
- Modify: `apps/api/src/pesdata-sync/pesdata-sync.service.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata-sync.service.spec.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata-team-sync.service.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata-team-sync.service.spec.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata-sync.cli.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata-sync.cli.spec.ts`
- Modify: `apps/api/src/platform-data-sync/platform-data-sync.runner.ts`
- Modify: `apps/api/src/platform-data-sync/platform-data-sync.runner.spec.ts`

**Interfaces:**
- Consumes: Task 2 lease fields/reconciler and Task 3 platform import entry points.
- Produces: queued-run creation and execution methods used by the platform service/controller in Task 5.

- [ ] **Step 1: Write failing queue/lease tests for player cards**

Cover:

```ts
await expect(sync.createPlatformRun(adminId, { mode: 'incremental' })).resolves.toMatchObject({ status: 'PENDING' });
await sync.executePlatformRun(runId);
expect(run).toMatchObject({ status: 'READY', activeLeaseKey: null, currentPhase: 'READY' });
await expect(sync.createPlatformRun(adminId, { mode: 'full' })).rejects.toMatchObject({ code: 'PESDATA_SYNC_CONFLICT' });
```

Assert each processed page advances `currentOffset`, updates `heartbeatAt`, and renews `leaseExpiresAt`.

- [ ] **Step 2: Write failing queue/lease tests for team shells**

Use the same assertions for `createPlatformRun`, `executePlatformRun`, and `resumePlatformRun`. Add a resume case beginning at a non-zero stored offset and verify previously completed items are not requested or duplicated. Verify a different active platform administrator may resume the run while the original initiator remains unchanged on the run record; the resume audit belongs to the resuming administrator.

- [ ] **Step 3: Run focused sync tests and verify they fail**

Run: `pnpm --filter @efm/api test -- --runInBand pesdata-sync.service.spec.ts pesdata-team-sync.service.spec.ts platform-data-sync.runner.spec.ts`

Expected: FAIL because queued APIs and heartbeat updates are absent.

- [ ] **Step 4: Split player run creation from execution**

Implement:

```ts
createPlatformRun(actorAdminId: string, input: StartPesdataSyncInput): Promise<{ runId: string; status: 'PENDING' }>;
executePlatformRun(runId: string): Promise<PesdataSyncResult>;
resumePlatformRun(actorAdminId: string, runId: string): Promise<{ runId: string; status: 'PENDING' }>;
```

`createPlatformRun` creates `PENDING`, reserves the unique lease key for 60 seconds so concurrent starts fail, and holds no remote request open; Task 6 authorizes the caller before invoking it. `executePlatformRun` atomically changes the reserved run to `RUNNING`, uses platform batch creation, renews heartbeat per page, and releases the lease on every terminal path. Keep `start(userId, input)` and CLI behavior synchronous by composing the existing user-authorized path with the same execution core.

- [ ] **Step 5: Split team run creation from execution**

Implement the same three methods on `PesdataTeamSyncService`, plus `retryPlatformItems(actorAdminId: string, itemIds: string[]): Promise<BatchMutationResult>`. Resume from `currentOffset`; recompute counters from persisted items only where needed; do not reset to offset zero. Move `SOURCE_UNCONFIRMED` mutation out of discovery—only publishing a `SOURCE_MISSING` review item may change the formal catalog state.

- [ ] **Step 6: Implement contained background scheduling**

Add:

```ts
schedulePlayer(runId: string): void;
scheduleTeam(runId: string): void;
```

Track in-process promises by `kind:runId`, use `void promise.catch(...)` so no rejection escapes, and delete the entry in `finally`. `onModuleInit()` reconciles once and starts a 30-second stale-lease reconciliation timer; `onModuleDestroy()` clears it. Reconciliation marks work resumable but never automatically resumes it.

- [ ] **Step 7: Run sync and CLI tests**

Run: `pnpm --filter @efm/api test -- --runInBand pesdata-sync.service.spec.ts pesdata-team-sync.service.spec.ts pesdata-sync.cli.spec.ts platform-data-sync.runner.spec.ts`

Expected: PASS; existing CLI argument/result behavior remains intact.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/pesdata-sync apps/api/src/platform-data-sync/platform-data-sync.runner.ts apps/api/src/platform-data-sync/platform-data-sync.runner.spec.ts
git commit -m "feat(data-sync): run PESDATA jobs asynchronously"
```

### Task 5: Add paginated platform queries and overview

**Files:**
- Create: `apps/api/src/platform-data-sync/platform-data-sync.service.ts`
- Create: `apps/api/src/platform-data-sync/platform-data-sync.service.spec.ts`
- Modify: `apps/api/src/team-catalog/team-catalog.service.ts`
- Modify: `apps/api/src/team-catalog/team-catalog.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 query/response contracts, existing sync/batch tables, and Task 3 platform read methods.
- Produces: `getOverview`, `listPlayerRuns`, `getPlayerRun`, `listPlayerBatches`, `listPlayerRecords`, `listTeamRuns`, `getTeamRun`, and `listTeamItems`.

- [ ] **Step 1: Write failing overview and pagination tests**

Seed 55 team items, 25 historical runs, and multiple player batches, then assert:

```ts
expect(await service.listTeamItems(adminId, runId, { page: 2, pageSize: 20, status: ['PENDING', 'FAILED'] }))
  .toMatchObject({ page: 2, pageSize: 20, total: 55 });
expect(result.items).toHaveLength(20);
expect(result.summary).toMatchObject({ pending: expect.any(Number), failed: expect.any(Number) });
expect((await service.listTeamRuns(adminId, { page: 2, pageSize: 20 }))).toMatchObject({ page: 2, total: 25 });
```

Add name/source-ID search and error-code aggregation assertions. Add a run with expired `PROCESS_INTERRUPTED` state and assert `resumable: true`.

- [ ] **Step 2: Run the service tests and verify they fail**

Run: `pnpm --filter @efm/api test -- --runInBand platform-data-sync.service.spec.ts team-catalog.service.spec.ts`

Expected: FAIL because the platform query service does not exist and team queries are not paginated.

- [ ] **Step 3: Implement whitelisted query parsing and overview aggregation**

Implement the methods with `AdminAuthorizationService.requirePlatformAdmin` at the service boundary. Use Prisma filters for enums/IDs, and parameterized SQL for JSON name search where Prisma cannot express `candidate_json`/`normalized_json` paths. Never interpolate search, sort, column, or direction values; map sort keys through a fixed whitelist.

- [ ] **Step 4: Implement paginated player and team reads**

Use `skip = (page - 1) * pageSize`, `take = pageSize`, matching `count`, and grouped status/error queries. Default review filters to pending and failed only when the client omits `status`; an explicit published filter must work.

- [ ] **Step 5: Run focused tests**

Run: `pnpm --filter @efm/api test -- --runInBand platform-data-sync.service.spec.ts team-catalog.service.spec.ts`

Expected: PASS, including 55-record page-2 and search-total assertions.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/platform-data-sync/platform-data-sync.service.ts apps/api/src/platform-data-sync/platform-data-sync.service.spec.ts apps/api/src/team-catalog/team-catalog.service.ts apps/api/src/team-catalog/team-catalog.service.spec.ts
git commit -m "feat(data-sync): add paginated sync review queries"
```

### Task 6: Add platform mutations, concrete audits, and HTTP routes

**Files:**
- Modify: `apps/api/src/platform-data-sync/platform-data-sync.service.ts`
- Modify: `apps/api/src/platform-data-sync/platform-data-sync.service.spec.ts`
- Create: `apps/api/src/platform-data-sync/platform-data-sync.controller.ts`
- Create: `apps/api/src/platform-data-sync/platform-data-sync.controller.spec.ts`
- Create: `apps/api/src/platform-data-sync/platform-data-sync.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/team-catalog/admin-team-catalog.controller.ts`
- Modify: `apps/api/src/team-catalog/team-catalog.service.ts`
- Modify: `apps/admin-web/src/platform/audit-presentation.ts`
- Modify: `apps/admin-web/src/platform/audit-presentation.spec.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4, and 5 service methods.
- Produces: the complete `/v1/admin/data-sync/*` HTTP API and concrete audit presentation labels.

- [ ] **Step 1: Write failing guard and `202` controller tests**

Assert controller metadata contains `AdminAuthGuard` and `AdminScopeGuard`, class metadata contains `@PlatformAdminOnly()`, and start/resume methods set HTTP status `202`. Assert the controller delegates only local services and returns a queued run DTO.

- [ ] **Step 2: Write failing mutation and partial-failure tests**

Cover single and batch team publish/reject/retry, plus player batch publish/reject. For `[validId, staleId, missingId]`, assert:

```ts
expect(result.requestedCount).toBe(3);
expect(result.succeededIds).toEqual([validId]);
expect(result.failed).toEqual(expect.arrayContaining([
  expect.objectContaining({ id: staleId, code: 'TEAM_SYNC_ITEM_NOT_PENDING' }),
  expect.objectContaining({ id: missingId, code: 'TEAM_SYNC_ITEM_NOT_FOUND' })
]));
```

Add a concurrent publish test proving a published item or batch is idempotent and does not create duplicate formal records.

- [ ] **Step 3: Run focused tests and verify they fail**

Run: `pnpm --filter @efm/api test -- --runInBand platform-data-sync.controller.spec.ts platform-data-sync.service.spec.ts team-catalog.service.spec.ts`

Expected: FAIL because routes and batch mutations are absent.

- [ ] **Step 4: Implement start/resume/review service methods**

Implement exact service methods:

```ts
startPlayerRun(adminId: string, input: StartPlatformSyncRequest): Promise<QueuedSyncRun>;
resumePlayerRun(adminId: string, runId: string): Promise<QueuedSyncRun>;
publishPlayerBatch(adminId: string, batchId: string): Promise<ImportBatchResponse>;
rejectPlayerBatch(adminId: string, batchId: string): Promise<ImportBatchResponse>;
startTeamRun(adminId: string, input: StartPlatformSyncRequest): Promise<QueuedSyncRun>;
resumeTeamRun(adminId: string, runId: string): Promise<QueuedSyncRun>;
publishTeamItems(adminId: string, ids: string[]): Promise<BatchMutationResult>;
rejectTeamItems(adminId: string, ids: string[]): Promise<BatchMutationResult>;
retryTeamItems(adminId: string, ids: string[]): Promise<BatchMutationResult>;
```

Run each team item in its own transaction so partial failure is reportable. Preserve single-item idempotence. Retry only `FAILED` items belonging to a non-active run.

- [ ] **Step 5: Record concrete audit actions**

Use stable action codes such as `START_PLAYER_CARD_INCREMENTAL_SYNC`, `RESUME_PLAYER_CARD_SYNC`, `PUBLISH_PLAYER_CARD_IMPORT_BATCH`, `START_TEAM_SHELL_FULL_SYNC`, `BATCH_PUBLISH_TEAM_SHELLS`, and `RETRY_TEAM_SHELL_SYNC_ITEMS`. Metadata includes mode, IDs/counts, successes, failures, and error codes. Extend admin audit presentation with matching Chinese labels and summaries.

- [ ] **Step 6: Implement platform-only controller and module**

Expose the exact routes from the design spec under `@Controller('admin/data-sync')`. Apply Zod pipes from Task 1 and `@HttpCode(202)` to starts/resumes. Remove only legacy sync routes from `AdminTeamCatalogController`; keep `GET /admin/team-catalog` and `POST /admin/team-catalog/custom` unchanged.

- [ ] **Step 7: Run API and audit presentation tests**

Run: `pnpm --filter @efm/api test -- --runInBand platform-data-sync.controller.spec.ts platform-data-sync.service.spec.ts team-catalog.service.spec.ts && pnpm --filter @efm/admin-web test -- audit-presentation.spec.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/platform-data-sync apps/api/src/app.module.ts apps/api/src/team-catalog apps/admin-web/src/platform/audit-presentation.ts apps/admin-web/src/platform/audit-presentation.spec.ts
git commit -m "feat(data-sync): expose platform sync operations"
```

### Task 7: Add the platform navigation and data-sync page shell

**Files:**
- Modify: `apps/admin-web/src/design-system/icons.tsx`
- Modify: `apps/admin-web/src/design-system/icons.spec.tsx`
- Modify: `apps/admin-web/src/application-shell.tsx`
- Modify: `apps/admin-web/src/leagues/league-shell.spec.tsx`
- Modify: `apps/admin-web/src/app.tsx`
- Create: `apps/admin-web/src/platform/data-sync/data-sync-page.tsx`
- Create: `apps/admin-web/src/platform/data-sync/data-sync-page.spec.tsx`
- Create: `apps/admin-web/src/platform/data-sync/use-sync-run.ts`
- Create: `apps/admin-web/src/platform/data-sync/use-sync-run.spec.tsx`
- Create: `apps/admin-web/src/platform/data-sync/sync-run-card.tsx`

**Interfaces:**
- Consumes: Task 1 overview/run schemas and Task 6 endpoints.
- Produces: `/platform/data-sync`, shared player/team tab shell, and terminal-aware polling used by Tasks 8 and 9.

- [ ] **Step 1: Write failing navigation/page tests**

Assert a platform administrator sees a “数据同步” link with `.admin-icon`, a league-only administrator does not, and the route renders two tabs named “球员卡” and “球队队壳”.

- [ ] **Step 2: Write failing polling-hook tests with fake timers**

Assert the hook polls every 2,500 ms while status is `PENDING` or `RUNNING`, stops for `READY`/`FAILED`, cancels timers on unmount, and immediately refreshes after a start/resume mutation.

- [ ] **Step 3: Run focused frontend tests and verify they fail**

Run: `pnpm --filter @efm/admin-web test -- league-shell.spec.tsx data-sync-page.spec.tsx use-sync-run.spec.tsx icons.spec.tsx`

Expected: FAIL because the route/components/icon do not exist.

- [ ] **Step 4: Implement the navigation, route, page shell, and hook**

Add `sync` to `AdminIconName`; use a circular-arrows path and label “数据同步”. Lazy-load `DataSyncPage` in `app.tsx`. Keep tab state in the URL query `?tab=players|teams`, defaulting to `players`, so refresh/back navigation preserves context.

- [ ] **Step 5: Implement the shared run card**

`SyncRunCard` receives `kind`, current run, counters, `onStart(mode)`, and `onResume()`. It shows sample/incremental/full actions, requires Ant Design confirmation for full mode, and never labels `READY` as published.

- [ ] **Step 6: Run focused tests**

Run: `pnpm --filter @efm/admin-web test -- league-shell.spec.tsx data-sync-page.spec.tsx use-sync-run.spec.tsx icons.spec.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/src/app.tsx apps/admin-web/src/application-shell.tsx apps/admin-web/src/design-system apps/admin-web/src/leagues/league-shell.spec.tsx apps/admin-web/src/platform/data-sync
git commit -m "feat(admin-web): add platform data sync workspace"
```

### Task 8: Build the paginated player-card review panel

**Files:**
- Create: `apps/admin-web/src/platform/data-sync/player-sync-panel.tsx`
- Create: `apps/admin-web/src/platform/data-sync/player-sync-panel.spec.tsx`
- Modify: `apps/admin-web/src/platform/data-sync/data-sync-page.tsx`
- Modify: `apps/admin-web/src/styles.css`

**Interfaces:**
- Consumes: Task 6 player run/batch/record endpoints and Task 7 `SyncRunCard`/polling hook.
- Produces: player-card task control, batch table, record table, detail drawer, and batch publication UI.

- [ ] **Step 1: Write failing panel tests**

Test that the panel:

```ts
expect(request).toHaveBeenCalledWith(expect.stringContaining('page=2&pageSize=20'), expect.anything());
expect(screen.getByText('共 43000 条')).toBeInTheDocument();
expect(screen.queryByText('第 21 条以后未请求的数据')).not.toBeInTheDocument();
```

Also assert default status filters omit published batches, page-size choices are only 20/50, clicking a record opens a drawer with field differences/errors, publishing confirms the affected whole batch, and a partial API error remains visible.

- [ ] **Step 2: Run the panel test and verify it fails**

Run: `pnpm --filter @efm/admin-web test -- player-sync-panel.spec.tsx`

Expected: FAIL because the panel does not exist.

- [ ] **Step 3: Implement batch and record tables**

Use Ant Design controlled pagination and filter state. Fetch only the selected page. Show image/name/card type/pack/position/overall/source ID/diff/status/error. Use `ImportBatch.id` as the publication selection unit even when the user begins from a record. Render task history in a separate paginated table so old runs do not enlarge the review table.

- [ ] **Step 4: Implement drawer and publication states**

Display normalized data, validation errors, and field diff without rendering full upstream raw responses. Disable publish for invalid/non-ready batches. After success refresh overview, batches, and current records; after failure preserve filters/page and show the specific returned error.

- [ ] **Step 5: Run panel tests**

Run: `pnpm --filter @efm/admin-web test -- player-sync-panel.spec.tsx data-sync-page.spec.tsx`

Expected: PASS, including page-2 request and whole-batch confirmation.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/src/platform/data-sync/player-sync-panel.tsx apps/admin-web/src/platform/data-sync/player-sync-panel.spec.tsx apps/admin-web/src/platform/data-sync/data-sync-page.tsx apps/admin-web/src/styles.css
git commit -m "feat(admin-web): add player sync review panel"
```

### Task 9: Build the team-shell panel and remove the league-page sync card

**Files:**
- Create: `apps/admin-web/src/platform/data-sync/team-sync-panel.tsx`
- Create: `apps/admin-web/src/platform/data-sync/team-sync-panel.spec.tsx`
- Modify: `apps/admin-web/src/platform/data-sync/data-sync-page.tsx`
- Modify: `apps/admin-web/src/leagues/teams-page.tsx`
- Modify: `apps/admin-web/src/leagues/teams-page.spec.tsx`
- Delete: `apps/admin-web/src/leagues/team-catalog-sync-card.tsx`
- Delete: `apps/admin-web/src/leagues/team-catalog-sync-card.spec.tsx`
- Modify: `apps/admin-web/src/styles.css`

**Interfaces:**
- Consumes: Task 6 team run/item/mutation endpoints and Task 7 shared run components.
- Produces: the final team-shell sync UI in its platform-only location.

- [ ] **Step 1: Write failing team-panel pagination and default-filter tests**

Mock 981 total items and assert only 20 rows render, the request contains pending/failed defaults, published items appear only after selecting published, error-reason chips apply `errorCode`, and changing page size to 50 sends `page=1&pageSize=50`.

- [ ] **Step 2: Write failing batch-action/detail tests**

Select two pending rows and one stale row; assert the confirmation shows three IDs and the result reports success and failure separately. Assert the drawer shows old/new names, crest URLs/checksums, change type, and specific error without displaying opaque full raw JSON.

- [ ] **Step 3: Write the failing league-page regression test**

Assert `TeamsPage` does not render “PESDATA 队壳同步” and does not request `/sync-runs`, while existing team list/create and local team-shell picker behavior still work.

- [ ] **Step 4: Run focused tests and verify they fail**

Run: `pnpm --filter @efm/admin-web test -- team-sync-panel.spec.tsx teams-page.spec.tsx`

Expected: FAIL until the new panel is connected and the old card is removed.

- [ ] **Step 5: Implement the team panel**

Add controlled filters for review status, change type, source league, error reason, and query. Support explicit-ID publish/reject/retry with a maximum of 100 selected rows. Preserve selection only for IDs still present/eligible after refresh. Render task history in its own server-paginated table.

- [ ] **Step 6: Remove the legacy league sync card**

Remove its import/render and obsolete CSS. Delete the component/test only after the new panel covers local-API-only behavior and explicit publication.

- [ ] **Step 7: Run focused frontend tests**

Run: `pnpm --filter @efm/admin-web test -- team-sync-panel.spec.tsx teams-page.spec.tsx data-sync-page.spec.tsx`

Expected: PASS; no `/v1/admin/team-catalog/sync-*` request remains in the admin web.

- [ ] **Step 8: Commit**

```bash
git add -A apps/admin-web/src/platform/data-sync apps/admin-web/src/leagues apps/admin-web/src/styles.css
git commit -m "feat(admin-web): move team sync to platform center"
```

### Task 10: Document operations and complete end-to-end verification

**Files:**
- Modify: `docs/development/pesdata-sync.md`
- Modify: `docs/development/pesdata-team-sync.md`
- Modify as required by failures: files changed in Tasks 1–9 only

**Interfaces:**
- Consumes: the completed API and admin web.
- Produces: operator instructions and a verified branch ready for review.

- [ ] **Step 1: Update operator documentation**

Document `/platform/data-sync`, mode meanings, pending versus published, progress polling, stale-run `PROCESS_INTERRUPTED`, explicit resume, full-sync confirmation, 20/50 pagination, error filters, and CLI fallback. State that server restart does not require losing progress and does not auto-resume work.

- [ ] **Step 2: Run database and contract validation**

Run: `pnpm db:generate && pnpm --filter @efm/contracts test && pnpm --filter @efm/contracts typecheck`

Expected: PASS.

- [ ] **Step 3: Run all focused API suites**

Run: `pnpm --filter @efm/api test -- --runInBand platform-data-sync player-import pesdata-sync pesdata-team-sync team-catalog audit-log`

Expected: PASS with no open handles or unhandled promise rejections.

- [ ] **Step 4: Run the complete repository verification**

Run: `pnpm verify`

Expected: lint, typecheck, unit tests, e2e tests, and builds all PASS.

- [ ] **Step 5: Perform local browser smoke verification**

Verify as a platform administrator:

1. `/platform/data-sync` opens and both tabs work;
2. a sample run returns immediately and progress changes without a page reload;
3. leaving and returning shows the same run;
4. player batches publish only after confirmation;
5. team items paginate and partial batch failure is visible;
6. `/leagues/:leagueId/teams` contains no sync card;
7. audit logs show concrete Chinese actions.

- [ ] **Step 6: Commit documentation and any verification-only fixes**

```bash
git add docs/development/pesdata-sync.md docs/development/pesdata-team-sync.md
git commit -m "docs(data-sync): document platform sync operations"
```

- [ ] **Step 7: Request whole-branch code review**

Use `superpowers:requesting-code-review` against the implementation diff, resolve findings, and rerun `pnpm verify` before claiming completion.
