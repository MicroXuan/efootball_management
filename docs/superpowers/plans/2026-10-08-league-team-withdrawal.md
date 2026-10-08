# League Team Withdrawal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let league administrators permanently archive and restore a team while hiding archived teams from active workflows, preserving all history, and labeling archived teams as “已退赛” in historical competitions.

**Architecture:** Reuse `LeagueTeam.status` as the lifecycle source of truth and add dedicated archive/restore commands instead of allowing status changes through the generic team update. A small global lifecycle service enforces `ACTIVE` before team-owned mutations, while active collections use explicit Prisma predicates. Historical match and standings responses retain their snapshots and add a derived nullable lifecycle status for display.

**Tech Stack:** MySQL, Prisma 7, NestJS 12, Zod contracts, React/Ant Design, WeChat mini-program, Jest/Vitest/Supertest.

**Spec:** `docs/superpowers/specs/2026-10-08-league-team-withdrawal-design.zh-CN.md`

## Global Constraints

- Work on the existing `codex/league-center-banner` branch and existing shared database; do not create another branch, worktree, database, or migration.
- `LeagueTeam.status = ARCHIVED` means permanently withdrawn; `ACTIVE` remains operational and `NEEDS_NUMBER` keeps its current compatibility semantics.
- Do not delete, detach, renumber, release, or rewrite the team's shell, roster, ownerships, finance ledger, season entries, participants, matches, results, standings, or audit history.
- Do not implement current-season-only withdrawal, automatic forfeits, schedule regeneration, asset settlement, or owner-initiated permanent withdrawal.
- Archive and restore require a trimmed 1–512 character reason, `expectedVersion`, `Idempotency-Key`, authorization, audit logging, and optimistic concurrency.
- Deleted leagues still resolve as 404 before any team lifecycle behavior; archive/restore must not bypass `League.isDeleted`.
- Archived teams are absent from user-facing active collections and user direct routes return 404; authorized admin operational writes return `409 TEAM_ARCHIVED` before receipts or side effects.
- Historical matches, schedules, and standings remain readable and use stored display-name snapshots; archived team participants are labeled “已退赛”.
- Follow strict TDD for every behavior change: write one focused failing test, observe the intended failure, implement the minimum change, then rerun it green.

## Review Focus

- A repeated archive/restore request with the same idempotency key returns the first response and creates only one audit row.
- A different key sent after the team already reached the requested state returns the current team without incrementing the version or duplicating audit history.
- A team archived concurrently with a roster, finance, valuation, registration, or result mutation cannot leave a receipt, ledger entry, audit record, or partial domain write.
- An archived team remains visible in historical match/standings data but disappears from active selectors, personal feeds, and action lists.
- Restoring a team preserves its original number, catalog shell, ownerships, balances, season history, and competition history.

---

### Task 1: Define lifecycle command, filter, and historical-display contracts

**Files:**
- Modify: `packages/contracts/src/league-team.ts`
- Modify: `packages/contracts/src/competition.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`

**Interfaces:**
- Produces: `LeagueTeamLifecycleRequestSchema` / `LeagueTeamLifecycleRequest` with `{ expectedVersion, reason }`.
- Produces: `LeagueTeamAdminListStatusSchema` with `ACTIVE | ARCHIVED`, defaulted by the controller to `ACTIVE`.
- Changes: `UpdateLeagueTeamRequestSchema` no longer accepts `status` because it remains strict.
- Changes: `CompetitionParticipantSummarySchema` and `StandingsRowResponseSchema` expose `teamLifecycleStatus: LeagueTeamStatusSchema.extract(['ACTIVE', 'ARCHIVED']).nullable()`.

- [ ] **RED:** Add contract tests proving archive/restore input trims and requires a 1–512 character reason and positive version; the generic update rejects `status`; admin list status accepts only `ACTIVE` or `ARCHIVED`; participant and standings responses require `ACTIVE | ARCHIVED | null`.
- [ ] **RUN:** Run `pnpm --filter @efm/contracts test`; confirm the new imports/schemas are missing and the old update schema still accepts `status`.
- [ ] **GREEN:** Implement the schemas and exported types in `league-team.ts`, reuse the lifecycle status schema in `competition.ts`, and update existing competition fixtures with `teamLifecycleStatus: null`.
- [ ] **RUN:** Run `pnpm --filter @efm/contracts test && pnpm --filter @efm/contracts typecheck`; require all contract tests and typecheck to pass.
- [ ] **COMMIT:** `git add packages/contracts && git commit -m "feat: define league team lifecycle contracts"`

