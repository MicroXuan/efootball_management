# League Team Admin System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a league-scoped team and roster management system with separate password-authenticated administrators, DT-based salaries, salary caps, transfer windows, auditable roster transactions, a Web admin console, and read-only mini-program views.

**Architecture:** Extend the existing pnpm monorepo and NestJS/MySQL API rather than creating a second backend. Replace global mutable `TeamProfile` writes with league-scoped `LeagueTeam` records, reuse `FootballPlayer` as the canonical real-player identity, and enforce roster invariants in transactional domain services. Add a React/Vite/Ant Design admin SPA and keep the Native WeChat mini-program read-only for this feature.

**Tech Stack:** Node.js 24, pnpm 11.23.0, TypeScript 5.9, NestJS 12, Prisma 7, MySQL 8, Zod 4, Jest/Supertest, React 19, Vite, Ant Design, React Router, Vitest, Native WeChat Mini Program.

**Spec:** `docs/superpowers/specs/2026-09-27-league-team-admin-system-design.zh-CN.md`

## Global Constraints

- A user may own at most one team per league; the same user may own independent teams in different leagues.
- Team numbers are administrator-assigned, unique inside a league, and stable across seasons.
- `FootballPlayer` is the canonical real-player identity; all `PlayerCard` variants remain stored.
- A real player may belong to only one team inside a league, enforced by `UNIQUE (league_id, player_id)`.
- New best cards never auto-upgrade an owned card.
- A team has at most 25 active players and may not exceed its league salary cap.
- Salary is derived from the held card's DT rating and the league's versioned salary tiers.
- First-version finance records amounts but never validates a cash balance.
- Roster writes are allowed only during a season transfer window that enables that operation, except a platform-admin emergency correction with a mandatory reason and audit trail.
- Admin authentication is independent from WeChat user authentication; passwords are never stored in plaintext.
- Historical season, roster, card, salary, and team snapshots never drift after later edits.
- Existing data is migrated additively; do not use `prisma migrate reset` or drop legacy tables in this plan.
- Every mutating endpoint uses an idempotency key and a transaction; authorization is derived server-side.

## Review Focus

- Two concurrent teams buying variants of the same real player: exactly one succeeds and the loser receives `LEAGUE_PLAYER_ALREADY_OWNED` (Task 8 tests).
- Two concurrent additions near 25 players or the salary cap: the locked team aggregate admits only valid commits (Task 8 tests).
- Overlapping, boundary-time, or operation-mismatched transfer windows: overlaps are rejected and timestamps use half-open `[startsAt, endsAt)` semantics (Task 7 tests).
- Missing/duplicate auto-build results and tied best cards: unavailable DT blocks acquisition; ties resolve by DT, release date, then external ID (Task 6 tests).
- Cross-league admin access and enumerable public user numbers: API scope checks deny access and search is exact-match plus rate-limited (Tasks 3–5 tests).

---

## File Structure

### Shared contracts

- `packages/contracts/src/admin-auth.ts`: admin login/session contracts.
- `packages/contracts/src/admin.ts`: administrator, role binding, audit, and platform management contracts.
- `packages/contracts/src/league-team.ts`: public user lookup, league team, and season-team contracts.
- `packages/contracts/src/league-roster.ts`: build, salary, transfer window, roster transaction, and ledger contracts.
- `packages/contracts/src/index.ts`: exports for the new boundaries.

### API

- `apps/api/src/admin-auth/*`: password hashing, tokens, sessions, guards, and controllers.
- `apps/api/src/admin/*`: platform admin accounts, league bindings, user lookup, and audit services.
- `apps/api/src/league-teams/*`: league-team lifecycle and migration-compatible reads.
- `apps/api/src/player-builds/*`: auto-build records and deterministic best-card selection.
- `apps/api/src/league-rosters/*`: salary rules, transfer windows, roster mutations, ledger, and invariants.
- `apps/api/prisma/schema.prisma` and new migrations: additive persistence changes.
- `apps/api/test/admin.e2e-spec.ts`, `league-teams.e2e-spec.ts`, `league-rosters.e2e-spec.ts`: end-to-end acceptance.

