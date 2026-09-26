# League Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first usable league-season slice: long-lived leagues and team profiles, season creation, new applications, renewal confirmation, review, immutable entry snapshots, scoped authorization, and Native mini-program verification flows.

**Architecture:** Add a new `LeaguesModule` beside the existing `CompetitionsModule`. `League` owns defaults, `LeagueSeason` snapshots the effective defaults, and `SeasonEntry` is the only source of formal season eligibility. Existing competitions remain untouched in this phase; phase 2 will add nullable season linkage and stages. Services follow the existing Zod-contract, NestJS, Prisma transaction, idempotency receipt, optimistic version, view-model, and Native page patterns.

**Tech Stack:** TypeScript 5.9, Zod 4, NestJS 12, Prisma 7/MySQL 8, Jest/Supertest, Native WeChat Mini Program, Vitest, pnpm 11, Node 24.

**Spec:** [联赛、赛季、分组与杯赛体系设计](../specs/2026-09-26-league-season-pyramid-design.zh-CN.md)

## Global Constraints

- Preserve all existing Competition routes, records, result versions, standings, and mini-program pages.
- Do not add `Competition.seasonId` yet; phase 2 owns competition migration.
- Use one `TeamProfile` per user for phase 1, while keeping the schema ready for a future membership table.
- Store team/game identity snapshots on every `SeasonEntry`; never render historical entries from mutable profile fields.
- Treat renewal candidates and new applications differently: renewal starts as `INVITED`, user confirmation makes it `APPROVED`; a new application starts as `PENDING` and requires manager review.
- Every non-GET state mutation must use `Idempotency-Key`, an `expectedVersion` where an existing aggregate changes, and an auditable history row.
- League defaults are copied into each season. Editing league defaults must not alter existing seasons.
- In phase 1 only `DRAFT`, `REGISTRATION_OPEN`, `ALLOCATION_REVIEW`, and `CANCELLED` transitions are exposed. `READY`, `IN_PROGRESS`, and `COMPLETED` are modeled now but exposed in later phases.
- A platform binding can manage all resources. League bindings authorize the league and its seasons; season bindings authorize only that season. Competition scope remains unchanged.
- Do not implement allocation, promotion, schedules, standings, cups, assets, finance, valuation, salary cap, or favorites in this plan.
- All user-facing mini-program copy is Chinese. Domain/API identifiers remain English.

## Review Focus

- Renewal invitation generation is idempotent and cannot create duplicate entries.
- `SeasonEntry` snapshots cannot drift when TeamProfile or GameAccount changes.
- Scope inheritance cannot authorize a manager into an unrelated league or season.
- Registration closing and manager review are transactionally consistent under concurrent requests.
- Optimistic version conflicts return `VERSION_CONFLICT`, not silent last-write-wins updates.
- Existing Competition tests and routes remain green.

---

## Task 1: Define shared league contracts

**Files:**

- Create: `packages/contracts/src/league.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`

### Contract surface

Export the following Zod schemas and inferred types:

```ts
LeagueStatusSchema = z.enum(['ACTIVE', 'ARCHIVED'])
LeagueSeasonStatusSchema = z.enum([
  'DRAFT', 'REGISTRATION_OPEN', 'ALLOCATION_REVIEW',
  'READY', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'
])
SeasonEntrySourceSchema = z.enum(['NEW_APPLICATION', 'RENEWAL'])
SeasonEntryStatusSchema = z.enum(['INVITED', 'PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'])

CreateTeamProfileRequestSchema
UpdateTeamProfileRequestSchema // includes expectedVersion
TeamProfileSchema

CreateLeagueRequestSchema
UpdateLeagueRequestSchema // partial fields + expectedVersion
LeagueSummarySchema
LeagueDetailSchema
LeagueListQuerySchema
LeagueListResponseSchema

CreateLeagueSeasonRequestSchema
UpdateLeagueSeasonRequestSchema // editable only in DRAFT + expectedVersion
LeagueSeasonSummarySchema
LeagueSeasonDetailSchema
SeasonTransitionRequestSchema // expectedVersion; cancel also requires reason

CreateSeasonApplicationRequestSchema // gameAccountId
ConfirmSeasonRenewalRequestSchema // gameAccountId + expectedVersion
ReviewSeasonEntryRequestSchema // APPROVE/REJECT + expectedVersion + optional reason
WithdrawSeasonEntryRequestSchema // expectedVersion
SeasonEntrySchema
```

