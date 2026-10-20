# League Navigation and Nomination Empty State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the league workbench into a stable, one-tap grouped navigation and show an honest empty state when no nomination window exists.

**Architecture:** Keep all existing destination pages and API contracts. Define the visible module matrix and routes in the league detail view model, render each module with the existing card component pattern, add the team-directory link inside team assets, and distinguish `empty` from `error` in the nomination page state machine.

**Tech Stack:** Native WeChat mini-program (TypeScript, WXML, WXSS), Vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-league-navigation-and-nomination-empty-state-design.zh-CN.md`

## Global Constraints

- “比赛 / 球队 / 交易 / 个人” are always-visible headings, not tabs, collapsible menus, or another click level.
- No “近期要做”, “待办”, “几项提醒”, dynamic task counters, or reminder-driven ordering in the league workbench.
- Nomination remains a distinct module; the existing pages, routes, permissions, and API contracts remain in use.
- No database migration, seed, test data, or shared-database write; preserve unrelated dirty worktree files.
- Inspect `git status` and each target diff before staging; never commit pre-existing user changes in files that are already dirty.
- Follow `AGENTS.md`: verify affected old entry points and inspect normal/disabled controls at narrow and common phone widths in WeChat DevTools.

## Review Focus

1. Empty nomination-window list must show a normal explanation, while a rejected request still shows retry (Task 1 tests).
2. A selected season with no published window and a historical closed window must not be confused (Task 1 tests).
3. Disabled valuation and unavailable auction access must retain their existing permission behavior (Task 2 tests).
4. Opening other teams from assets must use the viewed league ID, including when the current team is not the first league team (Task 3 tests).
5. Schedule controls and module cards must fit narrow phones without overlap or requiring a heading tap (Task 2 template tests and Task 3 visual verification).

---

### Task 1: Nomination state and copy

**Files:**
- Modify: `apps/miniprogram/miniprogram/pages/player-nominations/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/player-nominations/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/player-nominations/index.wxss`
- Test: `apps/miniprogram/miniprogram/pages/player-nominations/player-nominations.page.spec.ts`
- Test: `apps/miniprogram/miniprogram/pages/player-nominations/player-nominations.template.spec.ts`

**Interfaces:**
- Consumes: `nominationsApi.listWindows(leagueId, seasonId)` and existing `nominationsApi.workspace(windowId)`.
- Produces: `data.state: 'loading' | 'loaded' | 'empty' | 'error'`; no new API surface.

- [ ] **Step 1: Write failing tests.** In the page spec, assert an empty `items` list sets `state === 'empty'`, `windowId === ''`, and never calls `workspace`; assert an API rejection sets `state === 'error'`; assert a past window still loads workspace with `open === false`. In the template spec, assert the empty branch says `本赛季尚未设置提名期`, contains no retry button, while the error branch still has `bindtap="loadPage"`.
- [ ] **Step 2: Run the focused tests and confirm red.** `pnpm --filter @efm/miniprogram exec vitest run miniprogram/pages/player-nominations/player-nominations.page.spec.ts miniprogram/pages/player-nominations/player-nominations.template.spec.ts` — expect the new empty-state assertions to fail.
- [ ] **Step 3: Implement the minimal page change.** In `loadPage(): Promise<void>`, classify `items.length === 0` as `empty`, reset stale window/workspace/open/players, and leave actual caught `ApiError` in `error`; render a dedicated calm empty card in WXML/WXSS. Preserve the current open/closed window flow and pull-to-refresh.
- [ ] **Step 4: Run the focused tests and confirm green.** Use the same Vitest command — expect all tests to pass.
- [ ] **Step 5: Preserve the change safely.** If all five files were clean before Task 1, commit only those files as `fix: present missing nomination window as empty state`; otherwise leave the task's changes uncommitted and record the overlap.

### Task 2: One-tap league workbench navigation

**Files:**
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/detail.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/index.wxss`
- Test: `apps/miniprogram/miniprogram/pages/league-detail/detail.viewmodel.spec.ts`
- Test: `apps/miniprogram/miniprogram/pages/league-detail/league-detail.template.spec.ts`
- Test: `apps/miniprogram/miniprogram/pages/league-detail/league-detail.page.spec.ts` (create if no existing controller test covers navigation)

**Interfaces:**
- Produces: `WorkspaceModuleKey` additionally includes `playerAuctions` and `nominations`; `workspaceModuleRoute(key, workspace, leagueName?)` returns `/pages/player-auctions/index` or `/pages/player-nominations/index?leagueId=...&seasonId=...` for those keys.
- Consumes: the existing `workspaceModules`, `workspaceModuleGroups`, `onWorkspaceModuleTap`, `openFixtures`, and `openSeasonCalendar` APIs.

