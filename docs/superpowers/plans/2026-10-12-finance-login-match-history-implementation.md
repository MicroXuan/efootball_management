# Finance, Single Login, and Match History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add administrator-managed seasonal settlement amounts, one-click WeChat login, read-only current and historical season fixtures, and consistent league aliases across team identity surfaces.

**Architecture:** Extend the immutable finance ledger with an optional settlement category so a batch “current target values” endpoint can write audited debit or credit deltas without creating a second source of truth. Extend competition participant projections with season team identity, then render a season-scoped read-only fixture list in the mini-program. Keep the existing deep-link login page while making the profile login button execute authentication directly.

**Tech Stack:** TypeScript, Zod, NestJS, Prisma/MariaDB, React 19 + Ant Design, native WeChat mini-program, Jest, Vitest, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-12-finance-login-match-history-design.zh-CN.md`

## Global Constraints

- Work on `codex/league-center-banner` in `/Users/xiaoxuan/Documents/Codex_project/efootball_management`.
- Finance ledger rows remain immutable; edits create audited delta rows in one transaction.
- The settlement editor uses exactly nine categories in the spec order and treats blank values as zero.
- “用户名” on team surfaces means `LeagueTeam.ownerAlias`; `User.displayName` remains account profile data.
- “我的赛程” is read-only and defaults to all matches in the current season, including completed results.
- Do not stage `apps/api/.agents/`, `apps/api/.claude/`, `apps/api/.windsurf/`, or `apps/api/skills-lock.json`.

## Review Focus

- Re-saving unchanged settlement targets must create no ledger rows; test this in the finance service task.
- Lowering a target must create a credit delta and leave the computed target nonnegative; test this in the finance service task.
- Old finance rows with no settlement category must still parse and appear in ledger history; test this in the contracts and mini-program finance tasks.
- Historical season team snapshots may lack optional identity fields; test the match presenter fallback behavior in the competition service task.
- Repeated taps during WeChat login must issue only one login request and recover after failure; test this in the profile login task.

---

### Task 1: Finance settlement contracts and database field

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261012_finance_settlement_categories/migration.sql`
- Modify: `packages/contracts/src/league-roster.ts`
- Modify: `packages/contracts/src/league-economy.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`

**Interfaces:**
- Produces: `FinanceSettlementCategorySchema` with `TRANSACTION_AMOUNT`, `LUXURY_TAX`, `OFFSEASON_FEE`, `UNFINISHED_MATCH_PENALTY`, `PLAYER_AUCTION`, `TEAM_AUCTION`, `ROOKIE_SELECTION`, `INSTALLMENT_PAYMENT`, and `OTHER_ADJUSTMENT`.
- Produces: nullable `settlementCategory` on `FinanceLedgerEntrySchema` and Prisma `FinanceLedgerEntry`.
- Produces: `UpsertTeamFinanceSettlementRequestSchema` containing `leagueTeamId`, `seasonId`, all nine nonnegative target amounts, optional `note`, and required `reason`.
- Produces: `TeamFinanceSettlementItemSchema` and `TeamFinanceSettlementSummarySchema`; extend `TeamFinanceSummarySchema` with ordered `settlementItems` and `settlementTotalMinor`.

- [ ] **Step 1: Write failing contract tests** for all nine categories, the batch request limits, nullable legacy `settlementCategory`, ordered summary items, and signed integer totals.

- [ ] **Step 2: Run `pnpm --filter @efm/contracts test`** and verify failures identify the missing schemas and fields.

- [ ] **Step 3: Add the Prisma enum/nullable column and Zod schemas/types**, keeping legacy rows valid when `settlementCategory` is null.

- [ ] **Step 4: Add the SQL migration** that creates the enum-compatible MariaDB column as nullable and indexes `(league_team_id, season_id, settlement_category)` for aggregation.

- [ ] **Step 5: Run `pnpm db:generate && pnpm --filter @efm/contracts test && pnpm --filter @efm/contracts typecheck`** and verify all pass.

- [ ] **Step 6: Commit** with `feat: define seasonal finance settlements`.

### Task 2: Audited settlement target API

**Files:**
- Modify: `apps/api/src/league-economy/team-finance.service.ts`
- Modify: `apps/api/src/league-economy/team-finance.service.spec.ts`
- Create: `apps/api/src/league-economy/admin-finance-settlements.controller.ts`
- Modify: `apps/api/src/league-economy/league-economy.module.ts`
- Modify: `apps/api/src/league-economy/my-team-assets.controller.ts`
- Modify: `apps/api/test/league-economy.e2e-spec.ts`

