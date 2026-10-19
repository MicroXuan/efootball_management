# Bulk Player Batch Publication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-card database publication with an atomic bulk pipeline that publishes 50 cards and 500 skill links within 30 seconds while using a 60-second production transaction limit.

**Architecture:** Parse and fingerprint the immutable batch before opening the transaction, then lock and revalidate it inside the transaction. A pure planner merges existing state with reviewed changes and emits complete table-level write sets; a repository prefetches state and writes those sets in fixed bulk phases, while the publisher retains authorization, idempotency, auditing, rollback, and error mapping.

**Tech Stack:** Node.js 24, TypeScript 5.9, NestJS 12, Prisma 7 with MariaDB/MySQL, Jest 29, Zod contracts.

**Spec:** `docs/superpowers/specs/2026-10-19-bulk-player-batch-publication-design.zh-CN.md`

## Global Constraints

- Production publication transaction timeout is exactly `60_000` ms.
- Both 10 cards/100 skill links and 50 cards/500 skill links must complete within `30_000` ms.
- Publication remains one atomic transaction; no partial commits or message queue.
- Database I/O may grow only by configured SQL chunk count, never once per card or skill.
- Bulk SQL uses parameterized `Prisma.sql`; imported values must never be interpolated into raw SQL text.
- Preserve `UPDATE` field ownership: only keys present in `fieldDiff` may replace existing source-owned values.
- `UNCHANGED` records contribute to release counts but do not write catalog rows or versions.
- A `P2028` is returned as HTTP 503 with code `IMPORT_PUBLISH_TIMEOUT` and message `批次发布超时，数据已回滚，可安全重试`.
- Do not modify the sync data model, admin confirmation flow, or Prisma schema.
- Preserve all unrelated dirty worktree files. Stage and commit only the files named by each task.

## Review Focus

- A batch changes after its transaction-external parse: reject the stale snapshot instead of publishing mismatched records (Task 3 test).
- Two records share a player identity or pack identity: emit one parent row and point every dependent row to the same ID (Task 1 test).
- An update clears all skills or removes a pack: delete stale relationships and persist `NULL` without recreating old values (Tasks 1 and 3 tests).
- Two callers publish the same batch concurrently: create one release and one version per changed card, and return the same release to both callers (Task 3 test).
- Repeated identities carry different reviewed values or a later bulk phase fails: preserve row-order last-write semantics, or roll back every catalog table and leave the batch `READY` (Tasks 1-3 tests).

---

### Task 1: Pure Publication Planner

**Files:**
- Create: `apps/api/src/player-import/player-import-publication.types.ts`
- Create: `apps/api/src/player-import/player-import-publication-plan.ts`
- Create: `apps/api/src/player-import/player-import-publication-plan.spec.ts`

**Interfaces:**
- Consumes: `NormalizedPlayerCardRecord`, `ImportDiffType`, existing catalog state, `selectBestCard`.
- Produces: `PreparedPublicationRecord`, `PlayerImportPublicationState`, `PlayerImportPublicationPlan`, `publicationSnapshotKey(records)`, and `buildPlayerImportPublicationPlan(input): PlayerImportPublicationPlan`.

- [ ] **Step 1: Define planner contract tests**

Add tests named:

- `creates one complete write graph and version snapshot`;
- `overlays only reviewed update fields on existing rows`;
- `reuses one player and pack id for repeated source identities`;
- `applies repeated identity changes in source row order with the last reviewed value winning`;
- `deduplicates skills and emits an empty replacement for cleared skills`;
- `sets cardPackId to null when packExternalId is reviewed away`;
- `selects one best card from existing and planned builds per affected player`;
- `changes the snapshot key when record identity or reviewed content changes`.

Assert exact IDs by injecting `newId: () => fixtureIds.shift()!`; assert the version snapshot contains the final player, pack, card, attributes, and normalized skill codes rather than pre-update values.

- [ ] **Step 2: Run the planner spec and verify RED**

Run: `pnpm --filter @efm/api test -- player-import-publication-plan.spec.ts --runInBand`

Expected: FAIL because the planner modules do not exist.

- [ ] **Step 3: Add shared publication types**

In `player-import-publication.types.ts`, define:

