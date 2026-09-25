# PESDATA Catalog Synchronization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an authorized, resumable PESDATA synchronization command that maps source player details into one or more existing reviewable import batches without publishing automatically.

**Architecture:** A source-specific `PesdataClient` owns request signing, response validation, throttling, and retry behavior. `PesdataMapper` converts validated source detail into the existing normalized import shape, while `PesdataSyncService` persists run/item checkpoints and sends stable chunks of at most 5,000 records through `PlayerImportService`.

**Tech Stack:** Node.js 24, TypeScript 5.9, NestJS 12, Zod 4, Prisma 7, MariaDB/MySQL, Jest, native `fetch`

**Spec:** `docs/superpowers/specs/2026-09-25-pesdata-sync-design.md`

## Global Constraints

- PESDATA access is authorized, but there is no official API documentation or API key.
- The mini-program must never call PESDATA or contain source signing material.
- Default detail request rate is at most one request per second with one in-flight request.
- HTTP 429, 5xx, connection failures, and timeouts retry at most five times with jittered exponential backoff.
- Protocol/signature/response-shape failures stop the run instead of manufacturing invalid data.
- Import chunks contain at most 5,000 records and are never published automatically.
- Missing source records never automatically deactivate a published card.
- Images remain source URLs in this phase; do not bulk-download assets.
- Sync output and logs must not expose signing material, cookies, or complete request headers.

## Review Focus

- A changed or missing signature parameter must produce `PESDATA_PROTOCOL_ERROR`, not endless retries; Task 3 tests this.
- A source total above 5,000 must create deterministic multiple batches with no duplicates or omissions; Task 5 tests this.
- Resuming after a process interruption must not refetch successfully stored details; Task 5 tests this.
- A changing upstream `count` while paging must stop from actual page exhaustion without looping forever; Task 5 tests this.
- Unknown card type, optional multilingual field, or non-numeric metadata must remain available in raw/attribute JSON without breaking the mini-program's numeric bars; Tasks 1 and 4 test this.

---

### Task 1: Support rich source attributes without breaking numeric detail bars

**Files:**
- Modify: `packages/contracts/src/player-import.ts`
- Modify: `packages/contracts/src/player-catalog.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/player-card-detail/detail.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/player-card-detail/detail.viewmodel.spec.ts`

**Interfaces:**
- Produces: `PlayerAttributeValueSchema` accepting valid JSON values and `attributes: Record<string, JsonValue>` in import/catalog contracts.
- Produces: `toCardDetailViewModel()` that renders only finite numeric attributes as progress bars while retaining the complete detail response type.

- [ ] **Step 1: Write failing contract and view-model tests**

Add assertions showing a record accepts strings, booleans, arrays, and nested objects in `attributes`, and showing the detail view model excludes non-numeric values from its `attributes` bar array:

```ts
expect(NormalizedPlayerCardRecordSchema.parse({
  externalId: '8801',
  playerNameEn: 'Authorized Player',
  cardName: 'Epic Test',
  position: 'CB',
  overallRating: 87,
  cardType: 'EPIC',
  attributes: {
    speed: 77,
    foot: 'RIGHT',
    positionHot: ['CB', 'DMF'],
    boost: { Tackling: 2 }
  }
}).attributes).toEqual(expect.objectContaining({ foot: 'RIGHT' }));
```

```ts
expect(toCardDetailViewModel(detail).attributes).toEqual([
  expect.objectContaining({ key: 'speed', value: 77 })
]);
```

- [ ] **Step 2: Run RED tests**

Run:

```bash
pnpm --filter @efm/contracts test
pnpm --filter @efm/miniprogram test -- detail.viewmodel.spec.ts
```

Expected: contract parsing rejects non-number values and/or the view model produces non-number bar values.

- [ ] **Step 3: Implement JSON attributes and numeric filtering**

Use Zod's JSON schema for persisted source metadata:

```ts
export const PlayerAttributesSchema = z.record(z.string(), z.json());
```

Apply it to both normalized imports and player-card details. In `toCardDetailViewModel`, filter entries with `typeof value === 'number' && Number.isFinite(value)` before sorting and mapping.