### Task 2: Implement audited archive/restore and admin lifecycle views

**Files:**
- Create: `apps/api/src/league-team-lifecycle/league-team-lifecycle.service.ts`
- Create: `apps/api/src/league-team-lifecycle/league-team-lifecycle.module.ts`
- Create: `apps/api/src/league-team-lifecycle/league-team-lifecycle.service.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/league-teams/admin-league-teams.controller.ts`
- Modify: `apps/api/src/league-teams/league-teams.service.ts`
- Modify: `apps/api/src/league-teams/league-teams.service.spec.ts`
- Modify: `apps/api/src/league-teams/league-team-summary.spec.ts`

**Interfaces:**
- Produces: `LeagueTeamLifecycleService.requireActive(teamId, client?): Promise<string>` returning the visible league id, throwing 404 for a missing/deleted parent and `409 TEAM_ARCHIVED` for an archived team.
- Produces: `LeagueTeamsService.archive(actorAdminId, leagueId, teamId, input, key)` and `restore(...)`, both returning `LeagueTeamDetail`.
- Changes: `listForLeague(leagueId, status)` explicitly filters the requested lifecycle status; admin detail can read `ACTIVE` or `ARCHIVED`, while user detail remains active-only.

- [ ] **RED:** Unit-test the lifecycle service for active, archived, missing, and deleted-league teams, including a transaction client.
- [ ] **RUN:** Run only `league-team-lifecycle.service.spec.ts`; confirm failure because the service does not exist.
- [ ] **GREEN:** Implement the global lifecycle service, import its module once in `AppModule`, and use the existing league visibility boundary before evaluating team status.
- [ ] **RUN:** Rerun the lifecycle spec and API typecheck.
- [ ] **RED:** Add service tests proving archive/restore update only status/version, preserve number/shell/ownership/ledger records, write the exact audit action/reason, reject `NEEDS_NUMBER`, reject stale versions, prioritize deleted-league 404, and make same-key/same-target retries side-effect free.
- [ ] **RUN:** Run `league-teams.service.spec.ts`; confirm archive/restore methods are missing.
- [ ] **GREEN:** Implement archive/restore with a pre-receipt visibility/lifecycle read, transaction lock, repeated in-transaction state/version checks, conditional `updateMany`, one audit record, and current-result return for an already reached target state. Add the two POST controller routes and require the existing idempotency header.
- [ ] **RUN:** Rerun league-team specs and API typecheck.
- [ ] **RED:** Add list/detail tests proving default/`ACTIVE` admin results omit archived teams, `ARCHIVED` returns only withdrawn teams, admin can read an archived detail, and user detail returns 404.
- [ ] **GREEN:** Split admin detail from user detail where necessary and add explicit status predicates to collection queries.
- [ ] **RUN:** Rerun league-team specs green.
- [ ] **COMMIT:** `git add apps/api/src/app.module.ts apps/api/src/league-team-lifecycle apps/api/src/league-teams && git commit -m "feat: archive and restore league teams"`

### Task 3: Remove archived teams from active user and administration collections

**Files:**
- Modify: `apps/api/src/league-teams/league-teams.service.ts`
- Modify: `apps/api/src/league-workspace/league-workspace.service.ts`
- Modify: `apps/api/src/league-workspace/league-workspace.service.spec.ts`
- Modify: `apps/api/src/leagues/seasons.service.ts`
- Modify: `apps/api/src/leagues/seasons.service.spec.ts`
- Modify: `apps/api/src/leagues/season-entries.service.ts`
- Modify: `apps/api/src/leagues/season-entries.service.spec.ts`
- Modify: `apps/api/src/competitions/my-competitions.service.ts`
- Modify: `apps/api/src/competitions/my-competitions.service.spec.ts`
- Modify: `apps/api/src/team-catalog/team-catalog.service.ts`
- Modify: `apps/api/src/team-catalog/team-catalog.service.spec.ts`