Required validation invariants:

- League name 1–64, short name 1–24, description at most 500, logo URL nullable.
- Default Super capacity 2–64, Champion capacity 2–64, exchange count 0–32.
- Season dates satisfy `registrationOpensAt < registrationClosesAt < startsAt < endsAt`.
- Season number is positive; display name 1–64.
- Team name 1–64, short name 1–24, logo URL nullable.
- `defaultGameAccountId` and all IDs use `ResourceIdSchema`.
- List queries use opaque cursor and bounded limit 1–100.

- [ ] Write contract tests first for valid parsing, invalid timeline, capacity bounds, nullable logo, and update version requirement.

Run:

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
pnpm --filter @efm/contracts test -- --runInBand
```

Expected: FAIL because `league.ts` exports do not exist.

- [ ] Implement the schemas/types in `league.ts`, re-export them from `index.ts`, and keep input/output types distinct where Zod defaults apply.
- [ ] Run the contract test again and confirm PASS.
- [ ] Run `pnpm --filter @efm/contracts typecheck`.
- [ ] Commit:

```bash
git add packages/contracts/src/league.ts packages/contracts/src/index.ts packages/contracts/src/contracts.spec.ts
git commit -m "feat(contracts): define league season contracts"
```

## Task 2: Add the persistent league foundation

**Files:**

- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_league_foundation/migration.sql`
- Modify: `apps/api/prisma/seed.ts`
- Modify: `apps/api/src/authorization/authorization.service.spec.ts`

### Prisma additions

Add enums:

```prisma
enum LeagueStatus { ACTIVE ARCHIVED }
enum TeamProfileStatus { ACTIVE ARCHIVED }
enum LeagueSeasonStatus {
  DRAFT REGISTRATION_OPEN ALLOCATION_REVIEW READY IN_PROGRESS COMPLETED CANCELLED
}
enum SeasonEntrySource { NEW_APPLICATION RENEWAL }
enum SeasonEntryStatus { INVITED PENDING APPROVED REJECTED WITHDRAWN }
```

Extend `ScopeType` with `LEAGUE` and `SEASON`.

Add models with explicit snake_case mappings:

```text
League
  id, name, shortName, description?, logoUrl?, status
  defaultPlatform, defaultServerRegion
  defaultSuperCapacity=23, defaultChampionCapacity=18
  defaultPromotionCount=4
  createdById, version=1, createdAt, updatedAt

TeamProfile
  id, ownerUserId(unique), name, shortName, logoUrl?
  defaultGameAccountId?, status, version=1, createdAt, updatedAt

LeagueSeason
  id, leagueId, seasonNumber, displayName, previousSeasonId?
  isFirstSeason
  registrationOpensAt, registrationClosesAt, startsAt, endsAt
  superCapacity, championCapacity, promotionCount
  status, cancellationReason?, version=1, createdById, createdAt, updatedAt

SeasonEntry
  id, seasonId, teamProfileId, ownerUserId, gameAccountId
  source, status, previousSeasonEntryId?
  teamNameSnapshot, teamShortNameSnapshot, teamLogoUrlSnapshot?
  gamePlatformSnapshot, serverRegionSnapshot, gamerTagSnapshot, gameUidSnapshot?
  reviewedById?, reviewedAt?, decisionReason?
  confirmedAt?, withdrawnAt?, version=1, createdAt, updatedAt

SeasonEntryStatusHistory
  id, seasonEntryId, fromStatus?, toStatus, actorId
  reason?, createdAt

LeagueSeasonStatusHistory
  id, seasonId, fromStatus?, toStatus, actorId
  reason?, createdAt
```