### Web admin

- `apps/admin-web/src/auth/*`: admin session and protected routes.
- `apps/admin-web/src/platform/*`: leagues, administrators, and grants.
- `apps/admin-web/src/leagues/*`: current-league shell, teams, salary rules, seasons, and windows.
- `apps/admin-web/src/rosters/*`: roster view and transactional forms.
- `apps/admin-web/src/lib/api.ts`: typed HTTP client using `@efm/contracts`.

### Mini-program

- `apps/miniprogram/miniprogram/services/league-teams.ts`: read-only team API.
- `apps/miniprogram/miniprogram/pages/my-league-teams/*`: team list.
- `apps/miniprogram/miniprogram/pages/league-team-detail/*`: roster, salary, ledger, and window status.
- Existing `team-profile` write UI is retired only after the new read path is verified.

## Milestone 1: Identity, Administration, and League Teams

### Task 1: Define the cross-client contracts

**Files:**
- Create: `packages/contracts/src/admin-auth.ts`
- Create: `packages/contracts/src/admin.ts`
- Create: `packages/contracts/src/league-team.ts`
- Create: `packages/contracts/src/league-roster.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`

**Interfaces:**
- Produces: `AdminLoginRequest`, `AdminAuthResponse`, `AdminAccountSummary`, `AdminLeagueGrant`, `PublicUserLookup`, `LeagueTeamSummary`, `LeagueTeamDetail`, `SalaryRuleVersion`, `TransferWindow`, `RosterEntry`, `RosterTransaction`, and `FinanceLedgerEntry` Zod schemas and inferred types.
- Uses decimal money as integer minor units and timestamps as ISO strings.

- [ ] **Step 1: Write failing contract tests** for six-digit user numbers, team numbers, positive minor-unit amounts, DT tier coverage, transfer-window timelines, operation flags, and all response schemas.
- [ ] **Step 2: Run `pnpm --filter @efm/contracts test`** and verify failures report missing exports.
- [ ] **Step 3: Implement the four focused contract files** and export them from `index.ts`; keep create/update schemas separate from response schemas and reuse `ResourceIdSchema`/`ExpectedVersionSchema`.
- [ ] **Step 4: Run `pnpm --filter @efm/contracts test && pnpm --filter @efm/contracts typecheck`** and expect both to pass.
- [ ] **Step 5: Commit** with `git commit -m "feat(contracts): define league team admin contracts"`.