```ts
export type PreparedPublicationRecord = {
  id: string;
  diffType: 'CREATE' | 'UPDATE';
  changedFields: ReadonlySet<string>;
  targetPlayerId: string | null;
  value: NormalizedPlayerCardRecord;
};

export type BuildPublicationPlanInput = {
  sourceId: string;
  records: readonly PreparedPublicationRecord[];
  state: PlayerImportPublicationState;
  releaseSequence: number;
  publishedAt: Date;
  newId?: () => string;
};
```

Define `PlayerImportPublicationState` as maps keyed by source business identity for players, player sources, packs, cards, attributes, skills, builds, and best-card candidates. Define `PlayerImportPublicationPlan` as table-level arrays plus `replaceSkillCardIds` and `affectedPlayerIds`. Use generated Prisma payload types where they make the contract narrower; use explicit row types where raw bulk SQL requires IDs and timestamps.

- [ ] **Step 4: Implement snapshot fingerprint and pure planner**

Implement:

```ts
export function publicationSnapshotKey(records: readonly PreparedPublicationRecord[]): string;
export function buildPlayerImportPublicationPlan(
  input: BuildPublicationPlanInput
): PlayerImportPublicationPlan;
```

Use SHA-256 over stable JSON containing record ID, diff type, sorted changed fields, target player ID, and normalized value. Merge reviewed fields onto existing rows, allocate UUIDs before dependent rows, normalize skill codes with `normalizeSearchText`, and reuse `selectBestCard` for the final candidate set.

- [ ] **Step 5: Run planner tests and typecheck**

