# Individual Competition Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a versioned, extensible individual round-robin competition loop from competition creation through registration, schedule publication, score confirmation, and standings in the Native WeChat mini-program.

**Architecture:** Shared Zod contracts define the public boundary. NestJS modules persist a generic `CompetitionParticipant` that decouples matches and standings from individual users, while pure domain functions own state transitions, round-robin generation, and standings calculation. Every mutation is transactional, idempotent, and version checked; the mini-program consumes only API contracts and exposes player and scoped-manager workflows.

**Tech Stack:** Node.js 24, TypeScript 5.9, NestJS 12, Zod 4, Prisma 7, MySQL 8, Jest 29, Vitest 3, native WeChat Mini Program

**Spec:** `docs/superpowers/specs/2026-09-25-individual-competition-loop-design.md` and `docs/superpowers/specs/2026-09-25-individual-competition-loop-design.zh-CN.md`

## Global Constraints

- The first release exposes only `INDIVIDUAL` participants and one `ROUND_ROBIN` stage; reserved enum values must not expose incomplete team, salary-cap, or elimination workflows.
- Matches and standings reference `CompetitionParticipant`, never a user directly.
- Registration applications remain distinct from admitted participants and keep append-only status history.
- Platform, server region, participant type, format, and bound rule version become immutable when registration opens.
- All timestamps are stored as UTC and serialized as ISO 8601; the mini-program formats them in the device timezone.
- Published schedules cannot be regenerated or overwritten.
- Every score submission creates a result version; official result history is never overwritten or physically deleted.
- Only `CONFIRMED` and `ADMIN_DECIDED` matches contribute to standings.
- Standings are recalculated from the complete official result set and stored as immutable snapshots.
- Every write accepts an idempotency key, and every version-sensitive write rejects stale versions with HTTP `409`.
- Existing identity, player catalog, import, and PESDATA synchronization behavior must remain green.

## Review Focus

- A registration racing with the registration deadline or close transition must recheck state and UTC time inside the transaction and either create one application or return `REGISTRATION_CLOSED`; Task 6 pins this.
- Odd participant counts and repeated schedule generation must produce one bye per round at most, no duplicate pairing, and the same unpublished schedule; Task 7 pins this.
- Two opponents concurrently confirming or replacing proposals must leave exactly one official result version and one standings snapshot for that official transition; Task 8 pins this.
- A three-way tie must calculate the mini-table from only matches among tied participants before applying overall goal difference; Task 4 pins this.
- Registration windows spanning a daylight-saving transition must compare UTC instants rather than formatted local dates; Task 6 pins this with explicit offset timestamps.

---

### Task 1: Define competition API contracts

**Files:**
- Create: `packages/contracts/src/competition.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`

**Interfaces:**
- Produces `CompetitionStatusSchema`, `CompetitionParticipantTypeSchema`, `CompetitionFormatSchema`, `CompetitionRegistrationStatusSchema`, `CompetitionMatchStatusSchema`, and `MatchResultVersionStatusSchema`.
- Produces request schemas `IdempotencyKeySchema`, `CreateCompetitionRequestSchema`, `UpdateCompetitionRequestSchema`, `UpdateCompetitionRulesRequestSchema`, `RegisterCompetitionRequestSchema`, `ReviewRegistrationRequestSchema`, `VersionedMutationRequestSchema`, `SubmitMatchResultRequestSchema`, and `RejectMatchResultRequestSchema`.
- Produces response types `CompetitionSummary`, `CompetitionDetail`, `CompetitionRegistrationResponse`, `CompetitionMatchResponse`, `StandingsSnapshotResponse`, `MyCompetitionResponse`, and `MyMatchResponse` consumed by all later API and mini-program tasks.

- [ ] **Step 1: Add failing contract tests for lifecycle values, time ordering, score bounds, and expected versions**

Add cases to `contracts.spec.ts` that pin exact inputs:

```ts
const validCompetition = {
  name: '秋季个人联赛',
  description: '4 人测试联赛',
  platform: 'MOBILE',
  serverRegion: 'GLOBAL',
  participantType: 'INDIVIDUAL',
  format: 'ROUND_ROBIN',
  registrationOpensAt: '2026-10-01T00:00:00.000Z',
  registrationClosesAt: '2026-10-08T00:00:00.000Z',
  startsAt: '2026-10-09T00:00:00.000Z',
  endsAt: '2026-10-31T00:00:00.000Z',
  participantLimit: 16,
};

assert.equal(CreateCompetitionRequestSchema.parse(validCompetition).participantLimit, 16);
assert.throws(() => CreateCompetitionRequestSchema.parse({
  ...validCompetition,
  registrationClosesAt: '2026-09-30T23:59:59.000Z',
}));
assert.throws(() => SubmitMatchResultRequestSchema.parse({
  homeScore: -1,
  awayScore: 2,
  expectedVersion: 1,
}));
assert.equal(IdempotencyKeySchema.parse('score-1'), 'score-1');
```

Also assert the public response accepts `tiePending: true`, result versions expose `submittedByMe`, and reserved `TEAM`/`SINGLE_ELIMINATION` enum values parse even though create requests reject them in this release.

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
pnpm --filter @efm/contracts test
```

Expected: TypeScript fails because `competition.ts` and the schemas do not exist.

- [ ] **Step 3: Implement the complete Zod boundary**

Create `competition.ts` with JSON-safe, bounded schemas. Keep reserved enum values separate from first-release create constraints:

```ts
export const CompetitionParticipantTypeSchema = z.enum(['INDIVIDUAL', 'TEAM']);
export const CompetitionFormatSchema = z.enum([
  'ROUND_ROBIN', 'DOUBLE_ROUND_ROBIN', 'SINGLE_ELIMINATION', 'GROUP_KNOCKOUT'
]);
export const CreateCompetitionRequestSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(2_000).default(''),
  platform: GamePlatformSchema,
  serverRegion: z.string().trim().min(1).max(32),
  participantType: z.literal('INDIVIDUAL'),
  format: z.literal('ROUND_ROBIN'),
  registrationOpensAt: z.iso.datetime(),
  registrationClosesAt: z.iso.datetime(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  participantLimit: z.number().int().min(2).max(128),
}).superRefine(validateCompetitionTimeline);
```

Define responses with `ResourceIdSchema`, ISO datetimes, nullable current registration, rules, schedule metadata, official-result summaries, and standings version metadata. Export inferred input/output types and export the module from `index.ts`.

- [ ] **Step 4: Run contract tests and typecheck GREEN**

Run:

```bash
pnpm --filter @efm/contracts test
pnpm --filter @efm/contracts typecheck
```

Expected: all shared contract tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src
git commit -m "feat(contracts): define competition loop APIs"
```