### Task 2: Add the additive persistence foundation

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_league_team_admin_foundation/migration.sql`
- Modify: `apps/api/prisma/seed.ts`
- Test: `apps/api/src/database/prisma.service.spec.ts`

**Interfaces:**
- Produces Prisma models `AdminAccount`, `AdminSession`, `AdminLeagueRole`, `LeagueTeam`, `AuditLog`, and public user-number allocation; adds nullable `SeasonEntry.leagueTeamId` for backfill.
- Produces enums `AdminStatus`, `AdminRole`, `LeagueTeamStatus`, and `LeagueTeamRosterStatus`.

- [ ] **Step 1: Extend the database integration test** to assert unique `(leagueId, ownerUserId)`, unique `(leagueId, teamNumber)`, stable six-digit public numbers, and independent teams for the same user in different leagues.
- [ ] **Step 2: Run `pnpm --filter @efm/api test -- prisma.service.spec.ts`** and verify it fails before the migration/models exist.
- [ ] **Step 3: Add schema models and a non-destructive migration**; backfill public numbers deterministically from `100001`, create `LeagueTeam` rows per distinct legacy `(league, owner)` relation, and leave unresolved team numbers nullable with migration status `NEEDS_NUMBER`.
- [ ] **Step 4: Seed roles/permissions and one local platform administrator from `LOCAL_ADMIN_USERNAME` plus a precomputed `LOCAL_ADMIN_PASSWORD_HASH`; never seed a plaintext password.**
- [ ] **Step 5: Run `pnpm db:migrate && pnpm db:status && pnpm --filter @efm/api test -- prisma.service.spec.ts`** and expect migration/current-schema checks to pass.
- [ ] **Step 6: Commit** with `git commit -m "feat(db): add admin and league team foundation"`.

### Task 3: Implement separate administrator authentication

**Files:**
- Modify: `apps/api/package.json`
- Modify: `.env.example`
- Create: `apps/api/src/admin-auth/password.service.ts`
- Create: `apps/api/src/admin-auth/admin-token.service.ts`
- Create: `apps/api/src/admin-auth/admin-auth.guard.ts`
- Create: `apps/api/src/admin-auth/current-admin.decorator.ts`
- Create: `apps/api/src/admin-auth/admin-auth.service.ts`
- Create: `apps/api/src/admin-auth/admin-auth.controller.ts`
- Create: `apps/api/src/admin-auth/admin-auth.module.ts`
- Create: `apps/api/src/admin-auth/*.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Create: `apps/api/test/admin-auth.e2e-spec.ts`

**Interfaces:**
- Produces `PasswordService.hash/verify`, `AdminTokenService.issuePair/rotate/revoke`, `AdminAuthGuard`, and `CurrentAdmin`.
- HTTP: `POST /v1/admin/auth/login`, `/refresh`, `/logout`, and `GET /me`.

- [ ] **Step 1: Add failing tests** for valid login, wrong password, disabled account, five failures causing a 15-minute lock, refresh rotation/reuse revocation, logout, and separation from WeChat JWTs.
- [ ] **Step 2: Run the focused unit and E2E tests** and verify missing module/endpoints fail.
- [ ] **Step 3: Add `bcryptjs` and implement password hashing plus admin-specific JWT claims `{ sub, actor: 'ADMIN' }`; store only refresh-token hashes in `AdminSession`.**
- [ ] **Step 4: Implement guard/controller/module** with generic credential errors so usernames cannot be enumerated.
- [ ] **Step 5: Run `pnpm --filter @efm/api test -- admin-auth && pnpm --filter @efm/api test:e2e -- admin-auth.e2e-spec.ts`** and expect all cases to pass.
- [ ] **Step 6: Commit** with `git commit -m "feat(api): add administrator authentication"`.

### Task 4: Implement platform administration and league-scoped grants

**Files:**
- Create: `apps/api/src/admin/admin-authorization.service.ts`
- Create: `apps/api/src/admin/admin-scope.guard.ts`
- Create: `apps/api/src/admin/admin-accounts.service.ts`
- Create: `apps/api/src/admin/admin-accounts.controller.ts`
- Create: `apps/api/src/admin/admin-leagues.controller.ts`
- Create: `apps/api/src/admin/audit-log.service.ts`
- Create: `apps/api/src/admin/admin.module.ts`
- Create: `apps/api/src/admin/*.spec.ts`
- Create: `apps/api/test/admin.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces `AdminAuthorizationService.requirePlatformAdmin(adminId)` and `.requireLeagueManager(adminId, leagueId)`.
- HTTP manages admin accounts, password reset, status, league grants, leagues, and audit queries below `/v1/admin`.

- [ ] **Step 1: Write failing tests** for platform-only account creation, one manager receiving multiple leagues, revoked grants, disabled accounts, cross-league denial, exact audit actors, and user-number lookup rejecting partial values.
- [ ] **Step 2: Run focused tests** and verify they fail on missing services.
- [ ] **Step 3: Implement services/guards/controllers**; rate-limit exact six-digit lookup in-process for local development and expose a replaceable `AdminLookupRateLimiter` port for production shared storage.
- [ ] **Step 4: Record audit rows for every account, grant, league, and password-reset mutation without recording passwords or tokens.**
- [ ] **Step 5: Run `pnpm --filter @efm/api test -- admin && pnpm --filter @efm/api test:e2e -- admin.e2e-spec.ts`** and expect pass.
- [ ] **Step 6: Commit** with `git commit -m "feat(api): add platform administration scopes"`.

### Task 5: Replace global team writes with league-team APIs

**Files:**
- Create: `apps/api/src/league-teams/league-teams.service.ts`
- Create: `apps/api/src/league-teams/admin-league-teams.controller.ts`
- Create: `apps/api/src/league-teams/my-league-teams.controller.ts`
- Create: `apps/api/src/league-teams/league-teams.module.ts`
- Create: `apps/api/src/league-teams/*.spec.ts`
- Modify: `apps/api/src/leagues/season-entries.service.ts`
- Modify: `apps/api/src/leagues/leagues.module.ts`
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_season_entries_use_league_teams/migration.sql`
- Create: `apps/api/test/league-teams.e2e-spec.ts`

**Interfaces:**
- Produces `LeagueTeamsService.create/update/listMine/getDetail` and admin exact-user lookup-to-create flow.
- `SeasonEntry` uses `leagueTeamId` and snapshots team number/name/logo plus game-account identity.

- [ ] **Step 1: Write failing service/E2E tests** for same-user cross-league teams, duplicate user/team number, manager scope, stable team number across seasons, snapshot immutability, and migrated legacy entries.
- [ ] **Step 2: Run focused tests** and verify expected missing behavior.
- [ ] **Step 3: Implement league-team APIs and switch season-entry creation/renewal to `LeagueTeam`; keep legacy team-profile reads temporarily for migration diagnostics only.**
- [ ] **Step 4: Make `SeasonEntry.leagueTeamId` non-null only after the migration verifies zero unresolved references; retain legacy columns/table for one release cycle.**
- [ ] **Step 5: Run `pnpm --filter @efm/api test -- league-team leagues && pnpm --filter @efm/api test:e2e -- league-teams.e2e-spec.ts leagues.e2e-spec.ts`** and expect pass.
- [ ] **Step 6: Commit** with `git commit -m "feat(api): add league scoped teams"`.

## Milestone 2: Player Builds, Salary, Windows, and Transactions

### Task 6: Persist auto-build results and deterministic best-card selection

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_player_auto_builds/migration.sql`
- Modify: `packages/contracts/src/player-import.ts`
- Modify: `apps/api/src/player-import/record-normalizer.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata.schemas.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata-mapper.ts`
- Create: `apps/api/src/player-builds/player-build-selector.ts`
- Create: `apps/api/src/player-builds/player-builds.service.ts`
- Create: `apps/api/src/player-builds/player-builds.module.ts`
- Create: `apps/api/src/player-builds/*.spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces `PlayerCardAutoBuild` and `FootballPlayerBestCard` persistence.
- Produces `selectBestCard(builds): BestCardSelection`; ordering is max overall desc, DT desc, release date desc, external ID asc.
- Import/sync accepts `autoBuildAllocation`, `autoBuildMaxOverall`, `dtRating`, and `algorithmVersion`; missing results remain unavailable rather than guessed.

- [ ] **Step 1: Add failing fixtures/tests** for all six Bonucci variants, tied max-overall ordering, missing DT, duplicate algorithm versions, and a newer best card not mutating ownership.
- [ ] **Step 2: Run player import/sync/build tests** and verify missing fields/models fail.
- [ ] **Step 3: Extend normalized import and the authorized PESDATA adapter** to persist source-provided automatic-build output; isolate source mapping behind the normalized contract and do not call an undocumented endpoint from clients.
- [ ] **Step 4: Implement deterministic selection and persist `selectionReason`; never delete non-best cards.**
- [ ] **Step 5: Run `pnpm --filter @efm/api test -- player-build pesdata player-import`** and expect pass.
- [ ] **Step 6: Commit** with `git commit -m "feat(api): persist player auto builds"`.

### Task 7: Add versioned salary rules and transfer windows

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_salary_rules_transfer_windows/migration.sql`
- Create: `apps/api/src/league-rosters/salary-rules.service.ts`
- Create: `apps/api/src/league-rosters/transfer-windows.service.ts`
- Create: `apps/api/src/league-rosters/admin-rules.controller.ts`
- Create: `apps/api/src/league-rosters/*.spec.ts`

**Interfaces:**
- Produces `SalaryRulesService.quote(leagueId, dtRating)` and `.previewRecalculation(leagueId, draftRules)`.
- Produces `TransferWindowsService.requireAllowed(seasonId, operation, at)` using `[startsAt, endsAt)`.
- Seeds default tiers `<=92:100, 93:200, …, 99:800, >=100:900` for each new league.

- [ ] **Step 1: Write failing tests** for full/non-overlapping DT coverage, per-league overrides, immutable versions, cap-impact preview, forbidden overlapping windows, exact boundary times, and per-operation flags.
- [ ] **Step 2: Run focused tests** and verify failures.
- [ ] **Step 3: Implement models, migration, services, and admin endpoints** with optimistic versions and audit calls.
- [ ] **Step 4: Run `pnpm --filter @efm/api test -- salary-rules transfer-windows`** and expect pass.
- [ ] **Step 5: Commit** with `git commit -m "feat(api): add salary rules and transfer windows"`.

### Task 8: Implement atomic player acquisition and release

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_league_rosters_ledger/migration.sql`
- Create: `apps/api/src/league-rosters/roster-lock.repository.ts`
- Create: `apps/api/src/league-rosters/roster-transactions.service.ts`
- Create: `apps/api/src/league-rosters/admin-rosters.controller.ts`
- Create: `apps/api/src/league-rosters/league-rosters.module.ts`
- Create: `apps/api/src/league-rosters/roster-transactions.service.spec.ts`
- Create: `apps/api/test/league-rosters.e2e-spec.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces `acquire(input, admin)` and `release(input, admin)` returning committed `RosterTransaction` plus `LeagueTeamRosterSummary`.
- Persists `LeaguePlayerOwnership`, `RosterTransaction`, `FinanceLedgerEntry`, and `MutationReceipt`/equivalent idempotency record.

- [ ] **Step 1: Write failing tests** for acquisition success, exact duplicate retry, another-team conflict, missing build/DT, roster 25/26, salary exactly at/over cap, closed window, and atomic rollback.
- [ ] **Step 2: Add concurrency E2E tests** where two teams buy card variants of one `FootballPlayer` and where two additions race at roster/cap boundaries.
- [ ] **Step 3: Run focused tests** and verify they fail.
- [ ] **Step 4: Implement row locking and transactional invariants**; rely on the database unique key as the final real-player ownership guard and map duplicate-key errors to `LEAGUE_PLAYER_ALREADY_OWNED`.
- [ ] **Step 5: Implement release as an immutable reverse transaction** that frees the league ownership and writes optional income without editing prior transactions.
- [ ] **Step 6: Run `pnpm --filter @efm/api test -- roster-transactions && pnpm --filter @efm/api test:e2e -- league-rosters.e2e-spec.ts`** and expect pass.
- [ ] **Step 7: Commit** with `git commit -m "feat(api): add atomic roster acquisition"`.

### Task 9: Implement team transfers, card upgrades, and recalculation

**Files:**
- Modify: `apps/api/src/league-rosters/roster-transactions.service.ts`
- Modify: `apps/api/src/league-rosters/admin-rosters.controller.ts`
- Create: `apps/api/src/league-rosters/salary-recalculation.service.ts`
- Modify: `apps/api/src/league-rosters/roster-transactions.service.spec.ts`
- Modify: `apps/api/test/league-rosters.e2e-spec.ts`

**Interfaces:**
- Adds `transfer(input, admin)`, `upgradeCard(input, admin)`, `recalculateLeague(input, admin)`, and platform-only `emergencyCorrect(input, admin)`.
- Transfer locks both teams in stable ID order; upgrade preserves `FootballPlayer` ownership.

- [ ] **Step 1: Write failing tests** for atomic two-team transfer, target 25/cap rejection, deadlock-safe lock ordering, wrong-player upgrade rejection, new-card salary checks, no auto-upgrade, rule recalculation producing `OVER_CAP` without removing players, manager denial outside windows, and platform emergency correction requiring a reason plus immutable audit record.
- [ ] **Step 2: Run focused tests** and verify failures.
- [ ] **Step 3: Implement transfer/upgrade/recalculation and platform emergency correction** as immutable transactions with paired ledger entries and audit records; the emergency path must not be available to league managers.
- [ ] **Step 4: Run all roster unit/E2E tests** and expect pass with unchanged historical snapshots.
- [ ] **Step 5: Commit** with `git commit -m "feat(api): add transfers and card upgrades"`.

## Milestone 3: Web Admin, Mini-program, and Release

### Task 10: Scaffold the typed admin SPA and authentication shell

**Files:**
- Create: `apps/admin-web/package.json`
- Create: `apps/admin-web/tsconfig.json`
- Create: `apps/admin-web/vite.config.ts`
- Create: `apps/admin-web/index.html`
- Create: `apps/admin-web/src/main.tsx`
- Create: `apps/admin-web/src/app.tsx`
- Create: `apps/admin-web/src/lib/api.ts`
- Create: `apps/admin-web/src/auth/*`
- Create: `apps/admin-web/src/**/*.spec.tsx`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Produces `AdminApiClient`, `AdminSessionProvider`, `ProtectedRoute`, and `/login` plus authenticated application shell.

- [ ] **Step 1: Scaffold React/Vite/Ant Design/React Router/Vitest and add workspace scripts** for lint, typecheck, test, and build.
- [ ] **Step 2: Write failing UI tests** for login success/error/lock, token refresh, logout, protected redirect, and no token leakage in rendered errors.
- [ ] **Step 3: Implement the typed client and auth shell** with access token in memory and refresh token handling according to the API contract; do not use query-string tokens.
- [ ] **Step 4: Run `pnpm --filter @efm/admin-web test && pnpm --filter @efm/admin-web typecheck && pnpm --filter @efm/admin-web build`** and expect pass.
- [ ] **Step 5: Commit** with `git commit -m "feat(admin): add authenticated web shell"`.

### Task 11: Build platform and league-team administration pages

**Files:**
- Create: `apps/admin-web/src/platform/admin-accounts-page.tsx`
- Create: `apps/admin-web/src/platform/leagues-page.tsx`
- Create: `apps/admin-web/src/platform/audit-page.tsx`
- Create: `apps/admin-web/src/leagues/league-shell.tsx`
- Create: `apps/admin-web/src/leagues/teams-page.tsx`
- Create: `apps/admin-web/src/leagues/team-detail-page.tsx`
- Create: matching `*.spec.tsx` files

**Interfaces:**
- Consumes Task 4/5 admin and league-team APIs.
- Produces complete platform-account/grant and exact-public-number-to-team workflows.

- [ ] **Step 1: Write failing page tests** for role-based navigation, multiple league grants, exact six-digit user lookup, duplicate team-number error, loading/empty/error states, and optimistic-version conflict refresh.
- [ ] **Step 2: Implement platform pages and current-league shell**; preserve league ID in routes and never trust a client-only role check.
- [ ] **Step 3: Implement team creation/detail forms** with separate team number/name/user fields and accessible tables/forms.
- [ ] **Step 4: Run admin-web tests/typecheck/build** and expect pass.
- [ ] **Step 5: Commit** with `git commit -m "feat(admin): manage leagues and teams"`.

### Task 12: Build salary, window, roster, and ledger pages

**Files:**
- Create: `apps/admin-web/src/leagues/salary-rules-page.tsx`
- Create: `apps/admin-web/src/leagues/transfer-windows-page.tsx`
- Create: `apps/admin-web/src/rosters/roster-page.tsx`
- Create: `apps/admin-web/src/rosters/acquire-player-drawer.tsx`
- Create: `apps/admin-web/src/rosters/transfer-player-drawer.tsx`
- Create: `apps/admin-web/src/rosters/upgrade-card-drawer.tsx`
- Create: `apps/admin-web/src/rosters/ledger-page.tsx`
- Create: matching `*.spec.tsx` files

**Interfaces:**
- Consumes Tasks 6–9 APIs.
- Produces manager workflows for rule preview, windows, acquisition, release, transfer, upgrade, roster status, and ledger/audit display.

- [ ] **Step 1: Write failing UI tests** for best-card default selection, all-card inspection, missing DT block, 25-player/cap errors with current/limit values, window-operation disablement, salary impact preview, idempotent resubmission, and immutable history rows.
- [ ] **Step 2: Implement salary/window pages** with rule-version preview and non-overlapping timeline validation.
- [ ] **Step 3: Implement roster transaction drawers** with explicit confirmations and business-error rendering.
- [ ] **Step 4: Implement ledger and audit views** without edit/delete controls.
- [ ] **Step 5: Run admin-web tests/typecheck/build** and expect pass.
- [ ] **Step 6: Commit** with `git commit -m "feat(admin): manage rosters and salary caps"`.

### Task 13: Replace mini-program team writes with read-only league-team views

**Files:**
- Modify: `apps/miniprogram/miniprogram/app.json`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.wxml`
- Create: `apps/miniprogram/miniprogram/services/league-teams.ts`
- Create: `apps/miniprogram/miniprogram/pages/my-league-teams/*`
- Create: `apps/miniprogram/miniprogram/pages/league-team-detail/*`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/*`
- Test: new viewmodel specs and affected existing specs

**Interfaces:**
- Consumes `GET /v1/me/league-teams` and team-detail read models.
- Displays public user number, independent league teams, roster `n/25`, salary/cap, held card, ledger, and current transfer-window status.

- [ ] **Step 1: Write failing viewmodel tests** for multiple league teams, six-digit number formatting/copying, empty roster, over-cap state, ledger signs, and no mutation actions.
- [ ] **Step 2: Implement typed service and pages** in the existing Native visual language.
- [ ] **Step 3: Remove navigation to writable `team-profile` UI only after all league registration paths use `LeagueTeam`; retain the files for one release if rollback is needed.**
- [ ] **Step 4: Run `pnpm --filter @efm/miniprogram test && pnpm --filter @efm/miniprogram typecheck`** and expect pass.
- [ ] **Step 5: Commit** with `git commit -m "feat(miniprogram): show league scoped teams"`.

### Task 14: Complete migration verification, documentation, and release gates

**Files:**
- Create: `apps/api/src/league-teams/league-team-backfill.cli.ts`
- Create: `apps/api/src/league-teams/league-team-backfill.cli.spec.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json`
- Create: `docs/development/admin-web-local-development.zh-CN.md`
- Create: `docs/development/league-team-migration.zh-CN.md`
- Modify: `docs/development/local-development.md`
- Modify: `README.md`

**Interfaces:**
- Produces idempotent dry-run/apply backfill commands with counts for created teams, unresolved numbers, linked season entries, and invariant violations.

- [ ] **Step 1: Write failing CLI tests** for dry-run non-mutation, repeatable apply, unresolved legacy teams, duplicate detection, and refusal in production without an explicit confirmation flag.
- [ ] **Step 2: Implement the backfill/verification CLI** and scripts `league-teams:migrate --dry-run|--apply`.
- [ ] **Step 3: Document local admin bootstrap, API/admin/miniprogram startup, migration backup/rollback, and a complete manual acceptance flow.**
- [ ] **Step 4: Run migrations against a disposable copy of representative legacy data** and verify row counts/snapshots before and after.
- [ ] **Step 5: Run `pnpm verify && pnpm db:status && git diff --check`**; expect all packages, E2E tests, builds, migrations, and whitespace checks to pass.
- [ ] **Step 6: Manually verify** platform admin → manager grant → user lookup → league team → transfer window → buy → transfer → upgrade → mini-program read-only display.
- [ ] **Step 7: Commit** with `git commit -m "docs: add league team admin runbook"`.

## Completion Gate

- All 14 tasks are committed independently and `pnpm verify` is green.
- Database migration/backfill reports zero unresolved references before legacy writes are disabled.
- Admin APIs reject cross-league access and all roster invariants hold under concurrency tests.
- Web admin completes the full management path without requiring mini-program write operations.
- The mini-program shows the correct per-league team, roster, salary, cap, ledger, and window data.
- Legacy `TeamProfile` tables remain recoverable for one release cycle; destructive cleanup requires a separate reviewed plan.