Run: `pnpm --filter @efm/api test -- player-import-publication-plan.spec.ts --runInBand && pnpm --filter @efm/api typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the planner**

```bash
git add apps/api/src/player-import/player-import-publication.types.ts apps/api/src/player-import/player-import-publication-plan.ts apps/api/src/player-import/player-import-publication-plan.spec.ts
git commit -m "refactor(api): plan player imports in bulk"
```

### Task 2: Bounded Prefetch and Bulk Repository

**Files:**
- Create: `apps/api/src/player-import/player-import-publication.repository.ts`
- Create: `apps/api/src/player-import/player-import-publication.repository.spec.ts`
- Modify: `apps/api/src/player-import/player-import-publication.types.ts`

**Interfaces:**
- Consumes: `PreparedPublicationRecord`, `PlayerImportPublicationPlan`, Prisma transaction client.
- Produces: `PUBLICATION_SQL_CHUNK_SIZE = 500`, `loadPlayerImportPublicationState(tx, input): Promise<PlayerImportPublicationState>`, and `writePlayerImportPublicationPlan(tx, plan): Promise<void>`.

- [ ] **Step 1: Write failing repository shape tests**

Use instrumented transaction doubles to add tests named:

- `prefetches ten and fifty cards with the same database operation categories`;
- `writes ten and fifty cards with the same operation categories below the chunk boundary`;
- `adds exactly one operation per additional five-hundred-row chunk`;
- `deletes all reviewed skill links before inserting replacements`;
- `parameterizes quotes and unicode in bulk values`;
- `stops immediately when a bulk phase fails`.

Compare ordered operation names, not wall-clock time. The 10-card and 50-card cases must produce the same category sequence and must contain no operation nested inside an input-record loop.

- [ ] **Step 2: Run repository tests and verify RED**

Run: `pnpm --filter @efm/api test -- player-import-publication.repository.spec.ts --runInBand`

Expected: FAIL because repository functions do not exist.

- [ ] **Step 3: Implement bounded state loading**

Implement:

```ts
export async function loadPlayerImportPublicationState(
  tx: Transaction,
  input: { sourceId: string; records: readonly PreparedPublicationRecord[] }
): Promise<PlayerImportPublicationState>;
```

Collect all source external IDs and normalized skill codes first. Fetch each entity category with one `findMany` query: player sources with players, packs, cards with player/pack/attributes/skills/builds, missing target players, skills, and best-card candidates for affected player IDs. Empty ID sets must skip their query rather than issue `IN ()`.

- [ ] **Step 4: Implement parameterized bulk writes**

Implement:

```ts
export const PUBLICATION_SQL_CHUNK_SIZE = 500;
export async function writePlayerImportPublicationPlan(
  tx: Transaction,
  plan: PlayerImportPublicationPlan
): Promise<void>;
```

Write phases in foreign-key order: players, player sources, packs, cards, attributes, skills, skill replacement delete/create, builds, best cards, and versions. Use `createMany` where rows are insert-only; use parameterized MySQL multi-row upsert for heterogeneous final rows. Every raw upsert must explicitly preserve `created_at` and advance `updated_at`, matching Prisma `@updatedAt` behavior; skill conflicts must refresh `name_en`. Split only at 500 rows and keep every chunk in the caller's transaction.

- [ ] **Step 5: Run repository and planner tests**

Run: `pnpm --filter @efm/api test -- player-import-publication-plan.spec.ts player-import-publication.repository.spec.ts --runInBand && pnpm --filter @efm/api typecheck`

Expected: PASS with identical operation categories for 10-card and 50-card fixtures.

- [ ] **Step 6: Commit the repository**

```bash
git add apps/api/src/player-import/player-import-publication.types.ts apps/api/src/player-import/player-import-publication.repository.ts apps/api/src/player-import/player-import-publication.repository.spec.ts
git commit -m "refactor(api): bulk write player import graphs"
```

### Task 3: Publisher Orchestration, Idempotency, and Rollback

**Files:**
- Modify: `apps/api/src/player-import/player-import.publisher.ts`
- Modify: `apps/api/src/player-import/player-import.publisher.spec.ts`
- Modify: `apps/api/src/player-catalog/player-catalog.service.spec.ts`

**Interfaces:**
- Consumes: planner and repository functions from Tasks 1-2, `AuditLogService`, current authorization services.
- Produces: `PLAYER_IMPORT_PUBLICATION_TIMEOUT_MS = 60_000`, `preparePlayerImportPublication(prisma, batchId)`, and package-internal `executePlayerImportPublication(tx, input)` for the publisher and rollback checker.

- [ ] **Step 1: Extend publisher regression tests**

Add or retain tests named:

- `publishes a complete CREATE graph and immutable version`;
- `updates only reviewed source fields and clears reviewed pack and skills`;
- `rejects a stale transaction-external publication snapshot`;
- `returns one release for concurrent publish calls`;
- `rolls back every formal row when bulk writing fails`;
- `rolls back publication when audit writing fails`;
- `uses a sixty-second transaction timeout`;
- `returns a retry-safe IMPORT_PUBLISH_TIMEOUT response for P2028`.

For timeout capture, supply a Prisma double whose `$transaction` records its options and assert `{ timeout: 60_000 }`. Update the synthetic P2028 metadata timeout from `30_000` to `60_000`.

- [ ] **Step 2: Run publisher spec and verify RED**

Run: `pnpm --filter @efm/api test -- player-import.publisher.spec.ts --runInBand`

Expected: at least the 60-second option, stale snapshot, and bulk rollback tests FAIL against the current partial optimization.

- [ ] **Step 3: Prepare and fingerprint outside the transaction**

Add:

```ts
export const PLAYER_IMPORT_PUBLICATION_TIMEOUT_MS = 60_000;

export type PreparedPlayerImportPublication = {
  batchId: string;
  preparedRecords: readonly PreparedPublicationRecord[];
  snapshotKey: string;
};

export type ImportBatchWithSourceAndRelease = Prisma.ImportBatchGetPayload<{
  include: { source: true; release: true };
}>;

export async function preparePlayerImportPublication(
  prisma: PrismaService,
  batchId: string
): Promise<PreparedPlayerImportPublication>;

export type ExecutePlayerImportPublicationInput = {
  actorId: string;
  batchId: string;
  platformAdmin: boolean;
  preparedRecords: readonly PreparedPublicationRecord[];
  snapshotKey: string;
  audit?: AuditLogService;
};

