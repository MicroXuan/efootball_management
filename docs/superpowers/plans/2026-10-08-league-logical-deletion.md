# League Logical Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manually controlled `leagues.is_deleted` flag so logically deleted leagues and every league-owned page/resource disappear from admin, mini-program, and public APIs without deleting child data.

**Architecture:** Persist the flag only on `League`, keep it out of public contracts, and centralize ancestry checks in a global `LeagueVisibilityService`. Root collections add explicit `isDeleted: false` predicates; direct reads and mutations resolve their league ancestry and return 404 before reading or changing child resources. No Prisma-wide query middleware and no delete/restore UI or endpoint will be added.

**Tech Stack:** MySQL, Prisma 7, NestJS 12, TypeScript, Jest, Supertest, React/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-08-league-logical-deletion-design.zh-CN.md`

## Global Constraints

- Work on the existing `codex/league-center-banner` branch and existing shared database; do not create another branch, worktree, or database.
- Follow strict TDD for every behavior change: add one focused failing test, run it and observe the intended failure, implement the minimum change, then rerun it green.
- `is_deleted` is operational data only. Do not add it to `@efm/contracts`, API response DTOs, admin forms, or mini-program UI.
- A deleted league must look nonexistent: direct and descendant requests return HTTP 404, never 403, and mutation paths must not write audit logs, receipts, ledger rows, or domain rows.
- `League.status` (`ACTIVE`/`ARCHIVED`) remains unchanged and independent from deletion.
- Do not cascade, hard-delete, or mutate seasons, teams, competitions, rosters, finance records, audit logs, or role grants.
- Standalone competitions with no `seasonId` are not league-owned and must remain visible.
- Restoration is only `is_deleted = FALSE`; all hidden data and access must become available again.
- Keep visibility predicates explicit at repository/service boundaries. Do not install Prisma middleware that silently rewrites every query.

## Review Focus

- Verify every API surface used by the platform admin, league admin, mini-program league center, “my teams”, “my competitions”, and direct child-resource URLs.
- Verify the visibility check happens before authorization where necessary so deleted resources consistently produce 404 rather than leaking existence through 403.
- Verify idempotency/mutation-receipt code does not replay a previously successful write after the league is deleted.
- Verify both `TRUE` hiding and `FALSE` restoration against the same unchanged child records.
- Verify no delete button or delete endpoint is introduced.

---

### Task 1: Persist `League.isDeleted` safely

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261008160000_add_league_is_deleted/migration.sql`
- Test: `apps/api/src/leagues/leagues.service.spec.ts`

**Interfaces:**

```prisma
model League {
  isDeleted Boolean @default(false) @map("is_deleted")
}
```

The migration must add `is_deleted BOOLEAN NOT NULL DEFAULT FALSE` and replace the public-list index with an index beginning with `is_deleted` (for example `is_deleted, status, created_at, id`) while preserving the existing mapped index name where MySQL permits it.

- [ ] **RED:** Add a focused service test that creates an ordinary league without specifying `isDeleted` and expects it to remain visible, then marks it deleted through Prisma and expects the public list to omit it.
- [ ] **RUN:** Run `pnpm --filter @efm/api test -- --runInBand apps/api/src/leagues/leagues.service.spec.ts`; confirm the failure is a missing Prisma field/filter rather than fixture setup.
- [ ] **GREEN:** Add the Prisma field and SQL migration. Do not modify existing rows beyond the default backfill performed by the `NOT NULL DEFAULT FALSE` column addition.
- [ ] **RUN:** Run `pnpm db:generate`, `pnpm --filter @efm/api typecheck`, then rerun the focused test and confirm it passes.
- [ ] **VERIFY MIGRATION:** Run `pnpm db:migrate`, then query `SHOW COLUMNS FROM leagues LIKE 'is_deleted';` and confirm the column is non-nullable, boolean-compatible, and defaults to `0`.
- [ ] **COMMIT:** `git add apps/api/prisma/schema.prisma apps/api/prisma/migrations/20261008160000_add_league_is_deleted apps/api/src/leagues/leagues.service.spec.ts && git commit -m "feat: add league logical deletion flag"`