**Interfaces:**
- Produces: `TeamFinanceService.getSettlementSummary(adminId, leagueId, teamId, seasonId)` for authorized managers.
- Produces: `TeamFinanceService.upsertSettlement(adminId, leagueId, input, idempotencyKey)` that locks/reads categorized rows, computes category deltas, writes debit increases or credit reductions, writes one audit record, and returns the new summary.
- Produces: `GET /v1/admin/leagues/:leagueId/finance-settlements?leagueTeamId=&seasonId=` and `PUT /v1/admin/leagues/:leagueId/finance-settlements`.
- Extends: owner finance response with ordered settlement aggregates and total.

- [ ] **Step 1: Write failing service tests** for initial targets, unchanged resubmission, lower-target credit delta, blank/zero categories, idempotency, authorization, cross-league IDs, and atomic rollback.

- [ ] **Step 2: Run `pnpm --filter @efm/api test -- team-finance.service.spec.ts`** and confirm the new tests fail for missing behavior.

- [ ] **Step 3: Implement settlement aggregation and delta writing** inside `TeamFinanceService`; map each settlement category to a stable ledger `type`, retain `settlementCategory`, and return categories in contract order.

- [ ] **Step 4: Add guarded GET/PUT controller routes** with Zod pipes, `Idempotency-Key`, manager scope, and existing visibility rules; register the controller in the module.

- [ ] **Step 5: Extend owner finance summary generation** so old uncategorized rows remain in `entries` while settlement summaries use only categorized rows.

- [ ] **Step 6: Add an e2e test** that saves nine values, reads them as admin and owner, reduces one value, and verifies audit and immutable ledger rows.

- [ ] **Step 7: Run `pnpm --filter @efm/api test -- team-finance.service.spec.ts` and the focused e2e test** and verify all pass.

- [ ] **Step 8: Commit** with `feat: add audited seasonal settlement API`.

### Task 3: Administrator settlement editor

**Files:**
- Modify: `apps/admin-web/src/rosters/ledger-page.tsx`
- Modify: `apps/admin-web/src/rosters/ledger-page.spec.tsx`

**Interfaces:**
- Consumes: Task 1 settlement request/response schemas and Task 2 GET/PUT routes.
- Produces: a “赛季结算金额” editor with season and team selectors, nine amount inputs, note, reason, current-value loading, and one idempotent save action.

- [ ] **Step 1: Write failing component tests** for loading league seasons and teams, selecting a team/season, reading current values, rendering all nine Chinese labels, converting blanks to zero, submitting the exact payload, and showing API errors.

- [ ] **Step 2: Run `pnpm --filter @efm/admin-web test -- src/rosters/ledger-page.spec.tsx`** and verify the tests fail before UI changes.

- [ ] **Step 3: Add season data loading and the settlement modal/card** using existing Ant Design patterns and `useMutationKey`; replace the raw season-ID experience for this workflow with a season dropdown.

- [ ] **Step 4: Refresh both settlement values and ledger rows after save** while preserving existing manual single-entry and fee-rule tools.

- [ ] **Step 5: Run the focused test and `pnpm --filter @efm/admin-web typecheck`** and verify both pass.

- [ ] **Step 6: Commit** with `feat: add admin settlement amount editor`.

### Task 4: Mini-program finance summary and league alias in team assets

**Files:**
- Modify: `apps/api/src/league-economy/team-assets.service.ts`
- Modify: `apps/api/src/league-economy/team-assets.service.spec.ts`
- Modify: `packages/contracts/src/league-economy.ts`
- Modify: `apps/miniprogram/miniprogram/pages/team-assets/team-assets.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/team-assets/team-assets.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/team-finance/team-finance.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/team-finance/team-finance.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/team-finance/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/team-finance/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/team-finance/team-finance.template.spec.ts` if present; otherwise create it.

**Interfaces:**
- Produces: `ownerAlias` in `TeamAssetOverviewSchema`, sourced from `LeagueTeam.ownerAlias`.
- Consumes: Task 2 `settlementItems` and `settlementTotalMinor` on `TeamFinanceSummary`.
- Produces: team asset identity `${teamNumber}-${teamName}-${ownerAlias}` and a fixed-order mini-program settlement list.

- [ ] **Step 1: Write failing API and view-model tests** proving `ownerAlias` wins over account `displayName`, and proving all nine settlement labels and the total render with signed correction handling.

- [ ] **Step 2: Run the focused API and mini-program tests** and confirm failures identify the missing alias and summary presentation.

- [ ] **Step 3: Select and return `LeagueTeam.ownerAlias` from the assets service**, add it to the contract, and update asset identity rendering without changing the real WeChat avatar source.

- [ ] **Step 4: Add the settlement summary block to team finance WXML/WXSS** before ledger details; preserve income, expense, net balance, and legacy rows.

- [ ] **Step 5: Run focused tests plus `pnpm --filter @efm/miniprogram typecheck`** and verify all pass.

- [ ] **Step 6: Commit** with `feat: show settlement breakdown and league alias`.

### Task 5: One-click profile WeChat login