- [ ] **Step 4: Run GREEN tests and type checks**

Run:

```bash
pnpm --filter @efm/contracts test
pnpm --filter @efm/contracts typecheck
pnpm --filter @efm/miniprogram test
pnpm --filter @efm/miniprogram typecheck
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts apps/miniprogram/miniprogram/pages/player-card-detail
git commit -m "feat(contracts): support rich player card attributes"
```

### Task 2: Persist synchronization runs and checkpoints

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260925030000_pesdata_sync/migration.sql`
- Modify: `apps/api/prisma/seed.ts`
- Modify: `apps/api/src/database/prisma.service.spec.ts`

**Interfaces:**
- Produces Prisma delegates: `externalSyncRun` and `externalSyncItem`.
- Produces data source `pesdata` with type `API`.
- Produces `ExternalSyncRunBatch` relations that allow one idempotently reused import batch to be referenced by multiple runs.

- [ ] **Step 1: Write the failing Prisma delegate test**

Extend `prisma.service.spec.ts`:

```ts
expect(prisma.externalSyncRun).toBeDefined();
expect(prisma.externalSyncItem).toBeDefined();
expect(prisma.externalSyncRunBatch).toBeDefined();
```

- [ ] **Step 2: Run RED test**

Run:

```bash
pnpm --filter @efm/api test -- prisma.service.spec.ts --runInBand
```

Expected: TypeScript/test failure because the generated client has no synchronization delegates.

- [ ] **Step 3: Add enums and models**

Add these enum values:

```prisma
enum ExternalSyncMode { SAMPLE FULL INCREMENTAL }
enum ExternalSyncStatus { PENDING RUNNING READY PAUSED FAILED }
enum ExternalSyncItemStatus { PENDING FETCHED SKIPPED FAILED }
```

Add `ExternalSyncRun` fields for `sourceId`, `actorId`, `mode`, `status`, nullable `activeLeaseKey @unique`, requested limit, source total, scanned/fetched/skipped/failed counters, current offset, error code/message, start/end timestamps, and relations to items and run-batch links. Add `ExternalSyncItem` fields for run ID, external ID, summary/detail checksums, status, nullable raw detail and normalized JSON, attempts, last error, and timestamps, with `@@unique([runId, externalId])`. Add `ExternalSyncRunBatch` with `runId`, `batchId`, one-based `chunkIndex`, `@@id([runId, batchId])`, and `@@unique([runId, chunkIndex])`; relate it to `ImportBatch` without making `batchId` unique so an idempotently reused batch can be linked to later runs.

- [ ] **Step 4: Generate and inspect the migration**

Run:

```bash
pnpm db:generate
pnpm db:migrate:dev -- --name pesdata_sync
pnpm db:status
```

Expected: migration applies to local MariaDB and status reports all migrations applied.

- [ ] **Step 5: Seed the authorized source**

Add an idempotent upsert:

```ts
await transaction.dataSource.upsert({
  where: { code: 'pesdata' },
  update: { name: 'PESDATA authorized sync', type: 'API', isEnabled: true },
  create: { code: 'pesdata', name: 'PESDATA authorized sync', type: 'API' }
});
```

Run `pnpm --filter @efm/api exec prisma db seed` and query the source through Prisma or the database client.

- [ ] **Step 6: Run GREEN test and commit**

```bash
pnpm --filter @efm/api test -- prisma.service.spec.ts --runInBand
git add apps/api/prisma apps/api/src/database/prisma.service.spec.ts
git commit -m "feat(api): persist external catalog sync progress"
```

### Task 3: Implement the isolated PESDATA protocol client

**Files:**
- Create: `apps/api/src/pesdata-sync/pesdata.schemas.ts`
- Create: `apps/api/src/pesdata-sync/pesdata-signer.ts`
- Create: `apps/api/src/pesdata-sync/pesdata-signer.spec.ts`
- Create: `apps/api/src/pesdata-sync/pesdata-client.ts`
- Create: `apps/api/src/pesdata-sync/pesdata-client.spec.ts`
- Modify: `apps/api/src/config/env.schema.ts`
- Modify: `apps/api/src/config/configuration.ts`
- Modify: `.env.example`

**Interfaces:**
- Produces: `signPesdataRequest(params, timestamp, nonce, seed): string`.
- Produces: `PesdataClient.listPlayers({ start, limit, order }): Promise<{ list; count }>`.
- Produces: `PesdataClient.getPlayerDetail(playerId): Promise<PesdataPlayerDetail>`.
- Consumes injected `fetch`, `sleep`, clock, nonce factory, and configuration so all network timing behavior is deterministic in tests.

- [ ] **Step 1: Write failing signer tests**

Pin canonical sorting, URL encoding, omission of empty values, and a fixed signature fixture captured from the authorized website protocol:

```ts
expect(canonicalizePesdataParams({ start: 0, order: 'DESC', empty: '' }))
  .toBe('order=DESC&start=0');