### Task 2: Persist competition, version, and idempotency records

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20260925140000_individual_competition_loop/migration.sql`
- Modify: `apps/api/prisma/seed.ts`
- Modify: `apps/api/src/database/prisma.service.spec.ts`

**Interfaces:**
- Produces Prisma delegates for `competition`, `competitionRuleVersion`, `competitionRegistration`, `competitionRegistrationStatusHistory`, `competitionParticipant`, `competitionStage`, `competitionMatch`, `matchResultVersion`, `standingsSnapshot`, `standingsRow`, and `mutationReceipt`.
- Produces seeded permissions consumed by Task 5 onward.
- Preserves `GameAccountUsagePort`; Task 6 replaces its default adapter with registration-aware usage checks.

- [ ] **Step 1: Extend the Prisma delegate test and make it fail**

Add exact assertions:

```ts
expect(prisma.competition).toBeDefined();
expect(prisma.competitionRegistration).toBeDefined();
expect(prisma.competitionParticipant).toBeDefined();
expect(prisma.competitionMatch).toBeDefined();
expect(prisma.matchResultVersion).toBeDefined();
expect(prisma.standingsSnapshot).toBeDefined();
expect(prisma.mutationReceipt).toBeDefined();
```

Run:

```bash
pnpm --filter @efm/api test -- prisma.service.spec.ts --runInBand
```

Expected: generated Prisma client lacks these delegates.

- [ ] **Step 2: Add enums and models with exact uniqueness rules**

Add the enums from Task 1 plus `CompetitionStageStatus`, `MatchResultSubmissionSide`, and `MatchResultVersionStatus`. Add models with these database invariants:

```prisma
model CompetitionRegistration {
  id            String @id @default(uuid()) @db.Char(36)
  competitionId String @map("competition_id") @db.Char(36)
  applicantId   String @map("applicant_id") @db.Char(36)
  gameAccountId String @map("game_account_id") @db.Char(36)
  acceptedRuleVersion Int @map("accepted_rule_version") @db.UnsignedInt
  status CompetitionRegistrationStatus @default(PENDING)
  reviewedById String? @map("reviewed_by_id") @db.Char(36)
  reviewReason String? @map("review_reason") @db.VarChar(512)
  reviewedAt DateTime? @map("reviewed_at")
  withdrawnAt DateTime? @map("withdrawn_at")
  version       Int    @default(1) @db.UnsignedInt
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  @@unique([competitionId, applicantId], map: "competition_registrations_applicant_unique")
}

model CompetitionParticipant {
  competitionId    String @map("competition_id") @db.Char(36)
  registrationId   String @unique @map("registration_id") @db.Char(36)
  individualUserId String? @map("individual_user_id") @db.Char(36)
  teamId            String? @map("team_id") @db.Char(36)
  admissionSequence Int    @map("admission_sequence") @db.UnsignedInt
  @@unique([competitionId, admissionSequence], map: "competition_participants_sequence_unique")
  @@unique([competitionId, individualUserId], map: "competition_participants_user_unique")
}

model CompetitionMatch {
  stageId    String @map("stage_id") @db.Char(36)
  pairingKey String @map("pairing_key") @db.VarChar(73)
  matchNumber Int   @map("match_number") @db.UnsignedInt
  version    Int    @default(1) @db.UnsignedInt
  @@unique([stageId, pairingKey], map: "competition_matches_pair_unique")
  @@unique([stageId, matchNumber], map: "competition_matches_number_unique")
}

model MatchResultVersion {
  matchId String @map("match_id") @db.Char(36)
  version Int    @db.UnsignedInt
  @@unique([matchId, version], map: "match_result_versions_version_unique")
}

model StandingsSnapshot {
  competitionId String @map("competition_id") @db.Char(36)
  version Int @db.UnsignedInt
  @@unique([competitionId, version], map: "standings_snapshots_version_unique")
}

