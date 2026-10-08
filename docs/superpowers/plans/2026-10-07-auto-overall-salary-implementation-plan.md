# Auto-Overall Salary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace DT-based roster salary calculation with automatic-build maximum overall while preserving raw PESDATA DT data and existing salary history.

**Architecture:** Keep `PlayerCardAutoBuild.dtRating` as optional source metadata, but move salary tiers, ownership snapshots, transaction validation, recalculation, recommendation ordering, and UI copy to `maxOverall`. Introduce a guarded Prisma migration that backfills ownership snapshots from each held card's latest automatic build without changing existing salary amounts.

**Tech Stack:** TypeScript, NestJS, Prisma/MySQL, Zod, React/Ant Design, WeChat Mini Program, Jest, Vitest

**Spec:** `docs/superpowers/specs/2026-10-07-auto-overall-salary-design.zh-CN.md`

## Global Constraints

- Work directly on `codex/league-presentation-admin-binding`; do not create a worktree.
- Preserve untracked files under `apps/api/.agents/`, `apps/api/.claude/`, `apps/api/.windsurf/`, and `apps/api/skills-lock.json`.
- Keep `PlayerCardAutoBuild.dtRating` nullable and unchanged for source-data compatibility.
- Do not silently change existing `salaryMinor`, salary-rule references, or historical transactions during migration.
- Do not use DT for salary, salary-cap validation, roster eligibility, recommendation ordering, or primary roster UI.
- User-facing and audit copy must name the concrete operation; never use “其他后台操作”.

## Review Focus

- A card with `maxOverall = 95` and `dtRating = 91` must receive the overall-95 salary.
- A card with `maxOverall = 95` and `dtRating = null` must remain eligible for acquisition and upgrade.
- Migration must refuse ownership rows whose held card has no automatic build and identify those ownership IDs before schema enforcement.
- Existing roster salaries must remain unchanged until an explicit recalculation.
- A later source sync must not change an ownership's `maxOverallSnapshot` or historical salary.

---

### Task 1: Rename salary contracts and persist overall snapshots

**Files:**
- Modify: `packages/contracts/src/league-roster.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261007090000_auto_overall_salary/migration.sql`

**Interfaces:**
- Produces: `OverallRatingSchema`, salary tiers shaped as `{ minOverall, maxOverall, salaryMinor }`, roster ownership responses with `maxOverall`, and Prisma fields `LeagueSalaryTier.minOverall`, `LeagueSalaryTier.maxOverall`, `LeaguePlayerOwnership.maxOverallSnapshot`.
- Preserves: nullable `PlayerCardAutoBuild.dtRating` and nullable legacy `LeaguePlayerOwnership.dtRatingSnapshot`.

- [ ] **Step 1: Write failing contract tests**

Update the salary-tier contract test to accept continuous `minOverall/maxOverall` ranges through 120, reject a gap or overlap, reject legacy `minDtRating/maxDtRating`, and assert roster schemas no longer require `dtRating`.

- [ ] **Step 2: Run the contract test to verify RED**

Run: `pnpm --filter @efm/contracts test`

Expected: FAIL because the contract still exposes DT-named salary fields and roster DT fields.

- [ ] **Step 3: Implement the shared contract rename**

Replace DT-named tier fields and validation paths/messages with overall-named equivalents. Remove `dtRating` from `RosterEntrySchema`, `RosterMutationOwnershipSchema`, and `RosterCandidateCardSchema`; retain `maxOverall` as the roster-facing rating.

- [ ] **Step 4: Add the Prisma schema and migration**

Rename salary-tier columns to `min_overall/max_overall`, add nullable `max_overall_snapshot`, and backfill it from the latest `player_card_auto_builds` row ordered by `calculated_at DESC, id DESC`. Add a temporary MySQL procedure that selects the first ownership whose new snapshot remains null and raises SQLSTATE `45000` with that ownership ID in the message; call and drop the procedure before changing the column to non-null. Retain `dt_rating_snapshot` as nullable. The migration must leave `salary_minor` and `salary_rule_version_id` untouched.

- [ ] **Step 5: Verify contracts and Prisma generation GREEN**

Run: `pnpm --filter @efm/contracts test && pnpm --filter @efm/api prisma:generate && pnpm --filter @efm/api typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts apps/api/prisma
git commit -m "refactor(salary): model automatic overall tiers"
```

### Task 2: Calculate salary exclusively from automatic-build overall

**Files:**
- Modify: `apps/api/src/league-rosters/salary-rules.service.spec.ts`
- Modify: `apps/api/src/league-rosters/salary-rules.service.ts`
- Modify: `apps/api/src/league-rosters/salary-recalculation.service.ts`

**Interfaces:**
- Consumes: `{ minOverall, maxOverall, salaryMinor }` tiers and `maxOverallSnapshot` from Task 1.
- Produces: `quote(leagueId, overall, at)` and `quoteVersionWithClient(client, leagueId, salaryRuleVersionId, overall)` whose returned rating field is `maxOverall`.