**Interfaces:**
- Consumes: lifecycle status and active-team predicate from Tasks 1–2.
- Produces: active-only personal teams, current league selectors, workspace membership, season enrollment choices, personal competition feeds, and team-shell occupancy for operational screens.

- [ ] **RED:** Add focused tests showing `listMine`, `listMineViews`, and user overview/detail omit or 404 an archived team while admin archived detail remains readable.
- [ ] **RUN:** Run league-team specs and observe archived teams leak through current unfiltered user queries.
- [ ] **GREEN:** Add `status: 'ACTIVE'` to user-facing team collections and direct user predicates without changing admin historical reads.
- [ ] **RUN:** Rerun league-team specs green.
- [ ] **RED:** Add one archived-team collection test in workspace, current-season/team selector, season-entry identity, personal competitions, and catalog occupancy. Assert archived teams do not appear as actionable choices while their database rows remain.
- [ ] **RUN:** Run the five affected spec groups and observe current leakage.
- [ ] **GREEN:** Add explicit relation predicates through `leagueTeam: { status: 'ACTIVE' }`; retain historical season and competition queries that are not action selectors.
- [ ] **RUN:** Run affected specs plus API typecheck.
- [ ] **COMMIT:** `git add apps/api/src/league-teams apps/api/src/league-workspace apps/api/src/leagues apps/api/src/competitions/my-competitions.service* apps/api/src/team-catalog && git commit -m "feat: hide withdrawn teams from active views"`

### Task 4: Block every archived-team business mutation before side effects

**Files:**
- Modify: `apps/api/src/league-teams/league-team-shells.service.ts`
- Modify: `apps/api/src/league-teams/league-team-shells.service.spec.ts`
- Modify: `apps/api/src/league-rosters/roster-transactions.service.ts`
- Modify: `apps/api/src/league-rosters/roster-transactions.service.spec.ts`
- Modify: `apps/api/src/league-rosters/salary-recalculation.service.ts`
- Modify: `apps/api/src/league-economy/team-finance.service.ts`
- Modify: `apps/api/src/league-economy/team-finance.service.spec.ts`
- Modify: `apps/api/src/player-valuations/valuation-snapshots.service.ts`
- Modify: `apps/api/src/player-valuations/valuation-submissions.service.ts`
- Modify: `apps/api/src/player-valuations/valuation-submissions.service.spec.ts`
- Modify: `apps/api/src/competitions/registrations.service.ts`
- Modify: `apps/api/src/competitions/registrations.service.spec.ts`
- Modify: `apps/api/src/competitions/cup-competitions.service.ts`
- Modify: `apps/api/src/competitions/cup-competitions.service.spec.ts`
- Modify: `apps/api/src/competitions/results.service.ts`
- Modify: `apps/api/src/competitions/results.service.spec.ts`

**Interfaces:**
- Consumes: `LeagueTeamLifecycleService.requireActive(teamId, client?)` from Task 2.
- Produces: `409 TEAM_ARCHIVED` for authorized admin operations and resource-unavailable behavior for user operations before receipts, audit, ledger, snapshot, registration, result, or roster writes.

- [ ] **RED:** Add representative shell-change and roster transaction tests that archive the source or target team and assert `TEAM_ARCHIVED`, unchanged versions/ownerships, and unchanged receipt/audit/ledger counts.
- [ ] **RUN:** Run league-team-shell and roster transaction specs; confirm at least one operation currently writes or returns the wrong error.
- [ ] **GREEN:** Require active source/target teams before receipt execution and repeat the check with the transaction client after locks; keep roster reads available for authorized historical inspection.
- [ ] **RUN:** Rerun shell/roster specs green.
- [ ] **RED:** Add finance, salary recalculation, and valuation tests proving archived teams receive no manual entry, recalculation, new snapshot, draft, submission, or review-side write.
- [ ] **RUN:** Run economy and valuation specs and observe missing lifecycle enforcement.
- [ ] **GREEN:** Add active-team checks and active relation filters before every affected write or batch candidate selection.
- [ ] **RUN:** Rerun economy/valuation specs green.
- [ ] **RED:** Add ordinary and cup registration plus result-submission tests proving an archived participant cannot register, resubmit, withdraw, submit, or confirm a new result; assert mutation receipts, registration history, result versions, standings snapshots, and audit counts stay unchanged.
- [ ] **RUN:** Run registration/cup/result specs and observe current writes or incorrect responses.
- [ ] **GREEN:** Resolve the relevant `seasonEntry.leagueTeamId`, require it active before receipt lookup, and repeat inside the transaction before mutations. Do not remove the participant or its historical matches.
- [ ] **RUN:** Run all modified domain specs plus API typecheck.
- [ ] **COMMIT:** `git add apps/api/src/league-teams apps/api/src/league-rosters apps/api/src/league-economy apps/api/src/player-valuations apps/api/src/competitions && git commit -m "feat: freeze withdrawn league teams"`