Database constraints/indexes:

- `LeagueSeason @@unique([leagueId, seasonNumber])`.
- `SeasonEntry @@unique([seasonId, teamProfileId])`.
- indexes for season status/timeline, entry status/source, owner lookup, and previous season linkage.
- `TeamProfile.ownerUserId` unique.
- `TeamProfile.defaultGameAccountId` uses `onDelete: SetNull`.
- Historical snapshots are plain columns and are not foreign-key dependent except the selected account ID retained for eligibility checks.
- Add user relations with explicit relation names to avoid Prisma ambiguity.
- Do not add a Prisma-invisible generated column. Enforce at most one `IN_PROGRESS` season by locking the parent League row and checking for an existing in-progress sibling inside the future phase-2 start transaction; add an index on `(leagueId, status)` now and a schema comment documenting the invariant.

Roles/permissions:

```text
LEAGUE_MANAGER
SEASON_MANAGER

league.create
league.manage
season.manage
season.registration.review
```

Grant platform admin all four; grant League Manager the last three; grant Season Manager the last two.

- [ ] Extend authorization tests first to compile against `LEAGUE` and `SEASON`; add negative cross-league/cross-season cases.
- [ ] Run `pnpm --filter @efm/api test -- authorization.service.spec.ts` and confirm RED before schema generation.
- [ ] Add the Prisma enums/models/relations and seed data.
- [ ] Generate a migration with `pnpm db:migrate:dev -- --name league_foundation`; inspect the SQL before applying it to ensure no existing Competition tables are dropped or rewritten.
- [ ] Run `pnpm db:generate`, the authorization test, and `pnpm db:status`.
- [ ] Commit:

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/prisma/seed.ts apps/api/src/authorization/authorization.service.spec.ts
git commit -m "feat(api): add league foundation schema"
```

## Task 3: Implement scope inheritance and league domain errors

**Files:**

- Modify: `apps/api/src/authorization/authorization.service.ts`
- Modify: `apps/api/src/authorization/authorization.service.spec.ts`
- Modify: `apps/api/src/common/auth/scope.guard.ts`
- Create: `apps/api/src/authorization/resource-scope.service.ts`
- Create: `apps/api/src/authorization/resource-scope.service.spec.ts`
- Modify: `apps/api/src/authorization/authorization.module.ts`
- Create: `apps/api/src/leagues/league.errors.ts`
- Create: `apps/api/src/leagues/league.types.ts`
- Create: `apps/api/src/leagues/domain/season-state.ts`
- Create: `apps/api/src/leagues/domain/season-state.spec.ts`

### Authorization behavior

Change `AuthorizationService.can` so it can evaluate a resource ancestry supplied by the caller:

```ts
type AuthorizationTarget = {
  exact: AuthorizationScope;
  ancestors?: AuthorizationScope[];
};