- [ ] **Step 1: Write failing view-model tests.** Assert group keys/order `competition`, `team`, `transactions`, `personal`; module keys `[['standings','cups'], ['assets','finance','valuations'], ['playerMarket','playerAuctions','nominations','transactions'], ['favorites']]`; `assets.wide === true`; both new routes; closed valuation remains unroutable. Keep auction access guard test for logged-out/non-owner cases.
- [ ] **Step 2: Write failing template/controller tests.** Assert no `.directory-entry` banners and no `项提醒`, all modules render through the same `module-tile` loop, headings have no `bindtap`, and `全部赛程` / `赛季日程` are separate sibling controls with different handlers. Assert clicking each route reaches the existing page and unavailable auction access does not navigate.
- [ ] **Step 3: Run focused tests and confirm red.** `pnpm --filter @efm/miniprogram exec vitest run miniprogram/pages/league-detail/detail.viewmodel.spec.ts miniprogram/pages/league-detail/league-detail.template.spec.ts miniprogram/pages/league-detail/league-detail.page.spec.ts` — expect new assertions to fail.
- [ ] **Step 4: Implement view-model and controller changes.** Add the two keys/cards/routes; move finance into `team`; make `assets` wide; keep group headings always expanded; route auction through the same card handler with its existing owner guard. Remove league-workbench attention counts and their action-center fetch only after checking they have no other consumer in this page.
- [ ] **Step 5: Implement WXML/WXSS.** Replace the three banners with unified module tiles; render auction in the common module loop; replace the single tappable schedule card with two independent controls; use explicit flex/grid shrink constraints and centered button layout for mobile widths. Do not introduce a reminders or collapsible-category UI.
- [ ] **Step 6: Run focused tests and typecheck.** Same Vitest command and `pnpm --filter @efm/miniprogram typecheck` — expect both to pass.
- [ ] **Step 7: Preserve the change safely.** Commit only files that were clean before Task 2 as `feat: group league actions as one-tap modules`; leave already-dirty overlapping files uncommitted rather than staging their earlier changes.

### Task 3: Team-directory entry and regression verification

**Files:**
- Modify: `apps/miniprogram/miniprogram/pages/team-assets/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/team-assets/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/team-assets/index.wxss`
- Test: `apps/miniprogram/miniprogram/pages/team-assets/team-assets.page.spec.ts`
- Test: `apps/miniprogram/miniprogram/pages/team-assets/team-assets.template.spec.ts`

**Interfaces:**
- Consumes: `assets.leagueId` from `teamAssetsView` and the existing `/pages/league-team-directory/index?leagueId=...` route.
- Produces: `openTeamDirectory(): void` on the team-assets page; does not change directory or public-assets APIs.

- [ ] **Step 1: Write failing tests.** Assert `openTeamDirectory()` navigates with the current `assets.leagueId` (URL-encoded), does nothing without loaded assets, and the WXML shows one `浏览联赛球队` link near the asset identity/header rather than inside each player card. Assert the league directory page route and existing own/public asset behavior remain unchanged.
- [ ] **Step 2: Run focused tests and confirm red.** `pnpm --filter @efm/miniprogram exec vitest run miniprogram/pages/team-assets/team-assets.page.spec.ts miniprogram/pages/team-assets/team-assets.template.spec.ts` — expect new assertions to fail.
- [ ] **Step 3: Implement the link.** Add `openTeamDirectory(): void` and a compact header-level button/link with centered normal and disabled styles; retain existing roster and transfer controls untouched.
- [ ] **Step 4: Run focused tests and confirm green.** Use the same Vitest command — expect all tests to pass.
- [ ] **Step 5: Verify the complete change.** Run `pnpm --filter @efm/miniprogram test`, `pnpm --filter @efm/miniprogram typecheck`, and `git diff --check`. In WeChat DevTools inspect narrow and common phone widths: schedule controls, all four expanded groups, nomination empty/error cards, and the directory link in normal/disabled states; confirm the existing “我的联赛”, league detail, team assets, public team directory, and team detail navigation. If the simulator cannot be operated, report the unverified visual scope rather than claiming it passed. No shared-database mutations.
- [ ] **Step 6: Preserve the change safely.** Commit only files that were clean before Task 3 as `feat: link league team directory from assets`; leave already-dirty overlapping files uncommitted rather than staging their earlier changes.