model MutationReceipt {
  id        String @id @default(uuid()) @db.Char(36)
  actorId   String @map("actor_id") @db.Char(36)
  operation String @db.VarChar(96)
  key       String @db.VarChar(128)
  resultJson Json? @map("result_json")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  @@unique([actorId, operation, key], map: "mutation_receipts_request_unique")
}
```

Use named relations where `User` is referenced in several roles. Add `version`, `createdAt`, and `updatedAt` to mutable aggregate roots. Use `onDelete: Restrict` for official competition history and `Cascade` only for draft-owned child data whose parent is never physically deleted after publication.

- [ ] **Step 3: Generate, inspect, and apply the migration**

Run:

```bash
pnpm db:generate
pnpm db:migrate:dev -- --name individual_competition_loop
pnpm db:status
```

Expected: migration applies, all foreign keys and unique indexes above exist, and status reports all migrations applied. If Prisma chooses a different timestamp directory, keep the generated directory and update this plan ledger with that ruling rather than renaming an applied migration.

- [ ] **Step 4: Seed permissions and fixed-role mappings**

Extend `seed.ts` with the five permissions from the spec. Grant `competition.create` to `PLATFORM_ADMIN`; grant all five to `PLATFORM_ADMIN`; grant management, review, schedule, and result permissions to `EVENT_MANAGER`. Keep the upserts idempotent:

```ts
const competitionPermissions = [
  ['competition.create', 'Create competitions'],
  ['competition.manage', 'Manage a competition'],
  ['competition.registration.review', 'Review competition registrations'],
  ['competition.schedule.manage', 'Manage competition schedules'],
  ['competition.result.manage', 'Manage official competition results'],
] as const;
```

Run `pnpm --filter @efm/api exec prisma db seed` twice and query `role_permissions`; counts must not increase on the second run.

- [ ] **Step 5: Run GREEN persistence tests and commit**

```bash
pnpm --filter @efm/api test -- prisma.service.spec.ts --runInBand
pnpm --filter @efm/api typecheck
git add apps/api/prisma apps/api/src/database/prisma.service.spec.ts
git commit -m "feat(api): persist competition aggregates"
```

### Task 3: Add transactional idempotency and competition error primitives

**Files:**
- Create: `apps/api/src/competitions/competition.errors.ts`
- Create: `apps/api/src/competitions/mutation-receipt.service.ts`
- Create: `apps/api/src/competitions/mutation-receipt.service.spec.ts`
- Create: `apps/api/src/competitions/competition.types.ts`

**Interfaces:**
- Produces `CompetitionError(code, message, status)` with stable codes.
- Produces `MutationReceiptService.execute<T>(actorId, operation, key, work): Promise<T>` where `work(transaction)` runs inside the same transaction that stores the JSON result.
- Produces `assertExpectedVersion(actual, expected, resource): void` consumed by lifecycle, registration, schedule, and result services.

- [ ] **Step 1: Write failing idempotency tests**

Test that two sequential calls with the same actor, operation, and key invoke the callback once and return the stored result; a different actor or operation executes separately. Test a callback failure stores no receipt. Pin keys longer than 128 characters and blank keys to `IDEMPOTENCY_KEY_INVALID` before a transaction starts.

```ts
const first = await service.execute(actorId, 'competition.create', 'create-1', async () => {
  executions += 1;
  return { id: competitionId, version: 1 };
});
const second = await service.execute(actorId, 'competition.create', 'create-1', async () => {
  executions += 1;
  return { id: randomUUID(), version: 1 };
});
expect(second).toEqual(first);
expect(executions).toBe(1);
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @efm/api test -- mutation-receipt.service.spec.ts --runInBand
```

Expected: module does not exist.

- [ ] **Step 3: Implement transaction reuse and duplicate-key recovery**

First perform a fast committed-receipt lookup. On a miss, start one Prisma interactive transaction and insert a receipt claim with `resultJson=null` before invoking `work(transaction)`, then update the same claim with the JSON result before commit. A concurrent insert waits on the unique key and raises `P2002` after the winner commits; catch it outside the transaction, load the populated winner receipt, and return that result. A failed callback rolls back both domain writes and the claim. Restrict `T` to `Prisma.InputJsonValue`-compatible values and round-trip through JSON so replayed results match first responses. Map stale versions with:

```ts
export function assertExpectedVersion(actual: number, expected: number, resource: string): void {
  if (actual !== expected) {
    throw new CompetitionError('VERSION_CONFLICT', `${resource} has changed`, 409);
  }
}
```

- [ ] **Step 4: Run GREEN and commit**

```bash
pnpm --filter @efm/api test -- mutation-receipt.service.spec.ts --runInBand
pnpm --filter @efm/api typecheck
git add apps/api/src/competitions
git commit -m "feat(api): make competition mutations idempotent"
```

### Task 4: Implement pure lifecycle, round-robin, and standings domain functions

**Files:**
- Create: `apps/api/src/competitions/domain/competition-state.ts`
- Create: `apps/api/src/competitions/domain/competition-state.spec.ts`
- Create: `apps/api/src/competitions/domain/round-robin.ts`
- Create: `apps/api/src/competitions/domain/round-robin.spec.ts`
- Create: `apps/api/src/competitions/domain/standings.ts`
- Create: `apps/api/src/competitions/domain/standings.spec.ts`

**Interfaces:**
- Produces `assertCompetitionTransition(from, to): void`.
- Produces `generateRoundRobin(participantIds: string[]): ScheduledPairing[]`, where `ScheduledPairing = { roundNumber; matchNumber; homeParticipantId; awayParticipantId; pairingKey }`.
- Produces `calculateStandings(participants, officialResults, rules): CalculatedStanding[]` with head-to-head mini-table values and `tiePending`.

- [ ] **Step 1: Write state-machine RED tests**

Cover every allowed edge and reject skipping states, reopening completed competitions, starting without `SCHEDULED`, and completing from `SCHEDULED`. The function throws `COMPETITION_TRANSITION_INVALID` with both states in diagnostic metadata.

- [ ] **Step 2: Write scheduler property RED tests**

For sizes 2 through 9 assert:

```ts
const schedule = generateRoundRobin(ids);
expect(new Set(schedule.map((m) => m.pairingKey)).size).toBe(schedule.length);
expect(schedule).toHaveLength(ids.length * (ids.length - 1) / 2);
for (const round of groupByRound(schedule)) {
  const appearances = round.flatMap((m) => [m.homeParticipantId, m.awayParticipantId]);
  expect(new Set(appearances).size).toBe(appearances.length);
}
expect(generateRoundRobin(ids)).toEqual(schedule);
```

For odd sizes assert each round omits exactly one participant and never creates a bye match.

- [ ] **Step 3: Write standings RED tests including the Review Focus three-way tie**

Use four participants where A, B, and C have equal total points but their matches against D would change overall goal difference. Assert the mini-table first orders the tied trio by head-to-head points and head-to-head goal difference, then applies total goal difference. Add win/draw/loss totals, correction replacement, no-results rows, and exact unresolved tie tests.

- [ ] **Step 4: Run RED domain tests**

```bash
pnpm --filter @efm/api test -- competition-state.spec.ts round-robin.spec.ts standings.spec.ts --runInBand
```

Expected: missing domain modules.

- [ ] **Step 5: Implement the pure functions without Prisma or NestJS dependencies**

The scheduler sorts a copy of IDs, appends a private `BYE` sentinel for odd counts, fixes one position, rotates the remainder, alternates home/away by round, drops bye pairings, assigns monotonically increasing match numbers, and forms `pairingKey` from lexically sorted participant IDs.

The standings calculator first builds overall rows, groups equal-total-point rows, computes a mini-table per tied group from results whose two participants are both in that group, and applies the ordered rule list. It returns a new immutable array and never mutates inputs.

- [ ] **Step 6: Run GREEN, mutation-safety checks, and commit**

```bash
pnpm --filter @efm/api test -- competition-state.spec.ts round-robin.spec.ts standings.spec.ts --runInBand
pnpm --filter @efm/api typecheck
git add apps/api/src/competitions/domain
git commit -m "feat(api): add competition domain algorithms"
```

### Task 5: Build competition lifecycle and public queries

**Files:**
- Create: `apps/api/src/competitions/competitions.module.ts`
- Create: `apps/api/src/competitions/competitions.service.ts`
- Create: `apps/api/src/competitions/competitions.service.spec.ts`
- Create: `apps/api/src/competitions/public-competitions.controller.ts`
- Create: `apps/api/src/competitions/admin-competitions.controller.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/test/test-app.ts`
- Create: `apps/api/test/competitions.e2e-spec.ts`

**Interfaces:**
- Consumes contracts from Task 1, Prisma models from Task 2, idempotency from Task 3, and lifecycle validation from Task 4.
- Produces `CompetitionsService.create`, `update`, `transition`, `listPublic`, and `getPublic`.
- Produces public and scoped-admin routes required by the spec.

- [ ] **Step 1: Write failing service tests for creation, immutable fields, scoped manager binding, and public visibility**

Create a platform admin and a normal user. Assert create returns `DRAFT`, version `1`, rule version `1`, and an active `EVENT_MANAGER` binding with scope type `COMPETITION`. Assert the same idempotency key returns the same competition. Updating scoring or tie-break order creates rule version `2` instead of overwriting version `1`; opening registration binds the active rule version. Assert opening registration locks platform/region/type/format and a later patch returns `COMPETITION_CORE_FIELDS_LOCKED`. Assert rule mutation after `IN_PROGRESS` returns `COMPETITION_RULES_LOCKED`. Assert public list excludes `DRAFT` and includes `REGISTRATION_OPEN`.

- [ ] **Step 2: Write failing API tests**

Use `createTestApp()` and authenticated requests to pin:

```ts
await request(app.getHttpServer())
  .post('/v1/admin/competitions')
  .set('Authorization', `Bearer ${adminToken}`)
  .set('Idempotency-Key', 'competition-create-1')
  .send(validCreateBody)
  .expect(201);