### Task 5: Label withdrawn teams in historical matches and standings

**Files:**
- Modify: `apps/api/src/competitions/schedules.service.ts`
- Modify: `apps/api/src/competitions/schedules.service.spec.ts`
- Modify: `apps/api/src/competitions/standings.service.ts`
- Modify: `apps/api/src/competitions/standings.service.spec.ts`
- Modify: `apps/api/src/competitions/cup-bracket-queries.service.ts`
- Modify: `apps/api/src/competitions/cup-bracket-queries.service.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/competition-detail/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/competition-detail/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/competition-detail/detail.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/competition-detail/detail.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/competition-manage/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/competition-manage/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/matches.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/matches.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/match-result/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/match-result/result.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/match-result/result.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/season-standings/standings.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/season-standings/standings.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/season-standings/index.wxml`
- Modify: `apps/admin-web/src/leagues/cups-page.tsx`
- Modify: `apps/admin-web/src/leagues/cups-page.spec.tsx`

**Interfaces:**
- Consumes: `teamLifecycleStatus` contract fields from Task 1.
- Produces: participant/match and standings responses whose name snapshots are unchanged and whose team lifecycle is `ARCHIVED` when the linked league team has withdrawn.

- [ ] **RED:** Add schedule, standings, and bracket query tests using a participant linked through `seasonEntry.leagueTeam`; after archiving the team, expect the same match/result/rank data and display name with `teamLifecycleStatus: 'ARCHIVED'`.
- [ ] **RUN:** Run the three competition specs; confirm the lifecycle field is absent while historical data remains.
- [ ] **GREEN:** Include only the minimal `seasonEntry.leagueTeam.status` relation in read queries and map it to `ACTIVE | ARCHIVED | null`; do not filter archived participants.
- [ ] **RUN:** Rerun competition specs and API typecheck.
- [ ] **RED:** Add view-model/component tests proving `ARCHIVED` participants render “已退赛” beside their snapshot name in match, bracket, and standings views, while `ACTIVE` and `null` render no badge.
- [ ] **RUN:** Run the focused mini-program and admin-web tests and observe the missing labels.
- [ ] **GREEN:** Add a small reusable presentation helper per client and render the badge in the listed historical views without disabling history navigation.
- [ ] **RUN:** Rerun focused client tests and both client typechecks.
- [ ] **COMMIT:** `git add apps/api/src/competitions apps/miniprogram apps/admin-web/src/leagues/cups-page* && git commit -m "feat: label withdrawn teams in competition history"`

### Task 6: Add administrator withdrawal and recovery UI

**Files:**
- Modify: `apps/admin-web/src/leagues/teams-page.tsx`
- Modify: `apps/admin-web/src/leagues/teams-page.spec.tsx`
- Modify: `apps/admin-web/src/leagues/team-detail-page.tsx`
- Modify: `apps/admin-web/src/leagues/team-detail-page.spec.tsx`
- Modify: `apps/admin-web/src/leagues/team-shell-actions.tsx`

**Interfaces:**
- Consumes: admin `status=ACTIVE|ARCHIVED` list filter and archive/restore endpoints from Task 2.
- Produces: active/withdrawn tabs, lifecycle status display, reason-required confirmation modals, and read-only archived details.