can(userId: string, permission: string, target?: AuthorizationTarget): Promise<boolean>
```

Allowed when a matching permission binding is:

- `PLATFORM`; or
- the exact resource; or
- one of the supplied ancestors.

Do not infer hierarchy from arbitrary IDs in `AuthorizationService`. Controllers/services resolving a season must supply its league ancestor. Keep the existing `can(userId, permission, { type, id })` callers source-compatible by accepting an overload or normalize both shapes internally.

Because the current decorator only reads a route parameter, add a resource resolver for hierarchical resources:

```ts
export class ResourceScopeService {
  resolve(type: ScopeType, id: string): Promise<AuthorizationTarget>;
}
```

`ResourceScopeService` injects Prisma and resolves `SEASON id → SEASON exact + parent LEAGUE`; all flat types return only the exact target. `ScopeGuard` calls it before `AuthorizationService.can`. A missing season returns no target and therefore a normal forbidden/not-found-safe response; it must not accidentally become an unscoped permission check. Existing Competition guard behavior remains unchanged.

### Domain behavior

`LeagueError` mirrors `CompetitionError` and exposes stable code/message/status.

`season-state.ts` exports:

```ts
assertSeasonTransition(current, target): void
isRegistrationMutable(status): boolean
```

Phase-1 allowed transitions:

```text
DRAFT -> REGISTRATION_OPEN | CANCELLED
REGISTRATION_OPEN -> ALLOCATION_REVIEW | CANCELLED
ALLOCATION_REVIEW -> CANCELLED
```

Model but reject `READY`, `IN_PROGRESS`, and `COMPLETED` until their phase owns the required invariants.

- [ ] Write failing tests for platform, exact league, league-ancestor-to-season, exact season, and unrelated league denial.
- [ ] Write failing state tests for all allowed and rejected transitions.
- [ ] Implement minimal authorization normalization, `ResourceScopeService`, guard integration, and domain errors/state helpers.
- [ ] Run both focused specs and confirm PASS.
- [ ] Commit:

```bash
git add apps/api/src/authorization apps/api/src/common/auth apps/api/src/leagues
git commit -m "feat(api): authorize league and season scopes"
```

## Task 4: Build TeamProfile API with immutable ownership

**Files:**

- Create: `apps/api/src/leagues/team-profiles.controller.ts`
- Create: `apps/api/src/leagues/team-profiles.service.ts`
- Create: `apps/api/src/leagues/team-profiles.service.spec.ts`
- Create: `apps/api/src/leagues/leagues.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/users/game-account-usage.port.ts`
- Modify: `apps/api/src/competitions/registration-usage.adapter.ts`

### Endpoints

```text
GET   /v1/me/team-profile
POST  /v1/me/team-profile
PATCH /v1/me/team-profile
```

Behavior:

- GET returns `null` when none exists.
- POST rejects a second profile with `TEAM_PROFILE_ALREADY_EXISTS`.
- Default game account must belong to the current user.
- PATCH uses `expectedVersion` and update-many compare-and-swap.
- Ownership cannot be transferred.
- Deleting a TeamProfile is not supported because historical season entries may reference it.
- Extend game-account usage checks so an account selected by TeamProfile or active SeasonEntry cannot be deleted.

- [ ] Write service tests first for create/get/update, duplicate creation, foreign account, stale version, and account-in-use.
- [ ] Run `pnpm --filter @efm/api test -- team-profiles.service.spec.ts` and confirm RED.
- [ ] Implement service/controller/module wiring and the usage adapter extension.
- [ ] Run the focused tests and existing `game-accounts.service` tests.
- [ ] Commit:

```bash
git add apps/api/src/leagues apps/api/src/app.module.ts apps/api/src/users apps/api/src/competitions/registration-usage.adapter.ts
git commit -m "feat(api): add persistent team profiles"
```

## Task 5: Build League CRUD and manager binding

**Files:**

- Create: `apps/api/src/leagues/public-leagues.controller.ts`
- Create: `apps/api/src/leagues/admin-leagues.controller.ts`
- Create: `apps/api/src/leagues/leagues.service.ts`
- Create: `apps/api/src/leagues/leagues.service.spec.ts`
- Modify: `apps/api/src/leagues/leagues.module.ts`

### Endpoints

```text
GET   /v1/leagues
GET   /v1/leagues/:leagueId
GET   /v1/admin/leagues/:leagueId
POST  /v1/admin/leagues
PATCH /v1/admin/leagues/:leagueId
```

Behavior:

- Public list returns active leagues with current/next season summaries when present.
- Creation requires `league.create`, creates the League and a `LEAGUE_MANAGER` binding in one idempotent transaction.
- Update requires `league.manage` at the League scope and `expectedVersion`.
- Defaults are editable but existing season snapshots do not change.
- Archive is an explicit versioned action or status update and cannot hide historical detail by ID.
- Use `MutationReceiptService` with operation keys `league.create` and `league.update:<id>`.
- Add cursor helpers locally; do not couple league pagination to Competition cursors.

- [ ] Write service tests for defaults (23/18/4), idempotent replay, manager binding, and stale updates.
- [ ] Run focused tests and confirm RED.
- [ ] Implement services/controllers and wire `LeaguesModule` imports/providers.
- [ ] Run focused tests and `pnpm --filter @efm/api typecheck`.
- [ ] Commit:

```bash
git add apps/api/src/leagues
git commit -m "feat(api): add league management"
```

## Task 6: Create seasons and registration-state transitions

**Files:**

- Create: `apps/api/src/leagues/seasons.controller.ts`
- Create: `apps/api/src/leagues/seasons.service.ts`
- Create: `apps/api/src/leagues/seasons.service.spec.ts`
- Modify: `apps/api/src/leagues/leagues.module.ts`

### Endpoints

```text
GET   /v1/leagues/:leagueId/seasons
GET   /v1/seasons/:seasonId
POST  /v1/admin/leagues/:leagueId/seasons
PATCH /v1/admin/seasons/:seasonId
POST  /v1/admin/seasons/:seasonId/open-registration
POST  /v1/admin/seasons/:seasonId/close-registration
POST  /v1/admin/seasons/:seasonId/cancel
```

Creation rules:

- `seasonNumber` must be the next positive number for the league; reject gaps and duplicates.
- Season 1 has `isFirstSeason=true` and no previous season.
- Later seasons reference the immediately previous season.
- Copy league capacities/promotion count unless request overrides them.
- Editing core dates/capacities is allowed only in `DRAFT`.
- Opening registration changes status and generates renewal invitations in the same transaction.
- Closing registration locks applications and changes to `ALLOCATION_REVIEW`.
- Cancellation requires a non-empty reason.
- Every transition uses row locking plus optimistic version comparison.
- Every transition writes `LeagueSeasonStatusHistory` in the same transaction.

Renewal invitation preparation on open:

1. Read `APPROVED` entries from the previous season.
2. Create one `INVITED/RENEWAL` entry per team using the new season uniqueness key.
3. Save a fresh profile/game identity snapshot at invitation time.
4. Use `createMany(..., skipDuplicates: true)` or guarded upserts so retry/replay is safe.
5. Add an `INVITED` history row only for entries actually created.

- [ ] Write failing tests for first/later season, inherited/overridden defaults, sequence gap, invalid timeline, immutable fields after opening, historical snapshot stability after League defaults change, allowed transitions, transition history, cancellation reason, and idempotent invitation generation.
- [ ] Run focused tests and confirm RED.
- [ ] Implement the transaction boundaries and endpoints.
- [ ] Run focused tests and confirm PASS.
- [ ] Commit:

```bash
git add apps/api/src/leagues
git commit -m "feat(api): add league season lifecycle"
```

## Task 7: Implement application, renewal, withdrawal, and review

**Files:**

- Create: `apps/api/src/leagues/season-entries.controller.ts`
- Create: `apps/api/src/leagues/admin-season-entries.controller.ts`
- Create: `apps/api/src/leagues/season-entries.service.ts`
- Create: `apps/api/src/leagues/season-entries.service.spec.ts`
- Modify: `apps/api/src/leagues/leagues.module.ts`

### Player endpoints

```text
GET    /v1/seasons/:seasonId/entries/me
POST   /v1/seasons/:seasonId/applications
POST   /v1/seasons/:seasonId/renewal/confirm
DELETE /v1/seasons/:seasonId/entries/me
```

### Manager endpoints

```text
GET  /v1/admin/seasons/:seasonId/entries?status=&source=
POST /v1/admin/seasons/:seasonId/entries/:entryId/approve
POST /v1/admin/seasons/:seasonId/entries/:entryId/reject
POST /v1/admin/seasons/:seasonId/entries/:entryId/override
```

State rules:

```text
new application: absent -> PENDING
manager approval: PENDING -> APPROVED
manager rejection: PENDING -> REJECTED
renewal confirmation: INVITED -> APPROVED
player withdrawal: INVITED|PENDING|APPROVED -> WITHDRAWN (registration open only)
manager override: any non-final application state -> target, reason required
```

Snapshot/eligibility rules:

- User must have a TeamProfile and own the selected GameAccount.
- Account platform and server region must match the League defaults.
- On application/confirmation copy TeamProfile and GameAccount fields into the entry in one transaction.
- Confirmation refreshes an invitation snapshot before approval, so a user can correct their profile/account before confirming.
- Later TeamProfile/GameAccount edits never update SeasonEntry snapshots.
- New application cannot reuse an existing renewal invitation; the UI must show the renewal action instead.
- Player mutations require season status `REGISTRATION_OPEN` and current time inside the registration window.
- Manager review is permitted until `ALLOCATION_REVIEW`, but every override after close needs a reason.
- Each status change writes `SeasonEntryStatusHistory` with actor/from/to/reason.

- [ ] Write failing tests for application, renewal confirmation, snapshot immutability, platform mismatch, duplicate entry, post-close mutation, withdrawal, review, manager override reason, idempotent replay, and stale version.
- [ ] Run focused tests and confirm RED.
- [ ] Implement the service/controllers with mutation receipts and row locks.
- [ ] Run focused tests and confirm PASS.
- [ ] Commit:

```bash
git add apps/api/src/leagues
git commit -m "feat(api): add season entry workflow"
```

## Task 8: Prove the complete API slice end to end

**Files:**

- Create: `apps/api/test/leagues.e2e-spec.ts`
- Modify: `apps/api/test/test-app.ts` only if test wiring requires it

Create three authenticated users: platform admin, league/season manager, and player. Exercise these scenarios through HTTP:

1. Admin creates a league; creator receives a League Manager binding.
2. Player creates a game account and TeamProfile.
3. Manager creates season 1, opens registration, and player applies.
4. Manager sees the queue and approves the application.
5. Profile is edited; season 1 snapshot stays unchanged.
6. Manager closes season 1 registration.
7. Seed or transition season 1 to a completed fixture state only inside test setup; create season 2.
8. Opening season 2 creates an `INVITED` renewal row.
9. Player confirms renewal with a selected account; entry becomes `APPROVED` with a season 2 snapshot.
10. Unrelated League Manager cannot read/manage either season.
11. Closing registration blocks player mutations.
12. Reusing an idempotency key replays the same response; stale versions return 409.

Cleanup order must delete history → entries → seasons → league bindings → leagues → profiles/accounts/users/receipts.

- [ ] Write the e2e file and run it before completing any missing code:

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
pnpm --filter @efm/api test:e2e -- leagues.e2e-spec.ts
```