- [ ] **Step 1: Write failing salary-rule tests**

Rename existing fixtures to overall fields and add a case where an ownership has `maxOverallSnapshot = 95`, legacy `dtRatingSnapshot = 91`, and the preview must use the overall-95 tier. Assert preview does not mutate the stored salary or rule version.

- [ ] **Step 2: Run the salary-rule test to verify RED**

Run: `pnpm --filter @efm/api exec jest --config jest.config.ts src/league-rosters/salary-rules.service.spec.ts --runInBand`

Expected: FAIL because lookup and preview still use DT fields.

- [ ] **Step 3: Implement overall-based quoting and recalculation**

Rename the tier lookup helper parameter to `overall`, use `minOverall/maxOverall`, update concrete error details, and make preview and explicit recalculation read `ownership.maxOverallSnapshot` only.

- [ ] **Step 4: Verify salary-rule tests GREEN**

Run: `pnpm --filter @efm/api exec jest --config jest.config.ts src/league-rosters/salary-rules.service.spec.ts --runInBand`

Expected: PASS with a migrated test database.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/league-rosters/salary-rules.service.ts apps/api/src/league-rosters/salary-rules.service.spec.ts apps/api/src/league-rosters/salary-recalculation.service.ts
git commit -m "feat(salary): quote by automatic overall"
```

### Task 3: Move roster transactions and queries off DT

**Files:**
- Modify: `apps/api/src/league-rosters/roster-transactions.service.spec.ts`
- Modify: `apps/api/src/league-rosters/roster-transactions.service.ts`
- Modify: `apps/api/src/league-rosters/admin-roster-queries.service.ts`
- Modify: `apps/api/src/league-teams/league-teams.service.ts`
- Modify: `apps/api/test/league-rosters.e2e-spec.ts`

**Interfaces:**
- Consumes: overall-based salary quotes and `maxOverallSnapshot` from Tasks 1–2.
- Produces: acquisition, transfer, upgrade, roster views, and mini-program team details that use snapshot `maxOverall`; candidates remain eligible when `dtRating` is null.

- [ ] **Step 1: Write failing transaction and E2E tests**

Add a card fixture with `maxOverall = 95` and `dtRating = null`; assert acquisition succeeds, stores `maxOverallSnapshot = 95`, and uses the overall-95 salary. Add an upgrade case where DT differs from max overall and assert the new salary follows max overall. Replace the old `PLAYER_DT_RATING_MISSING` expectation with successful behavior.

- [ ] **Step 2: Run focused transaction tests to verify RED**

Run: `pnpm --filter @efm/api exec jest --config jest.config.ts src/league-rosters/roster-transactions.service.spec.ts --runInBand`

Expected: FAIL because transactions still reject null DT and persist/quote DT.

- [ ] **Step 3: Implement the transaction and query changes**

Remove DT-null rejection, quote with `build.maxOverall`, persist `maxOverallSnapshot` on acquisition and upgrade, preserve it across team transfers, and return snapshot max overall from roster queries. Candidate salary previews must use `build.maxOverall`. Remove roster-facing DT from query responses.

- [ ] **Step 4: Verify transaction tests GREEN**

Run: `pnpm --filter @efm/api exec jest --config jest.config.ts src/league-rosters/roster-transactions.service.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Run the roster E2E test**

Run: `pnpm --filter @efm/api test:e2e -- --runInBand test/league-rosters.e2e-spec.ts`