### Task 2: Add one reusable league-visibility boundary

**Files:**
- Create: `apps/api/src/league-visibility/league-visibility.service.ts`
- Create: `apps/api/src/league-visibility/league-visibility.module.ts`
- Create: `apps/api/src/league-visibility/league-visibility.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/admin/admin-scope.guard.ts`
- Modify: `apps/api/src/admin/admin-scope.guard.spec.ts` (create if absent)
- Modify: `apps/api/src/authorization/resource-scope.service.ts`
- Modify: `apps/api/src/authorization/resource-scope.service.spec.ts` (create if absent)
- Modify: `apps/api/src/common/auth/scope.guard.ts`

**Interfaces:**

```ts
type LeagueOwnedResource =
  | { type: 'LEAGUE'; id: string }
  | { type: 'SEASON'; id: string }
  | { type: 'TEAM'; id: string }
  | { type: 'COMPETITION'; id: string }
  | { type: 'STAGE'; id: string }
  | { type: 'MATCH'; id: string }
  | { type: 'TRANSFER_WINDOW'; id: string }
  | { type: 'OWNERSHIP'; id: string };

class LeagueVisibilityService {
  requireVisible(resource: LeagueOwnedResource, client?: Prisma.TransactionClient): Promise<string | null>;
  // Returns the visible league id, or null for a valid standalone resource.
  // Throws NotFoundException for missing resources or resources owned by a deleted league.
}
```

- [ ] **RED:** Unit-test each ancestry path (`LEAGUE`, `SEASON`, `TEAM`, league-linked `COMPETITION`, `STAGE`, `MATCH`, `TRANSFER_WINDOW`, `OWNERSHIP`), a standalone competition, a missing resource, and a deleted parent league. Expect the same 404 payload for missing and deleted resources.
- [ ] **RUN:** Run only `league-visibility.service.spec.ts` and confirm it fails because the service does not exist.
- [ ] **GREEN:** Implement the service with explicit relation-aware Prisma queries and one shared not-found error. Mark its module `@Global()` and import it once in `AppModule` to avoid module cycles.
- [ ] **RUN:** Rerun the service spec and API typecheck.
- [ ] **RED:** Add guard tests proving `AdminScopeGuard` checks a route `leagueId` for visibility before manager authorization, and `ResourceScopeService` refuses deleted `LEAGUE` and `SEASON` scopes.
- [ ] **RUN:** Run the two guard/scope specs and observe the deleted-resource cases fail under the current authorization-only behavior.
- [ ] **GREEN:** Inject the visibility service into `AdminScopeGuard` and `ResourceScopeService`. Preserve platform-only routes that do not address a particular league; convert unresolved scoped resources in `ScopeGuard` to the shared 404 response rather than 403.
- [ ] **RUN:** Rerun guard/scope specs plus `pnpm --filter @efm/api typecheck`.
- [ ] **COMMIT:** `git add apps/api/src/league-visibility apps/api/src/app.module.ts apps/api/src/admin/admin-scope.guard* apps/api/src/authorization/resource-scope.service* apps/api/src/common/auth/scope.guard.ts && git commit -m "feat: centralize league visibility checks"`

### Task 3: Hide deleted leagues from root lists, details, grants, and platform administration

**Files:**
- Modify: `apps/api/src/leagues/leagues.service.ts`
- Modify: `apps/api/src/leagues/leagues.service.spec.ts`
- Modify: `apps/api/src/admin/admin-leagues.service.ts`
- Modify: `apps/api/src/admin/admin-leagues.service.spec.ts`
- Modify: `apps/api/src/admin-auth/admin-auth.service.ts`
- Modify: `apps/api/src/admin-auth/admin-auth.service.spec.ts` (create if absent)
- Modify: `apps/api/src/admin/admin-accounts.service.ts`
- Modify: `apps/api/src/admin/admin-authorization.service.ts`
- Modify: `apps/api/src/admin/admin-authorization.service.spec.ts`
- Test: `apps/admin-web/src/platform/leagues-page.spec.tsx`