expect(signPesdataRequest(
  { start: 0, limit: 2, order: 'DESC' },
  1_798_000_000,
  'fixednonce',
  'authorized-test-seed'
)).toMatch(/^[a-f0-9]{32}$/);
```

- [ ] **Step 2: Run signer RED test, implement, and rerun GREEN**

Run `pnpm --filter @efm/api test -- pesdata-signer.spec.ts --runInBand`; expect missing module. Implement stable key sorting, `encodeURIComponent` compatibility, and MD5 signing in `pesdata-signer.ts`, then rerun and expect PASS.

- [ ] **Step 3: Write failing client behavior tests**

Use injected fake responses to assert:

- list requests use `/api/player/list` and validate `{ code: 1, data: { list, count } }`;
- detail requests use `/api/player/detail` and require exactly one detail row;
- required version, device ID, timestamp, nonce, and signature headers are present;
- one 429 followed by success sleeps and retries;
- 500 retries up to the configured limit;
- 403/signature response and invalid payload throw `PESDATA_PROTOCOL_ERROR` immediately;
- thrown errors redact signature headers.

- [ ] **Step 4: Run client RED tests**

Run:

```bash
pnpm --filter @efm/api test -- pesdata-client.spec.ts --runInBand
```

Expected: missing client and schemas.

- [ ] **Step 5: Implement schemas, retry, timeout, and throttling**

Define Zod schemas with `.passthrough()` for list summaries and detail rows, while requiring the fields used by mapping. Use one serialized request gate and `1000 / requestsPerSecond` minimum spacing. Abort requests after `timeoutMs`. Map retry exhaustion and protocol failures to typed errors with code, endpoint category, HTTP status, and attempt count only.

- [ ] **Step 6: Add environment configuration**

Add validated values:

```ts
PESDATA_BASE_URL: z.url().default('https://pesdata.net'),
PESDATA_SITE_VERSION: z.string().min(1).default('1.9.0'),
PESDATA_SIGNATURE_SEED: z.string().min(1).optional(),
PESDATA_REQUESTS_PER_SECOND: z.coerce.number().positive().max(5).default(1),
PESDATA_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(15000),
PESDATA_MAX_RETRIES: z.coerce.number().int().min(0).max(8).default(5)
```

Document the variable names in `.env.example`; put the currently authorized website protocol seed only in the ignored local `.env`, never in committed files. Constructing or invoking `PesdataClient` without the seed must throw `PESDATA_CONFIG_MISSING`, while unrelated API commands and tests continue to start normally.

- [ ] **Step 7: Run GREEN tests, typecheck, and commit**

```bash
pnpm --filter @efm/api test -- pesdata-signer.spec.ts pesdata-client.spec.ts --runInBand
pnpm --filter @efm/api typecheck
git add apps/api/src/pesdata-sync apps/api/src/config .env.example
git commit -m "feat(api): add resilient pesdata protocol client"
```

### Task 4: Map complete PESDATA details into import records

**Files:**
- Create: `apps/api/src/pesdata-sync/pesdata-mapper.ts`
- Create: `apps/api/src/pesdata-sync/pesdata-mapper.spec.ts`
- Create: `apps/api/src/pesdata-sync/__fixtures__/bonucci-detail.json`

**Interfaces:**
- Consumes: `PesdataPlayerDetail` from Task 3.
- Produces: `mapPesdataPlayer(detail): RawImportRow` compatible with `normalizeImportRow`.
- Produces: stable source checksum helper over canonical JSON.

- [ ] **Step 1: Add a redacted real-response fixture and failing mapping tests**

The fixture must include multilingual names, `base_pes_id`, `playerId`, `agentTitle`, `agentDate`, position, overall, `cardType`, images, team/nationality, ability values, skills, position heat, boost metadata, and an unknown field. Tests assert:

```ts
expect(row).toMatchObject({
  externalId: '88045755859255',
  playerExternalId: '33079',
  playerNameZh: '莱昂纳多·博努奇',
  playerNameEn: 'Leonardo Bonucci',
  position: 'CB',
  overallRating: 87,
  cardType: 'EPIC',
  packExternalId: expect.any(String),
  imageUrl: 'https://img.pesdata.net/images/playerCard/88045755859255_l.webp'
});
expect(row.attributes).toEqual(expect.objectContaining({
  speed: 77,
  foot: '右脚',
  height: 190,
  positionHot: expect.any(Array)
}));
expect(row.skills).toHaveLength(10);
```

Also test card type mapping: `1→STANDARD`, `2→OTHER`, `3→EPIC`, `4→BIG_TIME`, `5→TRENDING`, `6→FEATURED`, `7→HIGHLIGHT`, `8→HIGHLIGHT`, unknown→`OTHER`.

- [ ] **Step 2: Run RED test**

Run `pnpm --filter @efm/api test -- pesdata-mapper.spec.ts --runInBand`; expect missing mapper.

- [ ] **Step 3: Implement mapping and canonical checksums**

Map abilities using stable camelCase keys understood by the mini-program (`speed`, `acceleration`, `finishing`, `dribbling`, `stamina`, `goalkeeping`) and preserve all other authorized detail metadata under semantically named JSON keys. Build pack identity from normalized `agentTitle|agentDate`; parse `agentDate` into `releaseDate` when it is a valid ISO date. Do not set `sourceUpdatedAt` from the current clock; retain the source `created_at` only when valid and rely on detail checksum for later changes.

- [ ] **Step 4: Verify the normalized import contract**

Add `expect(() => normalizeImportRow(row)).not.toThrow()` and verify invalid required data produces a mapping error rather than fabricated defaults.

- [ ] **Step 5: Run GREEN tests and commit**

```bash
pnpm --filter @efm/api test -- pesdata-mapper.spec.ts --runInBand
pnpm --filter @efm/api typecheck
git add apps/api/src/pesdata-sync
git commit -m "feat(api): map pesdata player details"
```

### Task 5: Orchestrate sample, full, incremental, and resumed synchronization

**Files:**
- Create: `apps/api/src/pesdata-sync/pesdata-sync.service.ts`
- Create: `apps/api/src/pesdata-sync/pesdata-sync.service.spec.ts`
- Create: `apps/api/src/pesdata-sync/pesdata-sync.types.ts`
- Modify: `apps/api/src/player-import/player-import.service.ts`

**Interfaces:**
- Consumes: `PesdataClient`, `mapPesdataPlayer`, `PrismaService`, and `PlayerImportService`.
- Produces: `start(actorId, { mode, limit?, dryRun? }): Promise<PesdataSyncResult>`.
- Produces: `resume(actorId, runId): Promise<PesdataSyncResult>`.
- Produces result containing run ID, counts, batch ID list, and no publish result.

- [ ] **Step 1: Write failing sample and pagination tests**

Test a fake source with three pages and assert `sample limit=3` fetches exactly three details, stores three items, and creates one READY import batch. Add a source whose reported `count` changes and whose final page is short; assert the loop terminates on the short/empty page and never repeats an offset.

- [ ] **Step 2: Run RED sample tests**

Run `pnpm --filter @efm/api test -- pesdata-sync.service.spec.ts --runInBand`; expect missing service.

- [ ] **Step 3: Implement run acquisition and sample flow**

Create a run with `activeLeaseKey='pesdata'`; translate the unique constraint into `PESDATA_SYNC_CONFLICT`. Persist each list offset and item after successful fetch. Complete the run only after all selected items have terminal states. In dry-run mode use in-memory items and do not write runs or batches.

- [ ] **Step 4: Write failing chunk and idempotency tests**

Generate 5,001 mapped items for run ID `11111111-1111-4111-8111-111111111111` and assert two stable JSON chunks of 5,000 and 1 are passed to `createBatchWithOutcome`, each with `sourceCode: 'pesdata'`, `format: 'JSON'`, stable file names `pesdata-11111111-1111-4111-8111-111111111111-001.json` and `pesdata-11111111-1111-4111-8111-111111111111-002.json`, and no publisher call. Re-running batch creation must return the same existing batch IDs through content checksum idempotency.

- [ ] **Step 5: Implement deterministic import chunk creation**

Sort by numeric-safe external ID string comparison, serialize with `JSON.stringify`, chunk at 5,000, and associate created or reused batches through `ExternalSyncRunBatch` with a one-based chunk index. Set the run to READY and clear `activeLeaseKey` only after every chunk is attached.

- [ ] **Step 6: Write failing incremental and resume tests**

Cover these cases:

- unchanged summary with prior successful detail is SKIPPED;
- new or changed summary is FETCHED;
- prior failed item retries;
- resume begins from persisted offset and does not request FETCHED items again;
- protocol error marks run FAILED and clears the active lease;
- item mapping error increments failure count without discarding successful items;
- no source disappearance produces an inactive import record.

- [ ] **Step 7: Implement incremental/resume behavior and run GREEN**

Use the latest prior completed item checksum for comparison. `resume` must load the original mode/limit, continue PENDING/FAILED items, and reuse stored FETCHED detail JSON. Run:

```bash
pnpm --filter @efm/api test -- pesdata-sync.service.spec.ts --runInBand
pnpm --filter @efm/api test -- player-import.service.spec.ts --runInBand
pnpm --filter @efm/api typecheck
```

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/pesdata-sync apps/api/src/player-import/player-import.service.ts
git commit -m "feat(api): orchestrate resumable pesdata synchronization"
```