Expected: PASS with a migrated test database.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/league-rosters apps/api/src/league-teams/league-teams.service.ts apps/api/test/league-rosters.e2e-spec.ts
git commit -m "feat(roster): price held cards by automatic overall"
```

### Task 4: Remove DT from recommendation ordering

**Files:**
- Modify: `apps/api/src/player-builds/player-build-selector.spec.ts`
- Modify: `apps/api/src/player-builds/player-build-selector.ts`
- Modify: `apps/api/src/player-builds/player-builds.service.spec.ts`
- Modify: `apps/api/src/player-builds/player-builds.service.ts`

**Interfaces:**
- Produces: recommendation ordering `maxOverall:desc`, `releaseDate:desc:nulls-last`, `externalId:asc` and matching `selectionReason`.
- Preserves: raw `dtRating` storage on `PlayerCardAutoBuild`.

- [ ] **Step 1: Write failing selector tests**

Change the equal-overall case so an older card with higher DT loses to a newer card with lower or missing DT. Assert `selectionReason.ordering` and `winner` contain no DT ordering dependency.

- [ ] **Step 2: Run the selector test to verify RED**

Run: `pnpm --filter @efm/api exec jest --config jest.config.ts src/player-builds/player-build-selector.spec.ts --runInBand`

Expected: FAIL because DT is still the second comparator.

- [ ] **Step 3: Implement the three-key selector**

Remove `dtRating` from `BestCardCandidate` only where it exists solely for ordering, remove it from `selectionReason`, and update the service mapping while leaving build persistence untouched.

- [ ] **Step 4: Verify player-build tests GREEN**

Run: `pnpm --filter @efm/api exec jest --config jest.config.ts src/player-builds/player-build-selector.spec.ts src/player-builds/player-builds.service.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/player-builds
git commit -m "refactor(players): rank recommended cards without DT"
```

### Task 5: Update the admin experience to automatic-overall language

**Files:**
- Modify: `apps/admin-web/src/leagues/salary-rules-page.spec.tsx`
- Modify: `apps/admin-web/src/leagues/salary-rules-page.tsx`
- Modify: `apps/admin-web/src/rosters/acquire-player-drawer.spec.tsx`
- Modify: `apps/admin-web/src/rosters/acquire-player-drawer.tsx`
- Modify: `apps/admin-web/src/rosters/upgrade-card-drawer.spec.tsx`
- Modify: `apps/admin-web/src/rosters/upgrade-card-drawer.tsx`
- Modify: `apps/admin-web/src/rosters/roster-page.tsx`

**Interfaces:**
- Consumes: overall-named contracts and DT-free roster/candidate responses.
- Produces: salary-rule, acquisition, upgrade, and roster UI that exposes automatic overall as the sole pricing rating.

- [ ] **Step 1: Write failing UI tests**

Assert the salary page renders “工资帽与自动加点总评档位” and “自动加点总评范围”; assert a candidate with `maxOverall` and no DT remains selectable; assert roster and upgrade views contain no `DT` label or missing-DT error.

- [ ] **Step 2: Run focused admin tests to verify RED**

Run: `pnpm --filter @efm/admin-web test -- src/leagues/salary-rules-page.spec.tsx src/rosters/acquire-player-drawer.spec.tsx src/rosters/upgrade-card-drawer.spec.tsx`

Expected: FAIL on legacy labels and DT gating.

- [ ] **Step 3: Implement the UI changes**

Rename tier fields and labels, remove DT columns/text, remove DT-based disabled states, and use `maxOverall` plus salary availability for concrete operation feedback.

- [ ] **Step 4: Verify admin tests GREEN**

Run: `pnpm --filter @efm/admin-web test`

Expected: all admin-web test files pass with no DT business copy.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src/leagues apps/admin-web/src/rosters
git commit -m "feat(admin): present automatic-overall salary rules"
```

### Task 6: Update read-only mini-program and operational documentation

**Files:**
- Modify: `apps/miniprogram/miniprogram/pages/league-team-detail/index.wxml`
- Create: `apps/miniprogram/miniprogram/pages/league-team-detail/league-team-detail.template.spec.ts`
- Modify: `docs/development/admin-web-local-development.zh-CN.md`
- Modify: `docs/superpowers/specs/2026-09-27-league-team-admin-system-design.zh-CN.md`

**Interfaces:**
- Consumes: roster entries containing snapshot `maxOverall` and salary.
- Produces: read-only roster copy and maintained documentation aligned with automatic-overall pricing.

- [ ] **Step 1: Write or update the mini-program assertion**

Add a template regression test that reads `index.wxml`, requires the roster line to contain `自动加点总评 {{item.maxOverall}}`, and rejects `DT {{item.dtRating}}`.

- [ ] **Step 2: Run mini-program tests to verify RED**

Run: `pnpm --filter @efm/miniprogram test`

Expected: FAIL if the new copy assertion is introduced while the template still renders DT.

- [ ] **Step 3: Update template and documentation**

Remove DT from the mini-program roster line. Reconcile the original league-team design and local verification guide so they consistently describe automatic-overall salary tiers, snapshot behavior, and explicit recalculation.

- [ ] **Step 4: Verify mini-program tests GREEN**

Run: `pnpm --filter @efm/miniprogram test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/miniprogram docs/development docs/superpowers/specs/2026-09-27-league-team-admin-system-design.zh-CN.md
git commit -m "docs: align roster salary language with automatic overall"
```

### Task 7: Whole-branch verification and delivery

**Files:**
- Review only: all files changed by Tasks 1–6

**Interfaces:**
- Produces: a verified branch ready to push.

- [ ] **Step 1: Scan for remaining DT business dependencies**

Run: `rg -n "minDtRating|maxDtRating|dtRatingSnapshot|PLAYER_DT_RATING_MISSING|DT 工资|DT 档位" apps packages docs/development`

Expected: only intentionally retained migration compatibility references or historical design discussion remain.

- [ ] **Step 2: Run formatting and static verification**

Run: `git diff --check && pnpm lint && pnpm typecheck`

Expected: PASS.

- [ ] **Step 3: Run all tests**

Run: `pnpm test && pnpm test:e2e`

Expected: PASS against a database migrated to the new schema. If the configured database is stale, report the exact migration/schema failures separately and retain focused passing evidence.

- [ ] **Step 4: Build all workspaces**

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 5: Review the final diff and push**

Confirm only intended tracked changes are committed, preserve the existing untracked tool files, then push `codex/league-presentation-admin-binding`.