**Behavior:**

- Public list/detail, legacy admin detail/update, and platform admin list/update must include `isDeleted: false` in their lookup or mutation predicate.
- `/admin/auth/me` and platform account grant listings must omit grants whose league is deleted.
- Grant creation and league-manager authorization against a deleted league must return 404, while existing grant rows stay in the database for restoration.
- The platform UI retains only existing edit/archive controls; no logical-delete control is rendered.

- [ ] **RED:** Extend public and admin league service specs for list omission, direct 404, mutation rejection, no audit/mutation side effects, and restoration after toggling `isDeleted` back to `false`.
- [ ] **RUN:** Run the two league service specs and confirm deleted records currently leak or mutate.
- [ ] **GREEN:** Add explicit `isDeleted: false` predicates to root league reads and `updateMany` predicates. Re-fetch only through visible predicates.
- [ ] **RUN:** Rerun the two specs green.
- [ ] **RED:** Add auth/account tests showing deleted league grants are absent from `me`/grant lists and cannot authorize or receive new operations, but are not physically removed.
- [ ] **RUN:** Run the focused admin-auth/admin-authorization specs and observe the leak.
- [ ] **GREEN:** Filter included league relations with `isDeleted: false`, and require visibility before grant creation or manager authorization.
- [ ] **RUN:** Rerun focused specs and API typecheck.
- [ ] **UI REGRESSION:** Add/retain an assertion in `leagues-page.spec.tsx` that no “删除联赛” control exists; run `pnpm --filter @efm/admin-web test -- --runInBand src/platform/leagues-page.spec.tsx`.
- [ ] **COMMIT:** `git add apps/api/src/leagues apps/api/src/admin apps/api/src/admin-auth apps/admin-web/src/platform/leagues-page.spec.tsx && git commit -m "feat: hide deleted leagues from root access"`

### Task 4: Close season, team, workspace, roster, economy, and valuation descendant access

**Files:**
- Modify: `apps/api/src/leagues/seasons.service.ts`
- Modify: `apps/api/src/leagues/season-entries.service.ts`
- Modify: `apps/api/src/admin/admin-league-seasons.service.ts`
- Modify: `apps/api/src/league-teams/league-teams.service.ts`
- Modify: `apps/api/src/league-teams/league-team-shells.service.ts`
- Modify: `apps/api/src/league-workspace/league-workspace.service.ts`
- Modify: `apps/api/src/league-rosters/admin-roster-queries.service.ts`
- Modify: `apps/api/src/league-rosters/roster-transactions.service.ts`
- Modify: `apps/api/src/league-rosters/salary-rules.service.ts`
- Modify: `apps/api/src/league-rosters/salary-recalculation.service.ts`
- Modify: `apps/api/src/league-rosters/transfer-windows.service.ts`
- Modify: `apps/api/src/league-economy/team-assets.service.ts`
- Modify: `apps/api/src/league-economy/team-finance.service.ts`
- Modify: `apps/api/src/league-economy/transaction-fees.service.ts`
- Modify: `apps/api/src/player-valuations/valuation-snapshots.service.ts`
- Modify: `apps/api/src/player-valuations/valuation-submissions.service.ts`
- Modify: `apps/api/src/player-valuations/valuation-windows.service.ts`
- Test: Corresponding `*.service.spec.ts` files beside each service above

**Implementation rule:** At every public service method, call `LeagueVisibilityService.requireVisible(...)` using the strongest identifier already available. Perform this check inside the same transaction and before mutation-receipt lookup, locking, audit, ledger, or write logic. For list queries such as `listMineViews`, add a relation predicate (`league: { isDeleted: false }`) so deleted descendants are omitted rather than causing the whole list to fail.