**Files:**
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.wxss`
- Create or modify: `apps/miniprogram/miniprogram/pages/profile/profile-login.spec.ts`

**Interfaces:**
- Consumes: existing `auth.login(): Promise<void>` and `loadPage()`.
- Produces: `login()` on the profile page that authenticates directly, suppresses repeated taps through `loginLoading`, then reloads profile data in place.

- [ ] **Step 1: Write failing tests** for one tap calling `auth.login`, two rapid taps producing one request, success reloading `/me` and teams without navigation, and failure showing an error while re-enabling the button.

- [ ] **Step 2: Run the focused mini-program test** and confirm the current navigation-only implementation fails.

- [ ] **Step 3: Replace navigation with direct authentication**, add button loading/disabled presentation, and retain the standalone login page for protected deep links.

- [ ] **Step 4: Run focused tests and mini-program typecheck** and verify all pass.

- [ ] **Step 5: Commit** with `fix: complete WeChat login in one tap`.

### Task 6: Season-scoped match identity API

**Files:**
- Modify: `packages/contracts/src/competition.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`
- Modify: `apps/api/src/competitions/my-competitions.service.ts`
- Modify: `apps/api/src/competitions/my-competitions.service.spec.ts`
- Modify: any schedule presenter tests whose fixtures construct `CompetitionParticipantSummary`.

**Interfaces:**
- Extends: `CompetitionParticipantSummarySchema` with nullable `teamNumber` and `teamName`; retain `ownerDisplayName` for compatibility but define it as league alias for team participants.
- Changes: team participant projection uses `SeasonEntry.teamNumberSnapshot`, `teamNameSnapshot`, `teamLogoUrlSnapshot`, and `SeasonEntry.leagueTeam.ownerAlias`, with current team fallback for incomplete old rows.
- Keeps: `MyMatchListQuerySchema.seasonId`; the client stops setting `upcomingOnly` for the season history view so completed results are included.

- [ ] **Step 1: Write failing contract/service tests** for team number/name/alias/logo, completed official scores, selected historical season filtering, and missing snapshot fallbacks.

- [ ] **Step 2: Run contracts and focused API tests** and verify failures precede implementation.

- [ ] **Step 3: Extend participant includes and the `match()` presenter** to return the season identity and `ownerAlias`; keep individual competition fields nullable.

- [ ] **Step 4: Update impacted typed fixtures** without weakening schema validation.

- [ ] **Step 5: Run `pnpm --filter @efm/contracts test`, focused API tests, and API typecheck** and verify all pass.

- [ ] **Step 6: Commit** with `feat: expose season team identity in fixtures`.

### Task 7: Read-only current and historical season fixture UI

**Files:**
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/league-detail.template.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/matches.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/matches.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/my-matches.template.spec.ts` if present; otherwise create it.
- Modify: `apps/miniprogram/miniprogram/services/competitions.spec.ts`

**Interfaces:**
- Changes: league workspace navigation passes `leagueId` and `seasonId`, without `upcomingOnly=1`.
- Consumes: `leaguesApi.seasons(leagueId)` and `competitionsApi.myMatches({ seasonId, limit: 100 })`.
- Produces: a season picker defaulting to the passed current season and read-only match cards with two team identity columns and a centered score/“对阵” column.

- [ ] **Step 1: Write failing view-model/template tests** for current-season default, descending season options, picker changes, completed and pending match presentation, crests, number-team-alias labels, no submit/confirm buttons, and the three-column centered structure.

- [ ] **Step 2: Run focused mini-program tests** and verify the current future-only/action-button markup fails.

- [ ] **Step 3: Update navigation and page loading** to fetch seasons when a league ID exists, select current season by default, reload matches on picker change, and include all match states.

- [ ] **Step 4: Replace the action UI with read-only cards**; show official scores for completed games and “对阵” for pending games, with `entity-artwork` crests and symmetric team metadata.

- [ ] **Step 5: Add responsive WXSS** that preserves vertical and horizontal centering and truncates long labels without shifting the center column.

- [ ] **Step 6: Run focused tests and mini-program typecheck** and verify all pass.

- [ ] **Step 7: Commit** with `feat: add historical season fixture viewer`.

### Task 8: Full verification and remote delivery

**Files:**
- Review all files changed by Tasks 1–7.

**Interfaces:**
- Produces: a verified `codex/league-center-banner` commit series pushed to `origin/codex/league-center-banner`.

- [ ] **Step 1: Apply the new migration to the local development database** with `pnpm db:migrate:dev` when the configured database is available; otherwise verify migration SQL and report the environment limitation.

- [ ] **Step 2: Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`** and resolve only concrete failures caused by this work.

- [ ] **Step 3: Run `pnpm --filter @efm/api test:e2e`** when the test database is available; report any external database limitation precisely.

- [ ] **Step 4: Run `git diff --check`, inspect the complete diff and status**, and confirm personal untracked configuration directories are not staged.

- [ ] **Step 5: Push `codex/league-center-banner` to origin** and verify local HEAD equals the remote tracking branch.