await request(app.getHttpServer())
  .get('/v1/competitions')
  .expect(200);
```

Also assert missing idempotency key is `400 IDEMPOTENCY_KEY_REQUIRED`, stale update is `409 VERSION_CONFLICT`, a manager for another competition gets `403`, and invalid timeline is `400 VALIDATION_FAILED`.

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @efm/api test -- competitions.service.spec.ts competitions.e2e-spec.ts --runInBand
```

Expected: services, module, and routes do not exist.

- [ ] **Step 4: Implement lifecycle transactions and response mapping**

`create` uses `MutationReceiptService`, inserts competition and rule version 1, and adds the creator's competition-scoped `EVENT_MANAGER` binding in one transaction. `update` performs `updateMany({ where: { id, version: expectedVersion } })` and increments `version`; zero updated rows become `VERSION_CONFLICT`. `transition` calls `assertCompetitionTransition`, validates required conditions, and applies the same compare-and-swap update.

Use deterministic cursor order `(registrationOpensAt desc, id asc)` for public list. Public detail includes rules and registration counts but no private review metadata.

Expose these lifecycle mutations explicitly, each with `expectedVersion` in its body and `Idempotency-Key` in its header:

```text
POST /v1/admin/competitions/:id/open-registration
POST /v1/admin/competitions/:id/close-registration
POST /v1/admin/competitions/:id/start
POST /v1/admin/competitions/:id/complete
POST /v1/admin/competitions/:id/cancel
POST /v1/admin/competitions/:id/rules
```

Rule mutation appends the next per-competition rule version and updates the active version using compare-and-swap; it never edits an existing rule row. Starting requires a published schedule, moves the competition from `SCHEDULED` to `IN_PROGRESS`, and updates remaining `SCHEDULED` matches to `AWAITING_RESULT` in the same transaction. Completing requires an official result for every published match. Cancelling requires a non-empty reason and preserves all child records.

- [ ] **Step 5: Add controllers and module wiring**

Public routes use `ZodValidationPipe` without a guard. Admin routes use `JwtAuthGuard` and `ScopeGuard`; creation requires the platform `competition.create` permission, while routes under `admin/competitions/:id` use:

```ts
@RequirePermission('competition.manage', { type: 'COMPETITION', param: 'id' })
```

Read the `Idempotency-Key` header explicitly and pass it into every mutation. Import `CompetitionsModule` in `AppModule` and the test app.

- [ ] **Step 6: Run GREEN and commit**

```bash
pnpm --filter @efm/api test -- competitions.service.spec.ts competitions.e2e-spec.ts --runInBand
pnpm --filter @efm/api typecheck
git add apps/api/src/competitions apps/api/src/app.module.ts apps/api/test
git commit -m "feat(api): manage competition lifecycle"
```