- [ ] **RED:** Add focused tests to `seasons.service.spec.ts`, `admin-league-seasons.service.spec.ts`, and `league-teams.service.spec.ts` proving deleted-league seasons/teams are omitted, direct IDs return 404, and a representative write leaves versions and audit counts unchanged.
- [ ] **RUN:** Run those three specs and observe failures.
- [ ] **GREEN:** Add visibility checks/predicates to seasons, entries, teams, and shell mutations. Ensure `listMine` and `listMineViews` exclude deleted parents.
- [ ] **RUN:** Rerun the three specs green.
- [ ] **RED:** Add one representative deleted-parent test in each domain spec group: workspace, roster query/mutation, economy, and valuation. Include transfer-window, ownership, and team-only URLs so indirect ancestry is exercised.
- [ ] **RUN:** Run the selected domain specs and observe current leakage.
- [ ] **GREEN:** Wire the shared visibility check into the listed services, always before receipts/side effects, and add explicit relation filters to collection queries.
- [ ] **RUN:** Run all specs under `league-workspace`, `league-rosters`, `league-economy`, `league-teams`, `leagues`, and `player-valuations`; then run API typecheck.
- [ ] **COMMIT:** `git add apps/api/src/leagues apps/api/src/admin apps/api/src/league-teams apps/api/src/league-workspace apps/api/src/league-rosters apps/api/src/league-economy apps/api/src/player-valuations && git commit -m "feat: block deleted league descendants"`

### Task 5: Hide league-owned competitions, schedules, registrations, matches, and “my” feeds

**Files:**
- Modify: `apps/api/src/competitions/competitions.service.ts`
- Modify: `apps/api/src/competitions/my-competitions.service.ts`
- Modify: `apps/api/src/competitions/cup-competitions.service.ts`
- Modify: `apps/api/src/competitions/cup-groups.service.ts`
- Modify: `apps/api/src/competitions/cup-brackets.service.ts`
- Modify: `apps/api/src/competitions/cup-bracket-queries.service.ts`
- Modify: `apps/api/src/competitions/cup-progression.service.ts`
- Modify: `apps/api/src/competitions/registrations.service.ts`
- Modify: `apps/api/src/competitions/schedules.service.ts`
- Modify: `apps/api/src/competitions/results.service.ts`
- Modify: `apps/api/src/competitions/standings.service.ts`
- Modify: `apps/api/src/league-allocation/league-allocation.service.ts`
- Test: Corresponding `*.service.spec.ts` and `apps/api/src/competitions/public-competitions-list.spec.ts`

**Query predicate:** A competition is visible when it is standalone (`seasonId: null`) or its season belongs to a non-deleted league. Encode that predicate explicitly in public and personal collection queries. For direct competition/stage/match routes, use `requireVisible` and allow the `null` standalone result.

- [ ] **RED:** Extend public competition list/detail and `my-competitions.service.spec.ts` to cover one standalone competition, one visible league competition, and one deleted-league competition. Expect only the first two in lists and 404 for the deleted direct detail.
- [ ] **RUN:** Run those focused specs and confirm the deleted league competition leaks today.
- [ ] **GREEN:** Add the standalone-or-visible relation predicate to competition and personal match/registration queries; guard direct competition reads and writes.
- [ ] **RUN:** Rerun focused specs green.
- [ ] **RED:** Add representative tests for a deleted parent across cup registration/bracket, schedule read/write, result submission/confirmation, standings, and tier-allocation mutation. Assert no receipt, result version, registration history, or allocation row is written.
- [ ] **RUN:** Run the affected specs and observe failures.
- [ ] **GREEN:** Apply visibility checks before reads, mutation receipts, and writes in the listed services. Preserve all standalone competition behavior.
- [ ] **RUN:** Run all competition and allocation unit specs plus API typecheck.
- [ ] **COMMIT:** `git add apps/api/src/competitions apps/api/src/league-allocation && git commit -m "feat: hide deleted league competitions"`