### Task 6: Expose the synchronization command through NestJS

**Files:**
- Create: `apps/api/src/pesdata-sync/pesdata-sync.module.ts`
- Create: `apps/api/src/pesdata-sync/pesdata-sync.cli.ts`
- Create: `apps/api/src/pesdata-sync/pesdata-sync.cli.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json`

**Interfaces:**
- Produces CLI modes exactly as specified in the design.
- Produces scripts `sync:pesdata` in the API and repository root packages.

- [ ] **Step 1: Write failing CLI parsing tests**

Assert exact parse results for:

```ts
parsePesdataSyncArgs(['sample', '--actor', actorId, '--limit', '100']);
parsePesdataSyncArgs(['full', '--actor', actorId]);
parsePesdataSyncArgs(['incremental', '--actor', actorId]);
parsePesdataSyncArgs(['resume', runId, '--actor', actorId]);
parsePesdataSyncArgs(['sample', '--actor', actorId, '--limit', '2', '--dry-run']);
```

Assert missing actor, invalid UUID, limit outside `1..5000`, unknown mode, and `--dry-run` with resume produce stable error codes.

- [ ] **Step 2: Run RED CLI test**

Run `pnpm --filter @efm/api test -- pesdata-sync.cli.spec.ts --runInBand`; expect missing parser.