### Task 6: Implement registration, status history, and participant admission

**Files:**
- Create: `apps/api/src/competitions/registrations.service.ts`
- Create: `apps/api/src/competitions/registrations.service.spec.ts`
- Create: `apps/api/src/competitions/registrations.controller.ts`
- Create: `apps/api/src/competitions/registration-usage.adapter.ts`
- Modify: `apps/api/src/competitions/competitions.module.ts`
- Modify: `apps/api/src/users/users.module.ts`
- Modify: `apps/api/test/competitions.e2e-spec.ts`

**Interfaces:**
- Produces `RegistrationsService.register`, `withdraw`, `review`, `listForManager`, and `getMine`.
- Produces `RegistrationUsageAdapter.isGameAccountInUse(gameAccountId): Promise<boolean>` implementing the existing `GameAccountUsagePort`.
- Produces exactly one participant for one approved registration.

- [ ] **Step 1: Write RED registration tests for eligibility and durable history**

Test owned vs foreign account, platform mismatch, server mismatch, duplicate request, full competition, before-open, after-close, withdrawal, rejection, and resubmission. Assert every transition appends status history and does not overwrite older entries.

Pin the UTC/DST Review Focus case using registration bounds `2026-11-01T05:30:00.000Z` through `2026-11-01T07:30:00.000Z` and injected clocks immediately inside and outside those instants; no formatted local date may participate in the comparison.

- [ ] **Step 2: Write RED concurrency and review tests**

Run two registration promises with different idempotency keys for the same user; one durable registration remains. Run approval twice and assert one participant, one admission sequence, and replayed response. Closing registration concurrently with registration must re-read competition status and time inside the registration transaction; the outcome is one registration or `REGISTRATION_CLOSED`, never an application committed after closure.

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @efm/api test -- registrations.service.spec.ts --runInBand
```

Expected: registration service is missing.

- [ ] **Step 4: Implement register, resubmit, withdraw, and review transactions**

Inject a clock token for deterministic tests. Inside `register`, lock/re-read competition, verify `REGISTRATION_OPEN` and UTC bounds, load the account with `userId`, compare platform/region, and use the durable `(competitionId, applicantId)` record. A rejected or withdrawn record returns to `PENDING` with incremented version and a new history row. An approved record cannot resubmit.

Inside approval, allocate `admissionSequence` as `max + 1` under the transaction, create participant via the registration unique key, update the registration and history, and replay safely through the receipt. Reject requires a non-empty reason.

- [ ] **Step 5: Add player and manager routes plus game-account usage**

Player routes use `JwtAuthGuard` and service ownership checks. Manager review routes are nested under `/v1/admin/competitions/:id/registrations` so `ScopeGuard` can resolve the competition ID. Replace the initial no-op game-account usage provider with an adapter that returns true for `PENDING` or `APPROVED` registrations in non-completed/non-cancelled competitions.

Expose the exact routes:

```text
POST   /v1/competitions/:id/registrations
DELETE /v1/competitions/:id/registrations/me
GET    /v1/competitions/:id/registrations/me
GET    /v1/admin/competitions/:id/registrations
POST   /v1/admin/competitions/:id/registrations/:registrationId/approve
POST   /v1/admin/competitions/:id/registrations/:registrationId/reject
```

- [ ] **Step 6: Run service, e2e, and user regression tests; commit**

```bash
pnpm --filter @efm/api test -- registrations.service.spec.ts competitions.e2e-spec.ts game-accounts.service.spec.ts --runInBand
pnpm --filter @efm/api typecheck
git add apps/api/src/competitions apps/api/src/users apps/api/test/competitions.e2e-spec.ts
git commit -m "feat(api): register individual competitors"
```

### Task 7: Generate, preview, and publish the round-robin schedule

**Files:**
- Create: `apps/api/src/competitions/schedules.service.ts`
- Create: `apps/api/src/competitions/schedules.service.spec.ts`
- Create: `apps/api/src/competitions/schedules.controller.ts`
- Modify: `apps/api/src/competitions/competitions.module.ts`
- Modify: `apps/api/test/competitions.e2e-spec.ts`

**Interfaces:**
- Consumes `generateRoundRobin` from Task 4.
- Produces `SchedulesService.generate`, `preview`, `publish`, and `listPublic`.
- Produces draft schedule manager routes and published public match routes.

- [ ] **Step 1: Write RED tests for generation preconditions and exact four-player output**

Assert only `REGISTRATION_CLOSED` competitions with at least two approved participants generate. Four participants produce three rounds and six unique matches. Five participants produce five rounds and ten matches, with each participant absent exactly once. Match numbers are stable across repeated generation.

- [ ] **Step 2: Write RED tests for idempotency, draft replacement, and publication locking**

Generate twice with the same and different idempotency keys; both yield one draft stage and identical matches. After publication, generate returns `SCHEDULE_ALREADY_PUBLISHED`. A failed regeneration transaction leaves the prior complete draft intact. Publishing transitions competition to `SCHEDULED` and stage to `PUBLISHED` atomically.

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @efm/api test -- schedules.service.spec.ts --runInBand
```

Expected: schedule service is missing.

- [ ] **Step 4: Implement draft replacement and publish compare-and-swap**

Read participants ordered by admission sequence and ID, call the pure generator, create a stage with sequence 1, and bulk-create matches with `pairingKey`. Regeneration deletes only a `DRAFT` stage inside the same transaction before inserting its replacement. Publication validates expected competition and stage versions, publishes the stage, and moves the competition to `SCHEDULED`.

- [ ] **Step 5: Add routes and public filtering**

Manager routes:

```text
POST /v1/admin/competitions/:id/schedule/generate
GET  /v1/admin/competitions/:id/schedule/preview
POST /v1/admin/competitions/:id/schedule/publish
```