export async function executePlayerImportPublication(
  tx: Transaction,
  input: ExecutePlayerImportPublicationInput
): Promise<ImportBatchWithSourceAndRelease>;
```

`publishUnchecked` calls `preparePlayerImportPublication` before the transaction. The executor locks the batch, reloads records, returns the existing release for `PUBLISHED`, verifies `READY` and the snapshot key, creates the release, loads state, builds/writes the plan, updates the batch, and records the platform audit. The rollback checker in Task 5 reuses the same preparation function rather than duplicating parsing rules.

- [ ] **Step 4: Remove the per-record publication path**

Delete `publishRecord`, `prepareSkills`, and `createVersion` after all behavior is represented by the planner/repository. Remove the `PlayerBuildsService` constructor dependency from `PlayerImportPublisher` only after updating instantiations in `player-import.publisher.spec.ts` and `player-catalog.service.spec.ts`; do not change `PlayerBuildsService` itself.

- [ ] **Step 5: Preserve exact error and concurrency semantics**

Run the transaction with `{ timeout: PLAYER_IMPORT_PUBLICATION_TIMEOUT_MS }`. Map only Prisma `P2028` to the specified HTTP 503. For `P2002`, re-read the batch and return success only when it is already `PUBLISHED` with a release; otherwise rethrow.

- [ ] **Step 6: Run all player import tests and typecheck**

Run: `pnpm --filter @efm/api test -- player-import --runInBand && pnpm --filter @efm/api typecheck`

Expected: PASS.

- [ ] **Step 7: Commit publisher integration**

```bash
git add apps/api/src/player-import/player-import.publisher.ts apps/api/src/player-import/player-import.publisher.spec.ts apps/api/src/player-catalog/player-catalog.service.spec.ts
git commit -m "fix(api): publish player batches atomically in bulk"
```

### Task 4: Database Performance and Query-Shape Regression

**Files:**
- Modify: `apps/api/src/player-import/player-import.publisher.spec.ts`

**Interfaces:**
- Consumes: public `PlayerImportPublisher.publish`, actual MariaDB test database, existing publisher fixture cleanup.
- Produces: timed integration coverage for 10/100 and 50/500 plus automatic artifact cleanup.

- [ ] **Step 1: Write the 50-card failing performance test**

Keep the 10-card/100-skill case and add `publishes fifty cards with five hundred skill links within thirty seconds`. Measure only `publisher.publish(...)` with `performance.now()`. Assert `elapsedMs < 30_000`, 50 cards, 500 skill links, 50 versions, expected builds, and one release. Give Jest a `70_000` ms test timeout so a product timeout reports its own error.

- [ ] **Step 2: Run both performance tests before final tuning**

Run: `pnpm --filter @efm/api test -- player-import.publisher.spec.ts --runInBand -t "within thirty seconds"`

Expected: the new 50-card case either fails before repository integration is complete or passes with recorded time below 30 seconds; it must never be weakened to the 60-second transaction ceiling.

- [ ] **Step 3: Add mixed-graph database assertions**

Add `bulk publication preserves mixed create update unchanged and clear semantics`. Seed an initial published graph, then publish a batch containing one new card, one field update, one skill clear, one pack removal, and one unchanged record. Assert final rows, version counts, and release counts exactly match the reviewed diff.

- [ ] **Step 4: Ensure automatic cleanup covers every performance artifact**

Extend the spec's `afterEach` to collect skill IDs before deleting cards, then delete those skills only when `cards: { none: {} }` after the cards are gone. Keep the existing explicit order for best-card rows, builds, versions, releases, batches, cards, packs, player sources, players, and source. This makes every focused run remove its own artifacts without relying on suite-level global cleanup.

- [ ] **Step 5: Run focused integration tests three times**

Run three consecutive times:

`pnpm --filter @efm/api test -- player-import.publisher.spec.ts --runInBand`

Expected each time: PASS; both performance cases remain below 30 seconds; the next run starts without duplicate-key or foreign-key cleanup failures.

- [ ] **Step 6: Commit performance coverage**

```bash
git add apps/api/src/player-import/player-import.publisher.spec.ts
git commit -m "test(api): enforce bulk publication performance"
```

### Task 5: Rollback-Only Acceptance Runner

**Files:**
- Create: `apps/api/src/player-import/player-import-publication.rollback-check.ts`
- Create: `apps/api/src/player-import/player-import-publication.rollback-check.spec.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: `executePlayerImportPublication`, Prisma, an existing batch ID and platform admin ID.
- Produces: local CLI command `pnpm --filter @efm/api player-import:rollback-check -- --batch-id BATCH_ID --admin-id ADMIN_ID --repeat 3` that can never commit the tested publication.

- [ ] **Step 1: Write failing CLI and rollback tests**

Add tests named:

- `requires batch id admin id and a positive repeat count`;
- `throws a private rollback sentinel after the full publication graph`;
- `reports failure when any before and after count differs`;
- `runs the requested number of successful rollback checks`.