Expected: RED until all route and authorization details agree.

- [ ] Make only the minimum API corrections required by the e2e test.
- [ ] Re-run the new e2e spec and the existing `competitions.e2e-spec.ts`.
- [ ] Commit:

```bash
git add apps/api/test apps/api/src/leagues apps/api/src/authorization
git commit -m "test(api): cover league foundation lifecycle"
```

## Task 9: Add mini-program league and team-profile clients

**Files:**

- Create: `apps/miniprogram/miniprogram/services/leagues.ts`
- Create: `apps/miniprogram/miniprogram/pages/team-profile/team-profile.viewmodel.ts`
- Create: `apps/miniprogram/miniprogram/pages/team-profile/team-profile.viewmodel.spec.ts`
- Create: `apps/miniprogram/miniprogram/pages/team-profile/index.ts`
- Create: `apps/miniprogram/miniprogram/pages/team-profile/index.json`
- Create: `apps/miniprogram/miniprogram/pages/team-profile/index.wxml`
- Create: `apps/miniprogram/miniprogram/pages/team-profile/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.wxml`
- Modify: `apps/miniprogram/miniprogram/app.json`

### Client API

Expose typed methods for league list/detail, season list/detail, my entry, apply, confirm renewal, withdraw, TeamProfile get/create/update, and manager endpoints used in Task 11. Reuse the action-key generator pattern, but move it into a shared utility if duplication exceeds two services.