Public `GET /v1/competitions/:id/matches` returns only matches in a `PUBLISHED` stage, ordered by round and match number. Include participant display snapshots, planned time, status, and official score when present.

- [ ] **Step 6: Run GREEN and commit**

```bash
pnpm --filter @efm/api test -- round-robin.spec.ts schedules.service.spec.ts competitions.e2e-spec.ts --runInBand
pnpm --filter @efm/api typecheck
git add apps/api/src/competitions apps/api/test/competitions.e2e-spec.ts
git commit -m "feat(api): publish round robin schedules"
```

### Task 8: Version match results and regenerate standings

**Files:**
- Create: `apps/api/src/competitions/standings.service.ts`
- Create: `apps/api/src/competitions/standings.service.spec.ts`
- Create: `apps/api/src/competitions/results.service.ts`
- Create: `apps/api/src/competitions/results.service.spec.ts`
- Create: `apps/api/src/competitions/results.controller.ts`
- Modify: `apps/api/src/competitions/competitions.module.ts`
- Modify: `apps/api/test/competitions.e2e-spec.ts`

**Interfaces:**
- Produces `StandingsService.recalculate(transaction, competitionId, triggerResultVersionId)` and `getLatestPublic`.
- Produces `ResultsService.submit`, `confirm`, `reject`, and `recordByManager`.
- Consumes `calculateStandings` from Task 4 and persists one immutable snapshot per official transition.

- [ ] **Step 1: Write RED result authorization and version-history tests**

Assert only home or away individual users may submit. A submitter cannot confirm their own proposal. A nonparticipant gets `MATCH_NOT_FOUND`. Negative or non-integer scores fail contract validation. Rejection requires a reason and leaves no official result. Confirmation sets proposal `OFFICIAL`, updates match status/current version, and preserves older versions.

- [ ] **Step 2: Write RED manager-correction and standings tests**

Manager entry creates `ADMIN_DECIDED`; replacing an official score requires a reason, sets the old result to `SUPERSEDED`, and creates a new result version. Assert standings version increments exactly once, recomputes from all current official versions, and old snapshot rows remain unchanged.

- [ ] **Step 3: Pin concurrent confirmation from the Review Focus**

Create two proposed versions from opposite sides, then confirm them concurrently with their expected match version. Assert one succeeds, one returns `409 VERSION_CONFLICT`, exactly one version is `OFFICIAL`, and exactly one new standings snapshot exists.

- [ ] **Step 4: Run RED**

```bash
pnpm --filter @efm/api test -- results.service.spec.ts standings.service.spec.ts --runInBand
```

Expected: result and standings services are missing.

- [ ] **Step 5: Implement official-result transaction and recalculation**

Allocate result versions from the latest row while holding the match compare-and-swap version. For confirmation or manager entry, supersede the current official row, promote the new row, update match status and `officialResultVersionId`, then call `StandingsService.recalculate` using the same Prisma transaction. Recalculation loads all participants and official results, calls the pure calculator, allocates snapshot version, and bulk-creates rows.

Accept player result submissions only while the competition is `IN_PROGRESS`. Completion remains the explicit manager lifecycle action from Task 5 and checks that every published match has an official result.

- [ ] **Step 6: Add player, manager, and public routes**

Player result routes match the spec and use ownership checks. Manager result route is nested under `/v1/admin/competitions/:id/matches/:matchId/results` for scoped authorization. Public standings returns the latest snapshot or an empty version-0 response before the first official result.

Expose the exact routes:

```text
POST /v1/matches/:id/results
POST /v1/matches/:id/results/:version/confirm
POST /v1/matches/:id/results/:version/reject
POST /v1/admin/competitions/:id/matches/:matchId/results
GET  /v1/competitions/:id/standings
```

- [ ] **Step 7: Run GREEN and commit**

```bash
pnpm --filter @efm/api test -- standings.spec.ts results.service.spec.ts standings.service.spec.ts competitions.e2e-spec.ts --runInBand
pnpm --filter @efm/api typecheck
git add apps/api/src/competitions apps/api/test/competitions.e2e-spec.ts
git commit -m "feat(api): version results and standings"
```

### Task 9: Expose player dashboards and complete the API loop

**Files:**
- Create: `apps/api/src/competitions/my-competitions.service.ts`
- Create: `apps/api/src/competitions/my-competitions.service.spec.ts`
- Create: `apps/api/src/competitions/my-competitions.controller.ts`
- Modify: `apps/api/src/competitions/competitions.module.ts`
- Modify: `apps/api/test/competitions.e2e-spec.ts`

**Interfaces:**
- Produces `GET /v1/me/competitions` and `GET /v1/me/matches` with stable cursor pagination.
- Completes the API needed by mini-program Tasks 10 and 11.

- [ ] **Step 1: Write RED query tests**

