# Team Salary Caps and Public Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make salary caps required, admin-owned values per team and let participants inspect other teams' public rosters in a stronger asset UI.

**Architecture:** Add a team cap with confirmation metadata, backfill legacy teams from the effective league cap, and centralize cap reads for roster/market mutations. Keep owner assets writable and expose a separate, minimal read-only public projection for other teams.

**Tech Stack:** Prisma/MySQL, NestJS, Zod, React/Ant Design, native WeChat mini-program, Jest/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-season-calendar-nominations-team-assets-transfers-design.zh-CN.md`

## Global Constraints

- New teams require a positive integer cap; only scoped admins may confirm/change it. Mini-program users never mutate caps.
- Legacy teams use their old effective league cap while awaiting confirmation; a team without any cap cannot add players or raise salary.
- Salary tiers still calculate individual salary, but all current compliance and transaction checks use the target team's cap.
- Lowering a cap can produce OVER_CAP; never remove players automatically.
- Preserve unrelated dirty workspace changes.

## Review Focus

- A migrated legacy team with no historical rule remains unset and cannot acquire players (Task 1/2 tests).
- Transfer uses the source and destination's different caps, not one shared quote cap (Task 2 test).
- An admin lowering a cap below current salary sees projected OVER_CAP and an audit record (Task 3 test).
- A user viewing another team's assets receives no owner-only version token or private user number (Task 4 test).
- An outside-window release remains rejected by the API even if a stale client renders an enabled button (Task 5 regression test).

---

## File structure

- Add cap fields to `LeagueTeam`; expose admin fields in `packages/contracts/src/league-team.ts` and asset fields in `league-economy.ts`.
- Put cap lookup/update logic in `apps/api/src/league-rosters/team-salary-cap.service.ts`; integrate existing roster/market services instead of duplicating cap checks.
- Add a public asset read model beside existing owner assets, with its own response contract and controller route. Mini-program team directory and assets pages stay separate.

### Task 1: Team cap storage, migration, and creation requirement

**Files:** Modify `apps/api/prisma/schema.prisma`, `packages/contracts/src/league-team.ts`, `apps/api/src/league-teams/league-teams.service.ts`, `.spec.ts`; create `apps/api/prisma/migrations/202610200002_team_salary_caps/migration.sql` and `apps/api/src/league-rosters/team-salary-cap.service.{ts,spec.ts}`.

**Interfaces:** `LeagueTeam.salaryCapMinor: number|null`, `salaryCapConfirmedAt: Date|null`; `TeamSalaryCapService.requireWithClient(tx, teamId): Promise<number>` throws `TEAM_SALARY_CAP_UNSET` for null. `CreateLeagueTeamRequestSchema` requires positive `salaryCapMinor`.

- [ ] **Step 1: Write failing tests.** New team without cap is rejected; legacy row backfills the latest effective league cap and remains unconfirmed; a league with no rule leaves null; `requireWithClient` returns cap or throws.
- [ ] **Step 2: Run red.** `pnpm --filter @efm/api test --runInBand src/league-teams/league-teams.service.spec.ts src/league-rosters/team-salary-cap.service.spec.ts` and contracts test.
- [ ] **Step 3: Implement.** Add migration and per-team cap lookup; backfill with existing effective rule, preserving zero-change transaction behavior and null for no rule. Generate Prisma client.
- [ ] **Step 4: Run green.** Same tests, `pnpm --filter @efm/api prisma:generate`, contracts test and API typecheck.
- [ ] **Step 5: Commit** Task 1 files with `feat: store team-specific salary caps`.

### Task 2: Replace global-cap mutation checks

**Files:** Modify `apps/api/src/league-rosters/{roster-transactions.service.ts,salary-recalculation.service.ts,salary-rules.service.ts,admin-roster-queries.service.ts}`, `apps/api/src/player-market/{player-market-review.service.ts,team-player-release.service.ts}`, `apps/api/src/league-teams/league-teams.service.ts` and corresponding specs; wire `TeamSalaryCapService` through relevant modules.

**Interfaces:** All current cap checks call `TeamSalaryCapService.requireWithClient(tx, leagueTeamId)`; individual wages still use salary-rule quote. Existing transaction response `salaryCapMinor` becomes the specific team's cap.

- [ ] **Step 1: Write failing tests.** Buying and forced transfer use applicant cap; direct transfer checks target cap and recomputes source/target status with separate caps; salary rule publication recalculates wage but not cap; null cap prevents additions; release remains allowed to reduce salary.
- [ ] **Step 2: Run red.** Targeted roster transaction, salary rule/recalculation, market review/release, and team summary Jest specs.
- [ ] **Step 3: Implement.** Replace every active global-cap usage with team lookup; leave old league cap in historical rule versions only and remove its editing control in Task 3. Keep status updates transactionally aligned.
- [ ] **Step 4: Run green.** Repeat focused suites and API/contracts typechecks; search active code for remaining `quote.salaryCapMinor` usages and account for each.
- [ ] **Step 5: Commit** Task 2 files with `feat: enforce salary caps per team`.

### Task 3: Admin confirmation/edit and impact preview

**Files:** Modify `packages/contracts/src/league-team.ts`, `apps/api/src/league-teams/{admin-league-teams.controller.ts,league-teams.service.ts,league-teams.service.spec.ts}`, `apps/admin-web/src/leagues/{team-detail-page.tsx,team-detail-page.spec.tsx,teams-page.tsx,salary-rules-page.tsx,salary-rules-page.spec.tsx}`.

**Interfaces:** `PATCH /admin/leagues/:leagueId/teams/:teamId` accepts `salaryCapMinor`, `salaryCapConfirmed: true`, `expectedVersion`, `reason`; response exposes cap and confirmation. Team detail displays current salary, cap and projected status before save.

- [ ] **Step 1: Write failing tests.** Only scoped admin can confirm/change; positive cap and reason required for updates; version conflict preserves prior value; lowering cap below active salary returns OVER_CAP preview and audit metadata; team list flags unconfirmed rows.
- [ ] **Step 2: Run red.** Targeted league-team Jest and admin page Vitest.
- [ ] **Step 3: Implement.** Use existing team update receipt/version patterns; admin form has required cap, explicit confirm action, impact preview and history cue. Salary rules page edits wage tiers only; its publish API internally carries forward the prior legacy cap field (or 0 if no prior rule) for historical schema compatibility, but never reads that field for current team decisions.
- [ ] **Step 4: Run green.** Focused tests, admin/API typechecks.
- [ ] **Step 5: Commit** Task 3 files with `feat: manage salary caps on teams`.

### Task 4: Read-only public team directory/assets

**Files:** Modify `packages/contracts/src/league-economy.ts`, `apps/api/src/league-economy/{team-assets.service.ts,team-assets.service.spec.ts,league-economy.module.ts}`; create `apps/api/src/league-economy/public-team-assets.controller.ts`; modify `apps/miniprogram/miniprogram/services/economy.ts`, `services/league-teams.ts` and tests.

**Interfaces:** `GET /me/leagues/:leagueId/teams` returns minimal active team directory rows; `GET /me/leagues/:leagueId/teams/:teamId/public-assets` returns `PublicTeamAssets` without `ownershipId`, `ownershipVersion`, `ownerPublicUserNo`, finance details or write capabilities. Owner endpoint adds `salaryCapMinor`, `salaryCapConfirmed`, and `nextTransferWindowStartAt: string|null`.

- [ ] **Step 1: Write failing tests.** Participant can see another active team in same visible league; cross-league/deleted scope denied; public JSON lacks owner-only fields; both projections show that team's cap and active salary.
- [ ] **Step 2: Run red.** Targeted team-assets Jest and economy service Vitest.
- [ ] **Step 3: Implement.** Reuse valuation/roster projection internally but build separate public DTO; expose minimal team directory fields and public asset route, preserving owner endpoint security.
- [ ] **Step 4: Run green.** Targeted tests, contracts/API/miniprogram typechecks.
- [ ] **Step 5: Commit** Task 4 files with `feat: expose public team rosters`.

### Task 5: Asset UI, team navigation, and release boundary

**Files:** Modify `apps/miniprogram/miniprogram/pages/team-assets/{index.ts,index.wxml,index.wxss,team-assets.viewmodel.ts,*.spec.ts}`, `pages/league-detail/{index.ts,index.wxml}`, `pages/league-team-detail/{index.ts,index.wxml}`, `pages/my-league-teams/index.ts`, `app.json`; create `pages/league-team-directory/index.{ts,wxml,wxss,json}` and tests.

**Interfaces:** `team-assets` accepts `leagueId` plus `teamId`, distinguishes `isOwner`; public page never calls owner-only endpoint. `teamAssetsView` presents `salaryCopy = '<salary> / <cap>'` and `overCap`.

- [ ] **Step 1: Write failing tests.** Navigation to other teams works; owner and visitor render distinct actions; crest prominent, salary/cap and roster count precede valuation; unavailable cap says “待管理员设置”; out-of-window release button is disabled with next opening date when known.
- [ ] **Step 2: Run red.** Targeted team-assets template/viewmodel Vitest and page tests.
- [ ] **Step 3: Implement.** Use the existing dark football palette with one stronger crest treatment; adjust hierarchy without changing card data. Derive release availability from API and keep server-side window check.
- [ ] **Step 4: Run green.** Targeted mini tests, mini typecheck, and release service regression tests; inspect in WeChat developer tools.
- [ ] **Step 5: Commit** Task 5 files with `feat: browse team assets and salary caps`.

## Final verification

- [ ] Run focused contract/API/admin/mini suites, then `pnpm typecheck` and `pnpm build`. Report any full-suite stall or external integration limit honestly.
- [ ] Confirm migration on a disposable database with and without an existing league rule; never run an unreviewed migration against user data.