- [ ] **Step 3: Implement the CLI and module wiring**

Use `NestFactory.createApplicationContext(AppModule, { logger: false })`, resolve `PesdataSyncService`, print one JSON result to stdout, print `{ error, code }` to stderr on failure, and set a nonzero exit code. Import `PesdataSyncModule` in `AppModule`; import `PlayerImportModule` and `DatabaseModule` as needed inside the sync module.

- [ ] **Step 4: Add scripts**

API package:

```json
"sync:pesdata": "tsx src/pesdata-sync/pesdata-sync.cli.ts"
```

Root package:

```json
"sync:pesdata": "pnpm --filter @efm/api sync:pesdata --"
```

- [ ] **Step 5: Run GREEN tests, build, and commit**

```bash
pnpm --filter @efm/api test -- pesdata-sync.cli.spec.ts --runInBand
pnpm --filter @efm/api typecheck
pnpm --filter @efm/api build
git add apps/api/src/pesdata-sync apps/api/src/app.module.ts apps/api/package.json package.json
git commit -m "feat(api): add pesdata synchronization commands"
```

### Task 7: Document and perform authorized live acceptance

**Files:**
- Create: `docs/development/pesdata-sync.md`
- Modify: `docs/development/local-development.md`
- Modify: `.env.example`

**Interfaces:**
- Produces reproducible operator instructions for dry-run, sample, resume, batch review, publication, and incremental execution.
- Verifies the current authorized website protocol without making live-network tests part of the normal Jest suite.