Assert my competitions contains pending/rejected/approved registration state without exposing another user's application. My matches includes only matches for admitted participants, separates action states `SUBMIT`, `CONFIRM`, `WAIT`, and `DONE`, and orders upcoming planned matches before unplanned matches and completed matches. Cursor pages do not duplicate IDs.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @efm/api test -- my-competitions.service.spec.ts --runInBand
```

Expected: service and routes are missing.

- [ ] **Step 3: Implement snapshot-based response mapping**

Query registrations and participants by current user, include competition summary, current rule version, and next match summary. Query matches through `homeParticipant`/`awayParticipant`, include latest proposed result only when the user is entitled to act on it, and calculate `action` without exposing private opponent metadata.

- [ ] **Step 4: Run API loop GREEN and commit**

```bash
pnpm --filter @efm/api test -- my-competitions.service.spec.ts competitions.e2e-spec.ts --runInBand
pnpm --filter @efm/api test:e2e
pnpm --filter @efm/api typecheck
git add apps/api/src/competitions apps/api/test/competitions.e2e-spec.ts
git commit -m "feat(api): expose player competition dashboard"
```

### Task 10: Build competition browsing, detail, and registration in the mini-program

**Files:**
- Create: `apps/miniprogram/miniprogram/services/competitions.ts`
- Create: `apps/miniprogram/miniprogram/pages/competitions/competitions.viewmodel.ts`
- Create: `apps/miniprogram/miniprogram/pages/competitions/competitions.viewmodel.spec.ts`
- Create: `apps/miniprogram/miniprogram/pages/competitions/index.ts`
- Create: `apps/miniprogram/miniprogram/pages/competitions/index.wxml`
- Create: `apps/miniprogram/miniprogram/pages/competitions/index.wxss`
- Create: `apps/miniprogram/miniprogram/pages/competitions/index.json`
- Create: `apps/miniprogram/miniprogram/pages/competition-detail/detail.viewmodel.ts`
- Create: `apps/miniprogram/miniprogram/pages/competition-detail/detail.viewmodel.spec.ts`
- Create: `apps/miniprogram/miniprogram/pages/competition-detail/index.ts`
- Create: `apps/miniprogram/miniprogram/pages/competition-detail/index.wxml`
- Create: `apps/miniprogram/miniprogram/pages/competition-detail/index.wxss`
- Create: `apps/miniprogram/miniprogram/pages/competition-detail/index.json`
- Create: `apps/miniprogram/miniprogram/assets/icons/competition.png`
- Create: `apps/miniprogram/miniprogram/assets/icons/competition-active.png`
- Modify: `apps/miniprogram/miniprogram/app.json`
- Modify: `apps/miniprogram/miniprogram/services/api.ts`

**Interfaces:**
- Consumes competition contracts and public/player endpoints.
- Produces the `赛事` tab, list pagination, detail tabs, eligible-account selection, registration, withdrawal, and actionable Chinese errors.

- [ ] **Step 1: Write RED view-model tests**

Pin lifecycle labels, UTC-to-local formatting, list pagination deduplication, registration eligibility, account filtering by exact platform/region, standings empty state, and error-code mapping. Include `VERSION_CONFLICT`, `REGISTRATION_CLOSED`, `REGISTRATION_FULL`, `GAME_ACCOUNT_INELIGIBLE`, and `NETWORK_ERROR`.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @efm/miniprogram test -- competitions.viewmodel.spec.ts detail.viewmodel.spec.ts
```

Expected: view-model modules are missing.

- [ ] **Step 3: Add API header support and competition client**

Extend `ApiRequestOptions` with `headers?: Record<string, string>` and merge headers after content type and authorization. `competitions.ts` generates a per-user-action idempotency key from timestamp plus random bytes, sends it as `Idempotency-Key`, and exposes typed methods for list, detail, register, withdraw, matches, and standings.

- [ ] **Step 4: Implement the list and detail pages**

Add `pages/competitions/index` as the middle tab. Cards show lifecycle, platform/region, registration deadline, and admitted count. When authenticated, the page also loads `/me/competitions` and merges registration state by competition ID without making the public endpoint user-dependent. Detail uses sections for overview, rules, schedule, and standings; registration opens a picker populated from `/me/game-accounts` and disables ineligible accounts with a reason.

Use the established dark tactical-board visual language, safe-area padding, explicit loading/empty/error states, and no unsupported CSS or browser DOM APIs. Produce 81×81 normal and selected trophy icons consistent with the existing monochrome tab icons.

- [ ] **Step 5: Run GREEN and compile checks**

```bash
pnpm --filter @efm/miniprogram test
pnpm --filter @efm/miniprogram typecheck
```

Expected: all mini-program tests and TypeScript checks pass.

- [ ] **Step 6: Commit**

```bash
git add apps/miniprogram/miniprogram packages/contracts
git commit -m "feat(miniprogram): browse and join competitions"
```

### Task 11: Build match actions and scoped manager workflows in the mini-program

