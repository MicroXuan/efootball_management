# Season Fixture Browser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace league todo/next-opponent presentation with an authenticated, searchable, read-only list of every published fixture in the selected season.

**Architecture:** Add a contract-first season-fixture query and a dedicated Nest controller/service with approved-entry authorization and keyset pagination. Rework the existing `my-matches` route into the season fixture browser, then simplify the league workspace response and tile so it only links to that browser.

**Tech Stack:** Zod contracts, NestJS, Prisma/MariaDB, native WeChat Mini Program, Jest, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-player-presentation-and-season-fixtures-design.md`

## Global Constraints

- The list covers all matches in every published stage of the selected season, not only the signed-in team.
- Access requires an active approved season entry owned by the caller and matching `leagueId`/`seasonId`.
- Status derives only from official-result presence: `UPCOMING` has none and `FINISHED` has one.
- Team search matches current/snapshot display names, short names, and team-number text; never private IDs.
- Ordering is unfinished first, then round, match number, and stable ID; cursors must prevent duplicates/omissions.
- Fixture cards are read-only and never navigate to a score page.
- Invalid/stale cursors use the existing structured validation error and leave current UI results visible with retry.

## Review Focus

- A valid entry in another league or season must not authorize this query; Task 2 pins this.
- Archived opponents must remain visible through snapshots and carry an archived label; Tasks 2 and 3 pin this.
- Team number `01` and normalized whitespace/case in names must search predictably without matching UUIDs; Task 2 pins this.
- A page boundary between UPCOMING and FINISHED must neither duplicate nor omit a match; Task 2 pins this.
- Changing season/filter during an in-flight request must not append stale results, while a load-more error must preserve current items; Task 3 pins this.

---

### Task 1: Define the Fixture Query Contract

**Files:**
- Modify: `packages/contracts/src/competition.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`

**Interfaces:**
- Consumes: `CompetitionMatchResponseSchema`, `CompetitionSummarySchema`, `ResourceIdSchema`.
- Produces: `SeasonFixtureStatusSchema`, `SeasonFixtureListQuerySchema`, `SeasonFixtureListItemSchema`, `SeasonFixtureListResponseSchema` and inferred `SeasonFixtureStatus`, `SeasonFixtureListQuery`, `SeasonFixtureListItem`, `SeasonFixtureListResponse`.

- [ ] **Step 1: Write failing schema tests**

Assert defaults `status: ALL` and `limit: 20`, accepted statuses `ALL|UPCOMING|FINISHED`, trimmed optional `team`, limit bounds `1..100`, optional cursor, and response items shaped as `{ competition, match }` with `nextCursor`.

- [ ] **Step 2: Run contract tests and verify red**

Run: `pnpm --filter @efm/contracts test`

Expected: FAIL because the schemas/types are missing.

- [ ] **Step 3: Add schemas and exports**

Define the exact names above in `competition.ts`; keep the existing participant score contracts for database/history compatibility unless a later compiler pass proves an export is now entirely unused.

- [ ] **Step 4: Run contract tests and verify green**

Run: `pnpm --filter @efm/contracts test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/competition.ts packages/contracts/src/contracts.spec.ts
git commit -m "feat: define season fixture query contract"
```

### Task 2: Implement Authorized Season-Wide Fixture Query

**Files:**
- Create: `apps/api/src/competitions/season-fixtures.controller.ts`
- Create: `apps/api/src/competitions/season-fixtures.service.ts`
- Create: `apps/api/src/competitions/season-fixtures.service.spec.ts`
- Create: `apps/api/src/competitions/season-fixtures.controller.spec.ts`
- Modify: `apps/api/src/competitions/competitions.module.ts`
- Create or modify: `apps/api/src/competitions/competitions.module.spec.ts`

**Interfaces:**
- Consumes: `SeasonFixtureListQuery` and existing match response fields.
- Produces: `SeasonFixturesService.list(userId: string, leagueId: string, seasonId: string, query: SeasonFixtureListQuery): Promise<SeasonFixtureListResponse>` and authenticated `GET /me/leagues/:leagueId/seasons/:seasonId/fixtures`.

- [ ] **Step 1: Write failing authorization/filter/pagination tests**

Cover active approved access, rejected/withdrawn/inactive-team denial, league-season mismatch, only published stages, all three statuses, normalized name/short-name/team-number search, no private-ID search, archived snapshots, empty results, invalid cursor error, and two-page traversal across the unfinished/finished boundary with no duplicate or omission.

- [ ] **Step 2: Run focused API tests and verify red**

Run: `pnpm --filter @efm/api test -- --runInBand src/competitions/season-fixtures.service.spec.ts src/competitions/season-fixtures.controller.spec.ts`

Expected: FAIL because the service/controller do not exist.

- [ ] **Step 3: Implement service, cursor, and controller**

Validate league/season visibility and the caller's approved active entry. Query published stages for the season; filter by official-result presence and public team identity fields. Encode/decode a versioned opaque cursor containing `phase`, `roundNumber`, `matchNumber`, and `id`; throw `CompetitionError('INVALID_FIXTURE_CURSOR', ..., 400)` on malformed or filter-incompatible cursors. Return `limit + 1` semantics and map archived participants from snapshots.

- [ ] **Step 4: Register and verify the endpoint**

Run: `pnpm --filter @efm/api test -- --runInBand src/competitions/season-fixtures.service.spec.ts src/competitions/season-fixtures.controller.spec.ts src/competitions/competitions.module.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/competitions/season-fixtures.controller.ts apps/api/src/competitions/season-fixtures.service.ts apps/api/src/competitions/season-fixtures.service.spec.ts apps/api/src/competitions/season-fixtures.controller.spec.ts apps/api/src/competitions/competitions.module.ts apps/api/src/competitions/competitions.module.spec.ts
git commit -m "feat: add season-wide fixture query"
```

### Task 3: Rebuild the Mini-Program Fixture Page

**Files:**
- Modify: `apps/miniprogram/miniprogram/services/competitions.ts`
- Modify: `apps/miniprogram/miniprogram/services/competitions.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/matches.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/matches.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/my-matches.template.spec.ts`
- Create or modify: `apps/miniprogram/miniprogram/pages/my-matches/my-matches.page.spec.ts`

**Interfaces:**
- Consumes: Task 2 endpoint and `SeasonFixtureListResponse`.
- Produces: `seasonFixturesPath(leagueId, seasonId, options)` and `competitionsApi.seasonFixtures(...)`; page state `teamKeyword`, `status`, `items`, `nextCursor`, `loadingMore`, and request-generation guard.

- [ ] **Step 1: Write failing path, view-model, template, and page-state tests**

Assert URL encoding for league/season/team/status/cursor/limit; read-only card copy `未开始`/`已结束`; official score display; archived label; title “全部赛程”; season picker, search action, three status controls, load-more and filter-specific empty states; no `bindtap="openMatch"`, score action, deadline, or match-result route. Simulate season/filter reset and stale response suppression; assert load-more errors preserve items.

- [ ] **Step 2: Run focused mini-program tests and verify red**

Run: `pnpm --filter @efm/miniprogram test -- miniprogram/services/competitions.spec.ts miniprogram/pages/my-matches`

Expected: FAIL because the page still calls `/me/matches` and exposes score actions.

- [ ] **Step 3: Implement the read-only browser**

Use explicit search submission and status chips. On season/team/status change increment a request generation, clear cursor/items, and fetch page one; on load more append only if generation and filters still match. Keep existing items on pagination errors and show retry. Remove `openMatch` and all dispute/action/deadline view-model dependencies.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm --filter @efm/miniprogram test -- miniprogram/services/competitions.spec.ts miniprogram/pages/my-matches && pnpm --filter @efm/miniprogram typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/miniprogram/miniprogram/services/competitions.ts apps/miniprogram/miniprogram/services/competitions.spec.ts apps/miniprogram/miniprogram/pages/my-matches
git commit -m "feat: add season fixture browser"
```