### TeamProfile page

- Load TeamProfile and GameAccounts in parallel.
- Support create and edit in one page.
- Require name, short name, and one owned default game account.
- Preview logo URL and allow null.
- Show localized API errors for duplicate profile, foreign account, and version conflict.
- Add “我的球队” entry to the profile page.

- [ ] Write view-model tests first for validation, account selection, create/edit mode, and error copy.
- [ ] Run `pnpm --filter @efm/miniprogram test -- team-profile.viewmodel.spec.ts` and confirm RED.
- [ ] Implement client, view model, page, styling, and navigation.
- [ ] Run the focused tests and mini-program typecheck.
- [ ] Commit:

```bash
git add apps/miniprogram/miniprogram/services apps/miniprogram/miniprogram/pages/team-profile apps/miniprogram/miniprogram/pages/profile apps/miniprogram/miniprogram/app.json
git commit -m "feat(miniprogram): add team profile management"
```

## Task 10: Add player league, season, application, and renewal UI

**Files:**

- Create: `apps/miniprogram/miniprogram/pages/leagues/leagues.viewmodel.ts`
- Create: `apps/miniprogram/miniprogram/pages/leagues/leagues.viewmodel.spec.ts`
- Create: `apps/miniprogram/miniprogram/pages/leagues/index.ts`
- Create: `apps/miniprogram/miniprogram/pages/leagues/index.json`
- Create: `apps/miniprogram/miniprogram/pages/leagues/index.wxml`
- Create: `apps/miniprogram/miniprogram/pages/leagues/index.wxss`
- Create: `apps/miniprogram/miniprogram/pages/league-detail/detail.viewmodel.ts`
- Create: `apps/miniprogram/miniprogram/pages/league-detail/detail.viewmodel.spec.ts`
- Create: `apps/miniprogram/miniprogram/pages/league-detail/index.ts`
- Create: `apps/miniprogram/miniprogram/pages/league-detail/index.json`
- Create: `apps/miniprogram/miniprogram/pages/league-detail/index.wxml`
- Create: `apps/miniprogram/miniprogram/pages/league-detail/index.wxss`
- Modify: `apps/miniprogram/miniprogram/app.json`