**Files:**
- Create: `apps/miniprogram/miniprogram/pages/my-matches/matches.viewmodel.ts`
- Create: `apps/miniprogram/miniprogram/pages/my-matches/matches.viewmodel.spec.ts`
- Create: `apps/miniprogram/miniprogram/pages/my-matches/index.ts`
- Create: `apps/miniprogram/miniprogram/pages/my-matches/index.wxml`
- Create: `apps/miniprogram/miniprogram/pages/my-matches/index.wxss`
- Create: `apps/miniprogram/miniprogram/pages/my-matches/index.json`
- Create: `apps/miniprogram/miniprogram/pages/match-result/result.viewmodel.ts`
- Create: `apps/miniprogram/miniprogram/pages/match-result/result.viewmodel.spec.ts`
- Create: `apps/miniprogram/miniprogram/pages/match-result/index.ts`
- Create: `apps/miniprogram/miniprogram/pages/match-result/index.wxml`
- Create: `apps/miniprogram/miniprogram/pages/match-result/index.wxss`
- Create: `apps/miniprogram/miniprogram/pages/match-result/index.json`
- Create: `apps/miniprogram/miniprogram/pages/competition-manage/index.ts`
- Create: `apps/miniprogram/miniprogram/pages/competition-manage/index.wxml`
- Create: `apps/miniprogram/miniprogram/pages/competition-manage/index.wxss`
- Create: `apps/miniprogram/miniprogram/pages/competition-manage/index.json`
- Create: `apps/miniprogram/miniprogram/pages/competition-editor/index.ts`
- Create: `apps/miniprogram/miniprogram/pages/competition-editor/editor.viewmodel.ts`
- Create: `apps/miniprogram/miniprogram/pages/competition-editor/editor.viewmodel.spec.ts`
- Create: `apps/miniprogram/miniprogram/pages/competition-editor/index.wxml`
- Create: `apps/miniprogram/miniprogram/pages/competition-editor/index.wxss`
- Create: `apps/miniprogram/miniprogram/pages/competition-editor/index.json`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.wxml`
- Modify: `apps/miniprogram/miniprogram/app.json`
- Modify: `apps/miniprogram/miniprogram/services/competitions.ts`

**Interfaces:**
- Consumes player dashboard, result, and scoped-manager endpoints.
- Produces score submit/confirm/reject, my matches, create/edit competition, registration review, schedule preview/publish, and manager result correction.

- [ ] **Step 1: Write RED match-action tests**

Test score fields accept integers `0..99`, prevent self-confirm UI, map `SUBMIT`/`CONFIRM`/`WAIT`/`DONE` to one primary action, preserve entered values after a network error, and reload on `VERSION_CONFLICT` rather than resubmitting silently.

- [ ] **Step 2: Write RED manager-form tests**

Test timeline validation, immutable fields after registration opens, review decision reason requirements, schedule round grouping, and confirmation prompts for schedule publication and official-result correction.

- [ ] **Step 3: Run RED**

```bash
pnpm --filter @efm/miniprogram test -- matches.viewmodel.spec.ts result.viewmodel.spec.ts editor.viewmodel.spec.ts
```

Expected: pages and view models are missing.

- [ ] **Step 4: Implement player match flows**

Expose “我的比赛” from the profile page and competition detail. Result submission uses a fresh idempotency key only when the user initiates a new action; automatic retry reuses the same key. Confirmation and rejection send the displayed proposal version and match expected version. On conflict, reload the match and show “比赛结果已被更新，请重新确认”.

- [ ] **Step 5: Implement scoped manager flows**

Show the management entry only when detail response capabilities include manager actions. The editor supports first-release values only. The review page handles pending applications. Schedule preview groups matches by round and requires explicit confirmation before publication. Manager correction requires a reason when an official result exists.

- [ ] **Step 6: Run GREEN and commit**

```bash
pnpm --filter @efm/miniprogram test
pnpm --filter @efm/miniprogram typecheck
git add apps/miniprogram/miniprogram
git commit -m "feat(miniprogram): operate individual competitions"
```

### Task 12: Add deterministic local acceptance data, documentation, and full verification

**Files:**
- Create: `apps/api/src/competitions/competition-demo.cli.ts`
- Create: `apps/api/src/competitions/competition-demo.cli.spec.ts`
- Modify: `apps/api/src/auth/fake-wechat.gateway.ts`
- Modify: `apps/api/src/auth/wechat.gateway.spec.ts`
- Modify: `apps/api/src/config/env.schema.ts`
- Modify: `apps/api/src/config/configuration.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json`
- Modify: `.env.example`
- Create: `docs/development/competition-loop.md`
- Modify: `docs/development/local-development.md`

**Interfaces:**
- Produces `pnpm competition:demo --actor <platform-admin-uuid>` to idempotently create four local players, matching game accounts, one competition, approved registrations, and a published six-match schedule.
- Produces a documented manual path for submitting scores and observing standings.

- [ ] **Step 1: Write the RED CLI parser and idempotency tests**

Assert missing/invalid actor returns `COMPETITION_DEMO_ACTOR_REQUIRED`. Running the demo twice returns the same competition ID, four participants, three rounds, and six matches without duplicate users or accounts. The command must refuse to run when `NODE_ENV=production` with `COMPETITION_DEMO_DISABLED`. Extend the fake WeChat gateway test so an arbitrary simulator code maps to configured `DEV_WECHAT_OPEN_ID` only in fake mode, while explicit `test-code-*` values keep their deterministic identities.

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @efm/api test -- competition-demo.cli.spec.ts --runInBand
```

Expected: demo CLI does not exist.

- [ ] **Step 3: Implement the local-only demo command and scripts**

Build the Nest application context, resolve the existing platform admin, upsert four `test-openid-competition-demo-*` users and matching MOBILE/GLOBAL accounts, then call the real lifecycle, registration, and schedule services with stable idempotency keys. Give demo user 1 the competition-scoped `EVENT_MANAGER` role, publish the schedule, and invoke the real start transition so matches are ready for score entry. Do not insert domain rows directly except test identities and the scoped demo-manager binding. Add root and API package scripts.

Add optional `DEV_WECHAT_OPEN_ID` configuration used only by `FakeWechatGateway`. When set to `test-openid-competition-demo-1`, a real `wx.login()` code from the local simulator signs into demo user 1; `WechatHttpGateway` must ignore this setting. Document that production must use `WECHAT_GATEWAY_MODE=http` and leave this value unset.

- [ ] **Step 4: Document local verification**

`competition-loop.md` must include Docker/MySQL prerequisites, obtaining the platform admin UUID, setting `DEV_WECHAT_OPEN_ID=test-openid-competition-demo-1`, running the demo, starting the API, importing `apps/miniprogram`, disabling local domain validation, four-player acceptance steps, expected six-match/three-round counts, using explicit `test-code-competition-demo-2` through `-4` via API tests for opponent actions, and cleanup limited to demo-prefixed identities. Link it from `local-development.md`.

- [ ] **Step 5: Run focused acceptance and inspect persisted invariants**

Run:

```bash
pnpm competition:demo --actor "$EFM_LOCAL_ACTOR_ID"
pnpm competition:demo --actor "$EFM_LOCAL_ACTOR_ID"
```

Query the demo competition and assert one competition, one published stage, four participants, six matches, and no duplicate pairing keys. Use the API to submit and confirm at least one score; assert standings snapshot version `1` and four rows.

- [ ] **Step 6: Run the full release gate**

```bash
pnpm db:status
pnpm verify
git diff --check
git status --short
```

Expected: database is up to date; lint, typecheck, all unit tests, all e2e tests, and all builds pass; only intended plan-led changes exist.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/competitions apps/api/package.json package.json docs/development
git commit -m "docs: verify individual competition loop"
```
