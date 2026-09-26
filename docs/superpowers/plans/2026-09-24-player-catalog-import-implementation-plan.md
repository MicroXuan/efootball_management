# Player Catalog and Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a versioned player-card catalog with CSV/JSON batch import, reviewed transactional publishing, public catalog APIs, and native WeChat mini-program list and detail pages.

**Architecture:** `player-import` converts every source into one normalized record, persists validation and diff results, and publishes ready batches through a single transaction into `player-catalog`. Public APIs read only published rows and return a release-bound cursor so paging stays stable while a later catalog release is published. The mini-program consumes those APIs as a public surface and keeps identity pages behind login.

**Tech Stack:** Node.js 24, TypeScript 5.9, NestJS 12, Prisma 7, MariaDB/MySQL, Zod 4, Jest/Supertest, native WeChat Mini Program, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-24-player-catalog-import-design.md`

## Global Constraints

- Keep the existing pnpm monorepo and Node.js `>=24 <25` requirement.
- Use UUID primary keys, snake_case database names, and camelCase API contracts.
- Public catalog reads must not require WeChat authentication.
- Management endpoints require platform-scoped catalog permissions.
- A batch containing any invalid record cannot be published.
- Publishing is transactional and idempotent; published data never exposes a partial batch.
- Import adapters never write directly to formal catalog tables.
- Do not fetch, copy, or cache third-party card artwork; accept only explicitly supplied HTTPS image URLs and render an owned fallback card.
- Do not add scraping, scheduled third-party sync, salary, favorites, squads, competitions, teams, or a Web administration UI.

## Review Focus

- A UTF-8 BOM, CRLF line endings, and quoted commas in CSV must parse without corrupting Chinese or accented names; Task 3 pins this behavior.
- Unicode normalization must make full-width/compatibility variants searchable without changing the displayed spelling; Tasks 3 and 7 pin this behavior.
- Two concurrent publish requests for one ready batch must create one release and return the same result; Task 5 pins this behavior.
- Omitting an existing card from a later import must not unpublish it; only an explicit inactive status may do so; Task 5 pins this behavior.
- Paging through release N while release N+1 is published must not duplicate or skip records; Task 6 pins this behavior.

---

### Task 1: Shared catalog and import contracts

**Files:**
- Create: `packages/contracts/src/player-catalog.ts`
- Create: `packages/contracts/src/player-import.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`
- Test: `packages/contracts/src/contracts.spec.ts`

**Interfaces:**
- Consumes: `ResourceIdSchema` from `packages/contracts/src/common.ts`.
- Produces: `PlayerPositionSchema`, `PlayerCardTypeSchema`, `PlayerCardStatusSchema`, `PlayerSearchQuerySchema`, `PlayerSearchResponseSchema`, `PlayerDetailSchema`, `PlayerCardDetailSchema`, `CardPackListResponseSchema`, `ImportFormatSchema`, `ImportBatchStatusSchema`, `ImportDiffTypeSchema`, `NormalizedPlayerCardRecordSchema`, `CreateImportBatchRequestSchema`, `ImportBatchSchema`, and `ImportRecordSchema`.

- [ ] **Step 1: Write failing contract tests**

Extend `contracts.spec.ts` with tests that prove:

```ts
it('applies catalog query defaults and bounds', () => {
  const query = PlayerSearchQuerySchema.parse({ keyword: '  亚马尔  ', minOverall: '90' });
  assert.deepEqual(query, { keyword: '亚马尔', minOverall: 90, limit: 20 });
  assert.throws(() => PlayerSearchQuerySchema.parse({ limit: 101 }));
});

it('rejects an import record without either player name', () => {
  assert.throws(() => NormalizedPlayerCardRecordSchema.parse({
    externalId: 'card-1',
    cardName: 'Featured',
    position: 'CF',
    overallRating: 95,
    cardType: 'FEATURED'
  }));
});