UI behavior:

- Change the middle tab target from `pages/competitions/index` to `pages/leagues/index` and label it “联赛”. Keep the old Competition pages registered and reachable for compatibility/testing.
- League list shows brand, active/upcoming season, platform/region, and registration state.
- League detail has a season selector and a phase-1 summary rather than fake standings.
- If no TeamProfile, CTA routes to TeamProfile creation.
- If entry absent, show “报名参加”; if `INVITED`, show “确认参加下一赛季”; if pending/approved/rejected/withdrawn, show localized status and valid actions.
- Game account selection defaults to TeamProfile default account.
- Pull-to-refresh must recover version conflicts and post-review state.
- Preserve existing dark green visual language and Native components; do not copy third-party assets.

- [ ] Write failing view-model tests for season selection, first-season wording, renewal wording, CTA derivation, and error states.
- [ ] Run focused tests and confirm RED.
- [ ] Implement pages and route registration.
- [ ] Run focused tests, mini-program typecheck, and manually compile in WeChat Developer Tools.
- [ ] Commit:

```bash
git add apps/miniprogram/miniprogram/pages/leagues apps/miniprogram/miniprogram/pages/league-detail apps/miniprogram/miniprogram/app.json
git commit -m "feat(miniprogram): add league season registration"
```

## Task 11: Add the minimal Native manager workflow

**Files:**

- Create: `apps/miniprogram/miniprogram/pages/league-editor/editor.viewmodel.ts`
- Create: `apps/miniprogram/miniprogram/pages/league-editor/editor.viewmodel.spec.ts`
- Create: `apps/miniprogram/miniprogram/pages/league-editor/index.ts`
- Create: `apps/miniprogram/miniprogram/pages/league-editor/index.json`
- Create: `apps/miniprogram/miniprogram/pages/league-editor/index.wxml`
- Create: `apps/miniprogram/miniprogram/pages/league-editor/index.wxss`
- Create: `apps/miniprogram/miniprogram/pages/season-manage/manage.viewmodel.ts`
- Create: `apps/miniprogram/miniprogram/pages/season-manage/manage.viewmodel.spec.ts`
- Create: `apps/miniprogram/miniprogram/pages/season-manage/index.ts`
- Create: `apps/miniprogram/miniprogram/pages/season-manage/index.json`
- Create: `apps/miniprogram/miniprogram/pages/season-manage/index.wxml`
- Create: `apps/miniprogram/miniprogram/pages/season-manage/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.wxml`
- Modify: `apps/miniprogram/miniprogram/app.json`