- [ ] **Step 1: Write the operator guide**

Document:

- required environment values and how the current protocol seed is kept in ignored deployment secrets;
- creating or selecting an actor with `catalog.import.create/read/publish` permissions;
- `sample --limit 2 --dry-run` connectivity check;
- `sample --limit 100` acceptance run;
- querying run/items and invalid import records;
- publishing each batch only after review;
- `resume`, `full`, and `incremental` commands;
- expected 12–15 hour full-run duration at one request per second;
- stopping on protocol errors and never bypassing access controls;
- images remain remote URLs.

- [ ] **Step 2: Run a two-record live dry run**

Run:

```bash
export EFM_LOCAL_ACTOR_ID="$(docker compose exec -T mysql mysql --user=efm --password=efm_local --database=efootball_management --batch --skip-column-names -e "SELECT u.id FROM users u JOIN user_role_bindings b ON b.user_id=u.id JOIN roles r ON r.id=b.role_id WHERE r.code='PLATFORM_ADMIN' LIMIT 1")"
pnpm sync:pesdata sample --actor "$EFM_LOCAL_ACTOR_ID" --limit 2 --dry-run
```

Expected JSON: `fetchedCount: 2`, `failedCount: 0`, `batchIds: []`, and no new sync-run row.

- [ ] **Step 3: Run the 100-record acceptance sample**

Run:

```bash
pnpm sync:pesdata sample --actor "$EFM_LOCAL_ACTOR_ID" --limit 100
```

Expected JSON: READY run, 100 terminal items, zero protocol failures, and one READY import batch. Inspect at least five records spanning different positions/card types and verify names, rating, card image URL, skills, abilities, pack, team, and nationality.

- [ ] **Step 4: Verify no automatic publication**

Query `catalog_releases` and confirm the sample batch has no release until the explicit existing publish command runs. Do not publish during this assertion. Record the run ID and batch ID in local command output, not in committed documentation.

- [ ] **Step 5: Run full regression**

```bash
pnpm db:status
pnpm verify
git diff --check
```

Expected: all migrations applied; lint, typecheck, unit tests, e2e tests, and builds pass; no whitespace errors.

- [ ] **Step 6: Commit documentation**

```bash
git add docs/development .env.example
git commit -m "docs: explain authorized pesdata synchronization"
```

## Self-Review Results

- Spec coverage: client isolation, signing, mapping, rate limiting, retry, checkpointing, resume, incremental mode, deterministic chunking, manual publication, configuration, documentation, and live sample validation are each assigned to a task.
- Capacity correction: the plan explicitly splits a 43k-card run into deterministic chunks of at most 5,000 records and relates all chunks to one run.
- Placeholder scan: command examples use operator-supplied local actor/run identifiers only; implementation behavior, types, files, assertions, and error codes are specified.
- Type consistency: `RawImportRow` remains the mapper boundary, `PlayerImportService.createBatchWithOutcome` remains the sole batch creation path, and sync results consistently expose `batchIds`.
- Review focus: all five listed failure classes have explicit owning tests.