- [ ] **RED:** Extend the teams page test to expect default `/teams?status=ACTIVE`, an “已退出” tab loading `status=ARCHIVED`, lifecycle status tags, active-only create form, and no archive rows mixed into the active table.
- [ ] **RUN:** Run the teams page spec and observe missing tabs/query behavior.
- [ ] **GREEN:** Add controlled tabs, reload by lifecycle status, retain search within the selected tab, and render creation only for active view.
- [ ] **RUN:** Rerun the teams page spec green.
- [ ] **RED:** Extend team detail tests: active shows “退出联赛”; archived hides settings, roster mutation, and shell actions and shows “恢复球队”; both modals require a nonblank reason, include current version and idempotency key, handle `VERSION_CONFLICT` by reloading, and prevent duplicate submission.
- [ ] **RUN:** Run the detail spec and observe missing lifecycle actions.
- [ ] **GREEN:** Implement the two confirmation flows and read-only archived detail, reusing the mutation-key hook and existing error presentation.
- [ ] **RUN:** Rerun detail/team-shell tests, admin-web typecheck, and admin-web build.
- [ ] **COMMIT:** `git add apps/admin-web/src/leagues && git commit -m "feat: manage withdrawn teams in admin"`

### Task 7: Prove end-to-end withdrawal, restoration, and history preservation

**Files:**
- Modify: `apps/api/test/league-teams.e2e-spec.ts`
- Modify: `apps/api/test/league-rosters.e2e-spec.ts`
- Modify: `apps/api/test/competitions.e2e-spec.ts`
- Modify: `docs/development/local-development.md`

**Interfaces:**
- Consumes: all earlier tasks.
- Produces: an automated operational proof that the same unchanged team can be archived, hidden/frozen, shown in history, restored, and used again.

- [ ] **RED:** Add one E2E scenario that creates an active team with roster, ledger, season entry, participant, published match, result, and standings; call archive; verify active admin list and personal list omission, user detail 404, archived admin list/detail visibility, and representative roster/finance/registration/result writes failing without row-count changes.
- [ ] **RUN:** Run the named E2E files and confirm the scenario fails before final wiring.
- [ ] **GREEN:** Fix only uncovered entry points with lifecycle service checks or explicit active predicates.
- [ ] **HISTORY:** In the same scenario, verify the published match/result/standings are unchanged and expose `ARCHIVED`, then verify the client presentation helper produces “已退赛”.
- [ ] **RESTORE:** Call restore and verify the same team id, number, shell, ownership, balance, season entries, matches, and results remain; active lists and one representative business write work again without reseeding.
- [ ] **RUN:** Run `pnpm --filter @efm/api test:e2e -- --runInBand apps/api/test/league-teams.e2e-spec.ts apps/api/test/league-rosters.e2e-spec.ts apps/api/test/competitions.e2e-spec.ts`.
- [ ] **DOCS:** Document lifecycle meaning, admin workflow, history behavior, restore behavior, and why direct SQL status changes are discouraged because they bypass reason/audit/idempotency.
- [ ] **FULL VERIFY:** From a clean working tree run `pnpm verify`; require lint, typecheck, contracts, API/client unit tests, all E2E tests, and all builds to pass.
- [ ] **COMMIT:** `git add apps/api/test docs/development/local-development.md && git commit -m "test: verify league team withdrawal end to end"`

### Task 8: Final review and delivery

**Files:**
- Review: all changes since the design commit `f1b41b2`

- [ ] **SPEC COVERAGE:** Compare the final diff against every goal, non-goal, lifecycle rule, concurrency rule, and acceptance criterion in the confirmed design.
- [ ] **SIDE-EFFECT AUDIT:** Search every service accepting `teamId`, `leagueTeamId`, `ownershipId`, `seasonEntryId`, registration id, participant id, or match id; prove archived-team checks happen before receipts, audits, ledgers, snapshots, and domain writes.
- [ ] **READ/WRITE SEPARATION:** Confirm historical queries never filter archived participants and operational selectors never include them.
- [ ] **TYPE CONSISTENCY:** Confirm all match/standings producers populate `teamLifecycleStatus`, all clients parse it, and generic team update no longer accepts lifecycle changes.
- [ ] **DIFF REVIEW:** Run `git diff --check f1b41b2..HEAD`, inspect `git diff --stat f1b41b2..HEAD`, and review every changed file for unrelated edits.
- [ ] **VERIFICATION:** Rerun `pnpm verify` from a clean working tree and record exact suite/test counts in the handoff.
- [ ] **FINAL COMMIT:** If review fixes are needed, commit them as `fix: close withdrawn team lifecycle gaps`; otherwise do not create an empty commit.