Inject Prisma and the executor in tests. Assert the sentinel is swallowed only by this runner; any other error fails the command.

- [ ] **Step 2: Run rollback checker spec and verify RED**

Run: `pnpm --filter @efm/api test -- player-import-publication.rollback-check.spec.ts --runInBand`

Expected: FAIL because the runner does not exist.

- [ ] **Step 3: Implement a non-API rollback checker**

Export:

```ts
export type RollbackCheckOptions = {
  batchId: string;
  adminId: string;
  repeat: number;
  performanceTargetMs: number;
};

export type RollbackCheckResult = {
  attempt: number;
  elapsedMs: number;
  before: Readonly<Record<string, number>>;
  after: Readonly<Record<string, number>>;
};

export async function runPublicationRollbackChecks(
  prisma: PrismaService,
  options: RollbackCheckOptions
): Promise<readonly RollbackCheckResult[]>;
```

For each attempt: capture impacted table counts, start a transaction with timeout `60_000`, lock and execute the full publication path including audit, assert elapsed time below `30_000`, throw a module-private rollback sentinel, then capture counts again and require exact equality. Also require the batch to remain `READY`, `publishedAt` to remain null, and release count to remain zero.

Guard the CLI entrypoint with an `import.meta.url` check so importing the module from Jest never connects to the database or reads process arguments.

- [ ] **Step 4: Add the package script and run unit tests**

Add `"player-import:rollback-check": "tsx src/player-import/player-import-publication.rollback-check.ts"` to `apps/api/package.json`.

Run: `pnpm --filter @efm/api test -- player-import-publication.rollback-check.spec.ts --runInBand && pnpm --filter @efm/api typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the rollback checker**

```bash
git add apps/api/src/player-import/player-import-publication.rollback-check.ts apps/api/src/player-import/player-import-publication.rollback-check.spec.ts apps/api/package.json
git commit -m "test(api): add rollback-only publication acceptance"
```

### Task 6: Real Batch Acceptance and Final Verification

**Files:**
- Verify only: all files created or modified by Tasks 1-5; fixes return to the task that owns the failing behavior.

**Interfaces:**
- Consumes: committed bulk publisher and rollback checker.
- Produces: evidence that the current real batch reaches the rollback sentinel three times under 30 seconds with zero persisted changes.

- [ ] **Step 1: Record the current real batch baseline**

For batch `c52b0b54-1869-4324-ab78-2c4d1d07e61e`, read status, `publishedAt`, release count, and impacted catalog counts. Expected starting state: `READY`, null `publishedAt`, zero releases. Stop without running acceptance if this baseline has changed.

- [ ] **Step 2: Execute three rollback-only passes**

Run:

```bash
pnpm --filter @efm/api player-import:rollback-check -- \
  --batch-id c52b0b54-1869-4324-ab78-2c4d1d07e61e \
  --admin-id 11d8516c-2d1d-49f9-92c9-a27d951c2f97 \
  --repeat 3
```

Expected: three PASS results, each below `30_000` ms, with identical before/after counts. The real batch remains un-published.

- [ ] **Step 3: Run focused verification**

Run:

```bash
pnpm --filter @efm/api test -- player-import-publication player-import.publisher.spec.ts --runInBand
pnpm --filter @efm/api typecheck
pnpm --filter @efm/api build
git diff --check
```

Expected: all commands PASS.

- [ ] **Step 4: Run broader API verification**

Run:

```bash
pnpm --filter @efm/api test -- --runInBand
pnpm --filter @efm/api test:e2e -- --runInBand
pnpm --filter @efm/api lint
```

Expected: PASS. If an unrelated existing failure occurs, rerun the failing test once, record its exact output and ownership, and do not misreport it as fixed.

- [ ] **Step 5: Review the final diff**

Confirm no unrelated dirty files are staged, no diagnostic data was committed, and every plan-owned modification belongs to one of the Task 1-5 commits. If verification exposes a defect, return to that owning task's failing test, implement the smallest fix, rerun its verification, and amend it with a new scoped commit before repeating Task 6.

- [ ] **Step 6: Hand off real publication to the user**

Report measured times, focused/full verification results, unchanged real-batch counts, and the exact batch ID. Do not invoke the real publish endpoint; the user performs the final publication from the admin interface.