### Task 4: Simplify the League Workspace

**Files:**
- Modify: `packages/contracts/src/league.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`
- Modify: `apps/api/src/league-workspace/league-workspace.service.ts`
- Modify: `apps/api/src/league-workspace/league-workspace.service.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/detail.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/detail.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/league-detail.template.spec.ts`

**Interfaces:**
- Consumes: Task 3 browser route `/pages/my-matches/index?leagueId=...&seasonId=...`.
- Produces: `LeagueWorkspaceResponse` without `nextMatch`; `workspaceSummary` with stable schedule copy `全部赛程` and `按队伍和状态查找比赛`.

- [ ] **Step 1: Write failing contract/service/template assertions**

Assert `nextMatch` is absent from the schema and service result, the service no longer queries participant matches, the template contains neither “当前联赛待办” nor “下一场”, the schedule tile shows the fixed copy and routes to all fixtures, and league detail no longer loads or opens the league-specific action center.

- [ ] **Step 2: Run focused tests and verify red**

Run: `pnpm --filter @efm/contracts test && pnpm --filter @efm/api test -- --runInBand src/league-workspace/league-workspace.service.spec.ts && pnpm --filter @efm/miniprogram test -- miniprogram/pages/league-detail`

Expected: FAIL while `nextMatch` and todo presentation remain.