it('rejects non-https artwork and out-of-range ratings', () => {
  const base = {
    externalId: 'card-1', playerNameEn: 'Player', cardName: 'Featured',
    position: 'CF', cardType: 'FEATURED'
  };
  assert.throws(() => NormalizedPlayerCardRecordSchema.parse({ ...base, overallRating: 111 }));
  assert.throws(() => NormalizedPlayerCardRecordSchema.parse({
    ...base, overallRating: 95, imageUrl: 'http://example.com/card.png'
  }));
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run: `pnpm --filter @efm/contracts test`

Expected: FAIL because the player catalog and import schemas are not exported.

- [ ] **Step 3: Implement the catalog contracts**

Define stable enums and response shapes in `player-catalog.ts`:

```ts
export const PlayerPositionSchema = z.enum([
  'GK', 'CB', 'LB', 'RB', 'DMF', 'CMF', 'LMF', 'RMF',
  'AMF', 'LWF', 'RWF', 'SS', 'CF'
]);
export const PlayerCardTypeSchema = z.enum([
  'STANDARD', 'FEATURED', 'TRENDING', 'HIGHLIGHT', 'EPIC', 'BIG_TIME', 'OTHER'
]);
export const PlayerCardStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);

export const PlayerSearchQuerySchema = z.object({
  keyword: z.string().trim().min(1).max(80).optional(),
  position: PlayerPositionSchema.optional(),
  minOverall: z.coerce.number().int().min(1).max(110).optional(),
  maxOverall: z.coerce.number().int().min(1).max(110).optional(),
  cardType: PlayerCardTypeSchema.optional(),
  cardPackId: ResourceIdSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20)
}).refine((value) => !value.minOverall || !value.maxOverall || value.minOverall <= value.maxOverall, {
  message: 'minOverall must not exceed maxOverall', path: ['minOverall']
});
```

Define `PlayerCardSummarySchema` with `id`, `playerId`, `playerNameZh`, `playerNameEn`, `cardName`, `position`, `overallRating`, `cardType`, nullable `playStyle`, nullable `imageUrl`, nullable `pack`, and `publishedAt`. Define paged responses as `{ items, nextCursor: string | null, releaseSequence: number }`. Define detail schemas by extending the summary with `nationality`, `club`, `status`, `skills: { code, nameZh, nameEn }[]`, `attributes: Record<string, number>`, and `otherCards`.

- [ ] **Step 4: Implement the import contracts**

Define in `player-import.ts`:

```ts
export const ImportFormatSchema = z.enum(['CSV', 'JSON']);
export const ImportBatchStatusSchema = z.enum([
  'UPLOADED', 'VALIDATED', 'READY', 'PUBLISHED', 'FAILED', 'CANCELLED'
]);
export const ImportDiffTypeSchema = z.enum(['CREATE', 'UPDATE', 'UNCHANGED', 'INVALID']);
export const NormalizedPlayerCardRecordSchema = z.object({
  externalId: z.string().trim().min(1).max(128),
  playerExternalId: z.string().trim().min(1).max(128).optional(),
  playerNameZh: z.string().trim().min(1).max(128).optional(),
  playerNameEn: z.string().trim().min(1).max(128).optional(),
  playerShortName: z.string().trim().min(1).max(64).optional(),
  nationality: z.string().trim().max(64).optional(),
  club: z.string().trim().max(128).optional(),
  cardName: z.string().trim().min(1).max(128),
  position: PlayerPositionSchema,
  overallRating: z.number().int().min(1).max(110),
  cardType: PlayerCardTypeSchema,
  playStyle: z.string().trim().max(128).optional(),
  status: PlayerCardStatusSchema.default('ACTIVE'),
  imageUrl: z.url().refine((value) => value.startsWith('https://')).optional(),
  packExternalId: z.string().trim().min(1).max(128).optional(),
  packName: z.string().trim().min(1).max(128).optional(),
  season: z.string().trim().max(32).optional(),
  releaseDate: z.iso.date().optional(),
  sourceUpdatedAt: z.iso.datetime().optional(),
  skills: z.array(z.string().trim().min(1).max(128)).default([]),
  attributes: z.record(z.string(), z.number().finite()).default({})
}).refine((value) => Boolean(value.playerNameZh || value.playerNameEn), {
  message: 'At least one player name is required', path: ['playerNameZh']
});
export const CreateImportBatchRequestSchema = z.object({
  sourceCode: z.string().trim().min(1).max(64),
  fileName: z.string().trim().min(1).max(255),
  format: ImportFormatSchema,
  content: z.string().min(1)
});
```

Define batch and record response schemas with the identifiers, statuses, counts, validation errors, field diff, timestamps, and nullable release data described in the spec.

- [ ] **Step 5: Export contracts and verify GREEN**

Export both modules from `packages/contracts/src/index.ts` and run:

`pnpm --filter @efm/contracts test && pnpm --filter @efm/contracts typecheck`

Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src
git commit -m "feat(contracts): define player catalog and import APIs"
```

---

### Task 2: Catalog and import persistence schema

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260924140000_player_catalog_import/migration.sql`
- Modify: `apps/api/prisma/seed.ts`
- Test: `apps/api/src/database/prisma.service.spec.ts`

**Interfaces:**
- Consumes: enum values from Task 1 as database enum names.
- Produces: Prisma models `DataSource`, `FootballPlayer`, `FootballPlayerSource`, `CardPack`, `PlayerCard`, `PlayerCardVersion`, `PlayerCardAttribute`, `Skill`, `PlayerCardSkill`, `CatalogRelease`, `ImportBatch`, and `ImportRecord`.

- [ ] **Step 1: Write a failing Prisma smoke test**

Add a test that connects and asks the generated client for the new delegates:

```ts
it('exposes player catalog and import delegates', () => {
  expect(prisma.dataSource).toBeDefined();
  expect(prisma.playerCard).toBeDefined();
  expect(prisma.importBatch).toBeDefined();
  expect(prisma.catalogRelease).toBeDefined();
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm --filter @efm/api test -- prisma.service.spec.ts`

Expected: FAIL because the generated client has no catalog delegates.

- [ ] **Step 3: Add Prisma enums and models**

Add Prisma enums matching the contracts plus `ImportSourceType { MANUAL API }`. Implement the relations and constraints below:

```prisma
model DataSource {
  id        String           @id @default(uuid()) @db.Char(36)
  code      String           @unique @db.VarChar(64)
  name      String           @db.VarChar(128)
  type      ImportSourceType @default(MANUAL)
  isEnabled Boolean          @default(true) @map("is_enabled")
  createdAt DateTime         @default(now()) @map("created_at")
  updatedAt DateTime         @updatedAt @map("updated_at")
  batches   ImportBatch[]
  cards     PlayerCard[]
  packs     CardPack[]
  players   FootballPlayerSource[]
  @@map("data_sources")
}

model CatalogRelease {
  id          String      @id @default(uuid()) @db.Char(36)
  sequence    Int         @unique @default(autoincrement())
  batchId     String      @unique @map("batch_id") @db.Char(36)
  publishedBy String      @map("published_by") @db.Char(36)
  createdCount Int        @map("created_count")
  updatedCount Int        @map("updated_count")
  unchangedCount Int      @map("unchanged_count")
  publishedAt DateTime    @default(now()) @map("published_at")
  batch       ImportBatch @relation(fields: [batchId], references: [id], onDelete: Restrict)
  @@map("catalog_releases")
}
```

Use `Json` for `attributesJson`, `rawJson`, `normalizedJson`, `fieldDiff`, and `validationErrors`. Put unique constraints on `(sourceId, externalId)` for player source identities, packs, and cards; `(batchId, rowNumber)` for import records; `(playerCardId, skillId)` for card skills; `(sourceId, checksum)` for batches. Add indexes for published status, normalized names, card position/type/rating, pack, batch status, and record diff type.

Add `lastPublishedReleaseSequence Int?` to players, packs, and cards. Store `publishedAt DateTime?`; public queries require non-null `publishedAt` and `lastPublishedReleaseSequence <= cursor.releaseSequence`.

Add `PlayerCardVersion` as changed-row history rather than a full catalog snapshot. It stores `playerCardId`, `releaseSequence`, all searchable and display card fields, player display fields, pack display fields, skills JSON, and attributes JSON. Use `@@unique([playerCardId, releaseSequence])` plus indexes for release, position, type, rating, normalized names, and status. A release creates versions only for `CREATE` and `UPDATE` cards.

- [ ] **Step 4: Seed the source and permissions**

Upsert the `manual` data source and these permission records:

```ts
const catalogPermissions = [
  ['catalog.import.create', 'Create player import batches'],
  ['catalog.import.read', 'Read player import batches'],
  ['catalog.import.publish', 'Publish player import batches']
] as const;
```

Attach them to the existing platform administrator role in the same transaction as the current seed data.

- [ ] **Step 5: Generate and apply the migration**

Run:

```bash
pnpm db:generate
pnpm db:migrate:dev --name player_catalog_import
pnpm --filter @efm/api exec prisma db seed
```

Expected: migration succeeds against the local Docker database and seeding is idempotent.

- [ ] **Step 6: Verify GREEN**

Run: `pnpm --filter @efm/api test -- prisma.service.spec.ts && pnpm --filter @efm/api typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma apps/api/src/generated apps/api/src/database/prisma.service.spec.ts
git commit -m "feat(api): add player catalog persistence"
```

---

### Task 3: CSV/JSON adapters and record normalization

**Files:**
- Create: `apps/api/src/player-import/import-adapter.ts`
- Create: `apps/api/src/player-import/json-import.adapter.ts`
- Create: `apps/api/src/player-import/csv-import.adapter.ts`
- Create: `apps/api/src/player-import/record-normalizer.ts`
- Create: `apps/api/src/player-import/import-adapters.spec.ts`
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Test: `apps/api/src/player-import/import-adapters.spec.ts`

**Interfaces:**
- Consumes: `NormalizedPlayerCardRecordSchema` from Task 1.
- Produces: `RawImportRow`, `ParsedImportRow`, `ImportAdapter`, `JsonImportAdapter.parse(content)`, `CsvImportAdapter.parse(content)`, `normalizeImportRow(raw)`.

- [ ] **Step 1: Write failing adapter tests**

Cover JSON arrays, rejected JSON objects, and this exact CSV edge case:

```ts
const csv = '\uFEFFexternalId,playerNameZh,playerNameEn,cardName,position,overallRating,cardType,skills\r\n' +
  'c1,亚马尔,"Lamine, Yamal",精选,RWF,97,FEATURED,"Double Touch,Gamesmanship"\r\n';
const [row] = new CsvImportAdapter().parse(csv);
expect(row.rowNumber).toBe(2);
expect(row.value.playerNameEn).toBe('Lamine, Yamal');
expect(normalizeImportRow(row.value).skills).toEqual(['Double Touch', 'Gamesmanship']);
```

Add a normalization assertion that display name `Ａｌｅｘｉｓ` remains available as entered while `normalizeSearchText('Ａｌｅｘｉｓ')` equals `alexis`.

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm --filter @efm/api test -- import-adapters.spec.ts`

Expected: FAIL because adapters do not exist.

- [ ] **Step 3: Add the CSV dependency and adapter boundary**

Install `csv-parse` in `@efm/api`. Define:

```ts
export type RawImportRow = Record<string, unknown>;
export type ParsedImportRow = { rowNumber: number; value: RawImportRow };
export interface ImportAdapter { parse(content: string): ParsedImportRow[]; }
```

`CsvImportAdapter` must set `bom: true`, `columns: true`, `skip_empty_lines: true`, `trim: true`, and preserve parser line numbers. `JsonImportAdapter` accepts only a top-level array and reports array index plus one as its row number.

- [ ] **Step 4: Implement normalization**

Implement `normalizeSearchText(value)` with `value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US')`. Implement `normalizeImportRow` to coerce numeric rating, parse comma-separated skills, parse `attributesJson`, convert empty strings to `undefined`, and call `NormalizedPlayerCardRecordSchema.parse`.

Do not mutate display strings beyond trimming and collapsing whitespace. Deduplicate skills by normalized key while keeping the first display spelling.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm --filter @efm/api test -- import-adapters.spec.ts && pnpm --filter @efm/api typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/player-import
git commit -m "feat(api): parse and normalize player imports"
```

---

### Task 4: Import validation, matching, and batch creation

**Files:**
- Create: `apps/api/src/player-import/import-diff.ts`
- Create: `apps/api/src/player-import/player-import.service.ts`
- Create: `apps/api/src/player-import/player-import.service.spec.ts`
- Create: `apps/api/src/player-import/player-import.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/player-import/player-import.service.spec.ts`

**Interfaces:**
- Consumes: adapters from Task 3, Prisma models from Task 2, and `AuthorizationService.can(actorId, permission)`.
- Produces: `PlayerImportService.createBatch(actorId, input)`, `getBatch(actorId, batchId)`, `listRecords(actorId, batchId, filter)`, `cancelBatch(actorId, batchId)`, and pure `calculateRecordDiff(existing, incoming)`.

- [ ] **Step 1: Write failing diff tests**

Test `CREATE` for no existing card, `UNCHANGED` for normalized equivalence, `UPDATE` with an exact field-level map, and `INVALID` for duplicate external IDs. Include a test where two name matches exist without `playerExternalId`; the record must be invalid with code `AMBIGUOUS_PLAYER_MATCH`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @efm/api test -- player-import.service.spec.ts`

Expected: FAIL because the service and diff function do not exist.

- [ ] **Step 3: Implement pure diff calculation**

Define:

```ts
export type FieldDiff = Record<string, { before: unknown; after: unknown }>;
export type CalculatedDiff = {
  type: 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'INVALID';
  fields: FieldDiff;
  errors: Array<{ code: string; path: string; message: string }>;
};
```

Compare only source-owned fields: names, short name, nationality, club, card name, position, rating, type, play style, explicit status, image URL, pack, skills, attributes, and source update time. Sort skill codes and object keys before hashing or comparing.

- [ ] **Step 4: Implement batch creation**

`createBatch` must:

1. Require `catalog.import.create` for the actor before reading the source or content.
2. Reject disabled or missing source code.
3. SHA-256 the exact UTF-8 content and return an existing `(sourceId, checksum)` batch.
4. Reject more than 5,000 parsed rows.
5. Persist the batch as `UPLOADED`.
6. Normalize every row independently and persist validation failures rather than aborting the file.
7. Mark every occurrence of duplicate external IDs invalid.
8. Match cards by source and external ID, players by source identity first and normalized names second, and packs by source identity.
9. Persist raw, normalized, validation, and field-diff JSON.
10. Finish as `READY` when invalid count is zero, otherwise `VALIDATED`.

`getBatch` and `listRecords` require `catalog.import.read`; `cancelBatch` requires `catalog.import.publish`. This keeps the CLI and HTTP controller on the same authorization path.

File parsing failure updates the batch to `FAILED` with a stable reason and then returns a 400 domain error. `cancelBatch` accepts only `UPLOADED`, `VALIDATED`, or `READY`.

- [ ] **Step 5: Add test coverage for file and matching failures**

Add cases for empty content, 5,001 rows, duplicate checksum, duplicate external IDs, malformed `attributesJson`, ambiguous name match, and inactive data source. Each case must assert the final batch state and stable error code.

- [ ] **Step 6: Verify GREEN**

Run: `pnpm --filter @efm/api test -- player-import.service.spec.ts && pnpm --filter @efm/api typecheck`

Expected: PASS.

- [ ] **Step 7: Register the module and commit**

Import `PlayerImportModule` in `AppModule`, then:

```bash
git add apps/api/src/player-import apps/api/src/app.module.ts
git commit -m "feat(api): create reviewed player import batches"
```

---

### Task 5: Transactional publication and local import command

**Files:**
- Create: `apps/api/src/player-import/player-import.publisher.ts`
- Create: `apps/api/src/player-import/player-import.publisher.spec.ts`
- Create: `apps/api/src/player-import/player-import.cli.ts`
- Modify: `apps/api/src/player-import/player-import.service.ts`
- Modify: `apps/api/src/player-import/player-import.module.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json`
- Test: `apps/api/src/player-import/player-import.publisher.spec.ts`

**Interfaces:**
- Consumes: ready batches from Task 4, formal catalog models from Task 2, and `AuthorizationService.can(actorId, 'catalog.import.publish')`.
- Produces: `PlayerImportPublisher.publish(actorId, batchId): Promise<ImportBatchResponse>` and CLI commands `player-import validate` and `player-import publish`.

- [ ] **Step 1: Write failing publisher tests**

Use the real test database to prove:

- a ready `CREATE` batch creates player, source identity, pack, card, skills, attributes, and one release;
- an `UPDATE` batch changes only listed source-owned fields;
- an invalid or cancelled batch returns `IMPORT_BATCH_NOT_READY`;
- missing records in a later batch remain published;
- explicit `status: INACTIVE` hides that card from subsequent public reads;
- an injected write failure leaves no release and no partial catalog rows;
- two concurrent calls for the same batch return the same release ID and create one release row.

- [ ] **Step 2: Run the publisher test and verify RED**

Run: `pnpm --filter @efm/api test -- player-import.publisher.spec.ts`

Expected: FAIL because the publisher does not exist.

- [ ] **Step 3: Implement row-locked idempotent publishing**

Inside one Prisma transaction:

1. Require `catalog.import.publish` before opening the transaction.
2. Lock the batch row with `SELECT id FROM import_batches WHERE id = ? FOR UPDATE`.
3. Return the attached release if status is already `PUBLISHED`.
4. Reject every status except `READY` and re-count invalid records.
5. Create the release to obtain its auto-increment sequence.
6. Upsert player source identity, pack, card, skills, links, and attributes for each `CREATE` or `UPDATE` record.
7. Insert one immutable `PlayerCardVersion` for each created or updated card, using the complete post-publish display and search state.
8. Set `publishedAt` and `lastPublishedReleaseSequence` on touched formal rows.
9. Preserve omitted cards.
10. Mark the batch `PUBLISHED` and attach the release.

Catch the release unique-key race by re-reading the published batch and returning its release. Never swallow other database errors.

- [ ] **Step 4: Verify publisher GREEN**

Run: `pnpm --filter @efm/api test -- player-import.publisher.spec.ts`

Expected: PASS, including concurrency and rollback cases.

- [ ] **Step 5: Implement the CLI shell**

Add root scripts:

```json
{
  "player-import:validate": "pnpm --filter @efm/api player-import -- validate",
  "player-import:publish": "pnpm --filter @efm/api player-import -- publish"
}
```

The CLI parses:

```text
validate fixtures/player-import/sample-player-cards.json --source manual --actor 11111111-1111-4111-8111-111111111111
publish 22222222-2222-4222-8222-222222222222 --actor 11111111-1111-4111-8111-111111111111
```

It bootstraps a Nest application context, resolves `PlayerImportService` or `PlayerImportPublisher`, prints batch ID and counts as JSON, closes the context in `finally`, and sets `process.exitCode = 1` for validation, permission, or publication failure. File format is inferred only from `.csv` or `.json`; all other extensions fail with `UNSUPPORTED_IMPORT_FORMAT`.

- [ ] **Step 6: Add a CLI parsing unit test and verify**

Extract `parsePlayerImportArgs(argv)` and test missing path, unsupported extension, required actor, and both valid commands.

Run: `pnpm --filter @efm/api test -- player-import && pnpm --filter @efm/api typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json apps/api/package.json apps/api/src/player-import
git commit -m "feat(api): publish player imports transactionally"
```

---

### Task 6: Public catalog query service and release-stable pagination

**Files:**
- Create: `apps/api/src/player-catalog/catalog-cursor.ts`
- Create: `apps/api/src/player-catalog/player-catalog.service.ts`
- Create: `apps/api/src/player-catalog/player-catalog.controller.ts`
- Create: `apps/api/src/player-catalog/player-catalog.module.ts`
- Create: `apps/api/src/player-catalog/player-catalog.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/player-catalog/player-catalog.service.spec.ts`

**Interfaces:**
- Consumes: formal catalog data and release sequence from Tasks 2 and 5.
- Produces: `PlayerCatalogService.search(query)`, `getPlayer(id)`, `getCard(id)`, `listPacks(query)`, `getPack(id)`, and GET routes from the spec.

- [ ] **Step 1: Write failing cursor and query tests**

Test signed/validated cursor decoding, filters, deterministic ordering, inactive exclusion, unpublished exclusion, Unicode keyword normalization, and 404 responses. Add a release stability test:

1. Publish release 1 with 25 cards.
2. Read page 1 with limit 10 and retain its cursor.
3. Publish release 2 with a new high-rated card and an update to a page-2 card.
4. Continue using the release-1 cursor.
5. Assert exactly the original 25 IDs appear once across the three pages.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @efm/api test -- player-catalog.service.spec.ts`

Expected: FAIL because the catalog service does not exist.

- [ ] **Step 3: Implement opaque catalog cursors**

Encode base64url JSON with this exact shape:

```ts
type CatalogCursor = {
  releaseSequence: number;
  publishedAt: string;
  overallRating: number;
  id: string;
};
```

Reject malformed values with `INVALID_CURSOR`. The first request captures the latest release sequence; every later page filters `lastPublishedReleaseSequence <= releaseSequence` and uses the compound ordering `publishedAt desc, overallRating desc, id asc`.

Resolve each card from its latest `PlayerCardVersion` whose `releaseSequence` is at or below the cursor release. This preserves both membership and sort values while paging through an older release. Keep version resolution inside the catalog service so controllers and the mini-program do not know about history storage.

- [ ] **Step 4: Implement public query methods and controllers**

Use `ZodValidationPipe` for query and ID validation. Do not attach `JwtAuthGuard` to the public controller. Return only active, released records. `getPlayer` includes all visible cards; `getCard` includes skills, attributes, pack, and visible sibling cards; pack endpoints include only visible cards.

- [ ] **Step 5: Verify GREEN**

Run: `pnpm --filter @efm/api test -- player-catalog.service.spec.ts && pnpm --filter @efm/api typecheck`

Expected: PASS.

- [ ] **Step 6: Register and commit**

Import `PlayerCatalogModule` in `AppModule`, then:

```bash
git add apps/api/src/player-catalog apps/api/src/app.module.ts
git commit -m "feat(api): expose the published player catalog"
```

---

### Task 7: Management API and end-to-end catalog verification

**Files:**
- Create: `apps/api/src/player-import/player-import.controller.ts`
- Modify: `apps/api/src/player-import/player-import.module.ts`
- Modify: `apps/api/src/bootstrap.ts`
- Create: `apps/api/test/player-catalog.e2e-spec.ts`
- Modify: `apps/api/test/test-app.ts`
- Test: `apps/api/test/player-catalog.e2e-spec.ts`

**Interfaces:**
- Consumes: import services from Tasks 4–5, catalog controller from Task 6, `JwtAuthGuard`, `ScopeGuard`, and `RequirePermission`.
- Produces: `/v1/admin/player-imports` management routes and full HTTP verification of public catalog routes.

- [ ] **Step 1: Write failing E2E authorization and lifecycle tests**

Cover:

- unauthenticated `GET /v1/players` returns 200;
- unauthenticated management request returns `AUTH_REQUIRED`;
- ordinary authenticated user receives `FORBIDDEN`;
- platform content editor creates a JSON batch, reads records, publishes it, and public search returns the card;
- a second submission of identical content returns the original batch ID;
- Unicode compatibility keyword finds the displayed accented/full-width name without altering response spelling;
- invalid batch publication returns 409 and never becomes public;
- a valid JSON request larger than Express's default 100 KB but below 10 MB is accepted;
- unpublished player/card/pack IDs return 404.

- [ ] **Step 2: Run the E2E test and verify RED**

Run: `pnpm --filter @efm/api test:e2e -- player-catalog.e2e-spec.ts`

Expected: FAIL because management routes are absent.

- [ ] **Step 3: Implement the management controller**

Use class-level `@Controller('admin/player-imports')` and `@UseGuards(JwtAuthGuard, ScopeGuard)`. Apply exact permissions:

- POST collection: `catalog.import.create`;
- GET batch and records: `catalog.import.read`;
- POST publish and cancel: `catalog.import.publish`.

Use `CurrentUser()` for the actor ID. Return 201 for a newly created batch, 200 for an identical existing batch, 200 for publish/cancel, 404 for unknown IDs, and 409 for invalid state.

Configure Nest's JSON body parser with a 10 MB limit in `configureApplication`. Requests above that limit must return 413; the 5,000-record business limit remains independent of byte size.

- [ ] **Step 4: Make test cleanup explicit**

In `afterAll`, delete test-created catalog links, attributes, cards, packs, source identities, players, release rows, import records, batches, role bindings, users, and test-only sources in foreign-key-safe order. Never delete the seeded `manual` source.

- [ ] **Step 5: Verify GREEN and run backend regression**

Run:

```bash
pnpm --filter @efm/api test:e2e -- player-catalog.e2e-spec.ts
pnpm --filter @efm/api test
pnpm --filter @efm/api test:e2e
```

Expected: PASS with no identity test regression.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/player-import apps/api/test
git commit -m "feat(api): secure player import management endpoints"
```

---

### Task 8: Mini-program catalog client and view models

**Files:**
- Create: `apps/miniprogram/miniprogram/services/catalog.ts`
- Create: `apps/miniprogram/miniprogram/pages/players/players.viewmodel.ts`
- Create: `apps/miniprogram/miniprogram/pages/players/players.viewmodel.spec.ts`
- Create: `apps/miniprogram/miniprogram/pages/player-card-detail/detail.viewmodel.ts`
- Create: `apps/miniprogram/miniprogram/pages/player-card-detail/detail.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/services/api.ts`
- Test: the two new `*.spec.ts` files.

**Interfaces:**
- Consumes: Task 1 response types and the existing mini-program API service.
- Produces: `catalogApi.searchPlayers`, `getPlayerCard`, `listCardPacks`, `buildPlayerQuery`, `mergeUniqueCards`, `groupCardsByPack`, `toCardViewModel`, and `toCardDetailViewModel`.

- [ ] **Step 1: Write failing player-list view-model tests**

Test that:

- empty filters are omitted from the URL;
- Chinese keyword is encoded once;
- changing a filter produces a query without the old cursor;
- repeated IDs across pages are deduplicated while preserving order;
- cards with no pack group under `其他球员卡`;
- absent image URL produces initials and `usesFallbackArtwork: true`.

- [ ] **Step 2: Write failing detail view-model tests**

Test attribute ordering by a fixed display order, unknown attributes appended alphabetically, empty skills, image fallback, nullable club/nationality, and sibling-card navigation data.

- [ ] **Step 3: Run tests and verify RED**

Run: `pnpm --filter @efm/miniprogram test -- players.viewmodel.spec.ts detail.viewmodel.spec.ts`

Expected: FAIL because catalog services and view models do not exist.

- [ ] **Step 4: Allow public API requests without refresh behavior**

Extend `ApiRequestOptions` export and keep `skipAuth`. Public catalog calls pass `skipAuth: true`; a 401 from a public route becomes an API error and must not trigger token refresh or redirect to login.

- [ ] **Step 5: Implement the catalog client and pure view models**

Use `URLSearchParams`-independent query building because the WeChat runtime may not expose the browser implementation consistently. Encode keys and values with `encodeURIComponent`. Keep WXML-specific labels in view models:

```ts
const positionLabels = { GK: '门将', CB: '中后卫', CF: '中锋', RWF: '右边锋' } as const;
const cardTypeLabels = {
  STANDARD: '基础卡', FEATURED: '精选', TRENDING: '状态火热',
  HIGHLIGHT: '高光', EPIC: '史诗', BIG_TIME: '时刻', OTHER: '其他'
} as const;
```

Include every enum member in the real maps.

- [ ] **Step 6: Verify GREEN**

Run: `pnpm --filter @efm/miniprogram test && pnpm --filter @efm/miniprogram typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/miniprogram/miniprogram/services apps/miniprogram/miniprogram/pages/players apps/miniprogram/miniprogram/pages/player-card-detail
git commit -m "feat(miniprogram): add player catalog client models"
```

---

### Task 9: Native mini-program player list, filters, detail, and navigation

**Files:**
- Create: `apps/miniprogram/miniprogram/pages/players/index.json`
- Create: `apps/miniprogram/miniprogram/pages/players/index.ts`
- Create: `apps/miniprogram/miniprogram/pages/players/index.wxml`
- Create: `apps/miniprogram/miniprogram/pages/players/index.wxss`
- Create: `apps/miniprogram/miniprogram/pages/player-card-detail/index.json`
- Create: `apps/miniprogram/miniprogram/pages/player-card-detail/index.ts`
- Create: `apps/miniprogram/miniprogram/pages/player-card-detail/index.wxml`
- Create: `apps/miniprogram/miniprogram/pages/player-card-detail/index.wxss`
- Create: `apps/miniprogram/miniprogram/components/player-card/index.json`
- Create: `apps/miniprogram/miniprogram/components/player-card/index.ts`
- Create: `apps/miniprogram/miniprogram/components/player-card/index.wxml`
- Create: `apps/miniprogram/miniprogram/components/player-card/index.wxss`
- Create: `apps/miniprogram/miniprogram/assets/icons/player.png`
- Create: `apps/miniprogram/miniprogram/assets/icons/player-active.png`
- Create: `apps/miniprogram/miniprogram/assets/icons/profile.png`
- Create: `apps/miniprogram/miniprogram/assets/icons/profile-active.png`
- Modify: `apps/miniprogram/miniprogram/app.json`
- Modify: `apps/miniprogram/miniprogram/app.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/login/index.ts`
- Test: `apps/miniprogram/miniprogram/pages/players/players.viewmodel.spec.ts`

**Interfaces:**
- Consumes: `catalogApi` and view models from Task 8.
- Produces: public default players page, reusable `<player-card>`, card detail page, and `球员/我的` tab bar.

- [ ] **Step 1: Add a failing navigation-state test**

Extend the player view-model test with `nextPlayerPageState(current, response, mode)` and prove refresh replaces items, pagination appends unique items, an empty `nextCursor` stops further requests, and an error preserves already loaded content.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @efm/miniprogram test -- players.viewmodel.spec.ts`

Expected: FAIL because `nextPlayerPageState` does not exist.

- [ ] **Step 3: Implement the reusable player-card component**

Define a `card` property using the Task 8 view model and a `cardtap` event. The WXML renders owned CSS artwork: rating and position top-left, fallback initials centered, player name at the bottom, and type/play-style labels below. Use remote `<image>` only when `usesFallbackArtwork` is false; `binderror` switches the component to fallback locally.

- [ ] **Step 4: Implement the players page behavior**

Page state contains `loading`, `refreshing`, `loadingMore`, `errorMessage`, `keyword`, filter values, `groups`, `nextCursor`, and `hasMore`. Implement:

- debounced search at 300 ms;
- filter changes that clear cursor and replace results;
- `onPullDownRefresh` replacement;
- `onReachBottom` guarded by `loadingMore || !hasMore`;
- stale-request token so an older response cannot overwrite a newer filter result;
- card tap navigation built as `` `/pages/player-card-detail/index?id=${encodeURIComponent(card.id)}` ``;
- visible retry action.

- [ ] **Step 5: Implement the detail page behavior**

Validate `options.id`, load the public detail, render owned artwork, metadata, ordered attributes, skills, pack, and sibling cards. Show a distinct unavailable state for 404, retry state for network/service errors, and ignore responses after `onUnload`.

- [ ] **Step 6: Configure navigation and login return path**

Make `pages/players/index` the first page. Add a custom-color native tab bar with `球员` and `我的`; use locally owned icons. Because tab pages require `switchTab`, update login success to `wx.switchTab({ url: '/pages/profile/index' })`. Profile remains protected by its existing session flow; catalog pages remain public.

- [ ] **Step 7: Apply the visual system**

Add shared variables as documented classes in `app.wxss`: background `#0b100e`, surface `#141c18`, border `#294c3a`, primary `#66f05a`, accent `#f0b84b`, primary text `#f5f7f6`, secondary text `#98a69f`. Respect safe areas and minimum 44px tap targets. Do not embed third-party logos, card frames, or screenshots.

- [ ] **Step 8: Verify the mini-program**

Run:

```bash
pnpm --filter @efm/miniprogram test
pnpm --filter @efm/miniprogram typecheck
pnpm --filter @efm/miniprogram build
```

Expected: PASS. Then open the project in WeChat Developer Tools and manually verify public launch, filter changes, pagination, detail navigation, image fallback, and “我的” login redirection on simulator and one real device.

- [ ] **Step 9: Commit**

```bash
git add apps/miniprogram/miniprogram
git commit -m "feat(miniprogram): build the player catalog experience"
```

---

### Task 10: Sample import, operator documentation, and full verification

**Files:**
- Create: `fixtures/player-import/sample-player-cards.json`
- Create: `fixtures/player-import/sample-player-cards.csv`
- Create: `docs/development/player-import.md`
- Modify: `docs/development/local-development.md`
- Test: full workspace verification.

**Interfaces:**
- Consumes: CLI and APIs from Tasks 5–7.
- Produces: reproducible local seed/import workflow and verified operator instructions.

- [ ] **Step 1: Create matching sample fixtures**

Add three fictional or clearly placeholder cards covering Chinese/English names, one pack, skills, attributes, an absent image, and one authorized-example HTTPS image URL documented as replace-before-production. CSV and JSON must normalize to equivalent records.

- [ ] **Step 2: Document the exact operator flow**

Document prerequisites, supported columns, enum values, 5,000-row limit, validation output, batch review endpoint, publish command, idempotency, explicit inactive status, rollback behavior, and troubleshooting. Include commands with shell variables that do not reuse `HOME` or `CODEX_HOME`:

```bash
export EFM_ACTOR_ID="00000000-0000-0000-0000-000000000000"
pnpm player-import:validate fixtures/player-import/sample-player-cards.json --source manual --actor "$EFM_ACTOR_ID"
export EFM_BATCH_ID="22222222-2222-4222-8222-222222222222"
pnpm player-import:publish "$EFM_BATCH_ID" --actor "$EFM_ACTOR_ID"
```

Explain that the example actor and batch UUIDs must be replaced with the local authorized actor ID and the ID printed by validation before execution.

- [ ] **Step 3: Exercise JSON and CSV imports locally**

Run both fixtures through validate. Publish JSON, then validate CSV and confirm all three records are `UNCHANGED`. Query `/v1/players` and one card detail endpoint and record the expected response fields in the document.

- [ ] **Step 4: Run migration status and the full verification suite**

Run:

```bash
pnpm db:status
pnpm verify
git diff --check
```

Expected: database schema is current; lint, typecheck, unit tests, E2E tests, and builds all pass; `git diff --check` prints nothing.

- [ ] **Step 5: Commit**

```bash
git add fixtures docs/development
git commit -m "docs: add player import operator workflow"
```