### Task 6: Prove end-to-end invisibility, restoration, and operational workflow

**Files:**
- Modify: `apps/api/test/leagues.e2e-spec.ts`
- Modify: `apps/api/test/admin.e2e-spec.ts`
- Modify: `apps/api/test/league-teams.e2e-spec.ts`
- Modify: `apps/api/test/competitions.e2e-spec.ts`
- Modify: `apps/api/test/league-rosters.e2e-spec.ts`
- Modify: `apps/api/test/league-economy.e2e-spec.ts`
- Modify: `apps/api/test/player-valuations.e2e-spec.ts`
- Modify: `docs/development/local-development.md`

**Operational SQL:**

```sql
UPDATE leagues
SET is_deleted = TRUE, updated_at = NOW()
WHERE id = '<league-id>';

UPDATE leagues
SET is_deleted = FALSE, updated_at = NOW()
WHERE id = '<league-id>';
```

- [ ] **RED:** Add an E2E scenario that seeds one complete league and one control league, flips only the target `isDeleted` through Prisma, and verifies: platform list omission; public/mini-program list omission; league detail 404; season/team/competition/workspace/roster/economy/valuation descendant 404; personal feeds omission; representative writes produce no rows.
- [ ] **RUN:** Run the named E2E files and observe at least one leak before the final wiring is complete.
- [ ] **GREEN:** Fix only uncovered entry points using the shared visibility service or explicit list predicate. Do not add UI or API deletion controls.
- [ ] **RESTORE:** In the same E2E scenario set `isDeleted` back to `false`, then verify the same league and unchanged descendants reappear without reseeding.
- [ ] **RUN:** Run `pnpm --filter @efm/api test:e2e -- --runInBand apps/api/test/leagues.e2e-spec.ts apps/api/test/admin.e2e-spec.ts apps/api/test/league-teams.e2e-spec.ts apps/api/test/competitions.e2e-spec.ts apps/api/test/league-rosters.e2e-spec.ts apps/api/test/league-economy.e2e-spec.ts apps/api/test/player-valuations.e2e-spec.ts`.
- [ ] **DOCS:** Document the manual hide/restore SQL, the meaning of `is_deleted`, the fact that `updated_at` changes, and the required application restart only after schema/client changes (not for each manual flag update).
- [ ] **FULL VERIFY:** Run `pnpm verify` and require lint, typecheck, unit tests, E2E tests, and builds all green.
- [ ] **MANUAL SMOKE:** With API/admin/mini-program using this same worktree, mark a disposable league deleted and verify it disappears from platform admin and mini-program; restore it and verify it returns. Record the league id and restore it before finishing.
- [ ] **COMMIT:** `git add apps/api/test docs/development/local-development.md && git commit -m "test: verify league logical deletion end to end"`

### Task 7: Final review and delivery

**Files:**
- Review: all changes since `07ac4ca`

- [ ] **SPEC COVERAGE:** Compare the final diff line-by-line with the confirmed design spec and every item under “Global Constraints” and “Review Focus”.
- [ ] **SIDE-EFFECT AUDIT:** Search for every service/controller accepting `leagueId`, `seasonId`, `teamId`, `competitionId`, `stageId`, `matchId`, `windowId`, or `ownershipId`; confirm each collection has an explicit filter and each direct operation reaches a visibility check before side effects.
- [ ] **TYPE CONSISTENCY:** Confirm the new flag remains internal to Prisma and did not enter shared contracts or client response types.
- [ ] **DIFF REVIEW:** Run `git diff --check 07ac4ca..HEAD`, inspect `git diff --stat 07ac4ca..HEAD`, and review every changed file for unrelated edits.
- [ ] **VERIFICATION:** Rerun `pnpm verify` from a clean working tree and save the command result in the handoff.
- [ ] **FINAL COMMIT:** If review fixes were needed, commit them as `fix: close league deletion visibility gaps`; otherwise do not create an empty commit.