- [ ] **Step 3: Remove next-match query/contract and todo UI**

Delete `nextMatch` from the contract and API response; remove the match query/sort from workspace service. Remove `leagueAttentionCount`, `loadActionCenterSummary`, `openActionCenter`, the todo markup/styles, and dynamic next-match copy. Retain contextual market/auction badges and global profile action center. Rename `openUpcomingMatches` to `openFixtures`.

- [ ] **Step 4: Verify workspace and cross-package types**

Run: `pnpm --filter @efm/contracts test && pnpm --filter @efm/api test -- --runInBand src/league-workspace/league-workspace.service.spec.ts && pnpm --filter @efm/miniprogram test -- miniprogram/pages/league-detail && pnpm --filter @efm/miniprogram typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/league.ts packages/contracts/src/contracts.spec.ts apps/api/src/league-workspace apps/miniprogram/miniprogram/pages/league-detail
git commit -m "feat: link league workspace to all fixtures"
```

### Task 5: Cross-System Verification

**Files:**
- Modify only files required by failures directly caused by Tasks 1-4.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a fully verified contract/API/admin/mini-program integration.

- [ ] **Step 1: Search for forbidden legacy surface strings**

Run: `rg -n "当前联赛待办|下一场|pages/match-result|result-disputes|submitResult|confirmResult|rejectResult" apps packages`

Expected: no user-facing/runtime route matches; historical test names or internal legacy service names are acceptable only when intentionally retained.

- [ ] **Step 2: Run package verification**

Run: `pnpm --filter @efm/contracts test && pnpm --filter @efm/contracts typecheck && pnpm --filter @efm/api test -- --runInBand && pnpm --filter @efm/api typecheck && pnpm --filter @efm/miniprogram test && pnpm --filter @efm/miniprogram typecheck && pnpm --filter @efm/admin-web test && pnpm --filter @efm/admin-web typecheck`

Expected: all commands PASS.

- [ ] **Step 3: Run final repository checks**

Run: `pnpm lint && pnpm build`

Expected: PASS.

- [ ] **Step 4: Review the diff for user-owned changes**

Run: `git status --short && git diff --check && git diff --stat`

Expected: no whitespace errors; feature commits contain only intended hunks, and unrelated pre-existing changes remain preserved.

- [ ] **Step 5: Commit any directly caused verification fixes**

```bash
git add <only-files-fixed-by-verification>
git commit -m "test: verify fixture and score workflow changes"
```