Manager behavior:

- Create/edit League defaults.
- Create a season with inherited values and optional overrides.
- Open/close registration with confirmation dialogs and version refresh.
- View entry filters for invited, pending, approved, rejected, withdrawn.
- Approve/reject pending entries; rejection requires a reason.
- Show counts for renewal invitations and confirmed/new applicants.
- Do not expose READY/start/complete, grouping, scheduling, or cup actions yet; render a clear “下一阶段：分组确认” terminal card after close.
- Only render management CTAs when API capabilities say the user can manage; never infer authority from local user identity.

- [ ] Write failing view-model tests for inherited defaults, transition CTAs, queue filtering, rejection validation, and version-conflict refresh.
- [ ] Run focused tests and confirm RED.
- [ ] Implement pages and API calls.
- [ ] Run focused tests and mini-program typecheck.
- [ ] Commit:

```bash
git add apps/miniprogram/miniprogram/pages/league-editor apps/miniprogram/miniprogram/pages/season-manage apps/miniprogram/miniprogram/pages/profile apps/miniprogram/miniprogram/app.json
git commit -m "feat(miniprogram): add league registration workspace"
```

## Task 12: Document, verify, and prepare phase-2 handoff

**Files:**

- Modify: `README.md`
- Create: `docs/league-foundation-local-verification.zh-CN.md`
- Modify: `docs/superpowers/plans/2026-09-26-league-season-pyramid-roadmap.md`

Documentation must include:

- Local migration/seed commands.
- How to create a platform admin binding for local verification without exposing secrets.
- WeChat Developer Tools verification path: create TeamProfile → create League → create/open season → apply → approve → close → create next season → confirm renewal.
- Data ownership and snapshot explanation.
- Known phase-1 limits and explicit pointer to phase 2.
- Rollback note: code can be rolled back while additive tables remain; do not drop tables containing user entries.

- [ ] Run focused verification:

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
pnpm --filter @efm/contracts test
pnpm --filter @efm/api test -- leagues
pnpm --filter @efm/api test:e2e -- leagues.e2e-spec.ts
pnpm --filter @efm/miniprogram test
```

- [ ] Run full repository verification:

```bash
pnpm verify
pnpm db:status
git diff --check
```

- [ ] In WeChat Developer Tools, compile and verify both player and manager paths against local API/MySQL. Record any manual-only limitation in the verification document.
- [ ] Update the roadmap phase-1 checkbox/status only after automated and manual checks pass.
- [ ] Commit:

```bash
git add README.md docs
git commit -m "docs: add league foundation verification guide"
```

## Final acceptance checklist

- [ ] A user can create exactly one TeamProfile and bind an owned GameAccount.
- [ ] A manager can create a League and receives correctly scoped authority.
- [ ] Season defaults are snapshotted and later League edits do not mutate history.
- [ ] Season 1 supports new applications and manager review.
- [ ] Season 2 creates renewal invitations and requires explicit player confirmation.
- [ ] Every SeasonEntry keeps stable team and game identity snapshots.
- [ ] Closing registration blocks ordinary application/confirmation/withdrawal.
- [ ] Cross-league and cross-season authorization tests deny access.
- [ ] Idempotency and optimistic concurrency are covered at service and e2e levels.
- [ ] Existing Competition tests, routes, mini pages, matches, and results still pass.
- [ ] `pnpm verify`, `pnpm db:status`, and `git diff --check` pass.
- [ ] No asset, finance, valuation, salary-cap, favorite, allocation, cup, or OCR logic leaked into phase 1.
