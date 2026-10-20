# Admin League Navigation Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the crowded league administration tab strip with compact top-level navigation and route-aware secondary navigation without breaking existing pages.

**Architecture:** A pure route-to-navigation resolver owns the grouping. `LeagueShell` renders top-level tabs plus a secondary row for grouped sections while `app.tsx` keeps every existing child route. The independent forced-offer-window plan adds its child item and route after its page exists.

**Tech Stack:** React 19, React Router 7, Ant Design 6, TypeScript, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-20-admin-navigation-and-forced-offer-windows-design.zh-CN.md`

## Global Constraints

- Preserve current URLs and direct links, including nested nomination candidates and auction edit/detail paths.
- Keep “分组与赛程” and “杯赛中心” as separate first-level entries.
- Group existing windows, reviews and finance pages; the strong-offer and season-calendar children are enabled by their companion plans only after those routes work.
- Keep the current dirty checkout. Before any commit inspect both staged and unstaged diffs; stage only owned hunks, never pre-existing changes in an overlapping file. If hunks cannot be separated safely, leave that task uncommitted and report it.
- No database commands or test data for this navigation-only plan.

## Review Focus

- Nested `/teams/:teamId/roster` must highlight “用户与球队”, not fall back to another group (Task 1 test).
- Nested `/nomination-windows/:windowId/candidates` must keep “提名期” selected (Task 1 test).
- Auction edit/detail routes must keep “球员拍卖” selected (Task 1 test).
- Unknown league child paths must not crash the shell or falsely select a child (Task 1 test).
- Narrow viewports must keep the final tab, selected indicator and secondary links inside the navigation container (Task 3 viewport test).

---

### Task 1: Route-aware navigation model

**Files:**
- Create: `apps/admin-web/src/leagues/league-navigation.ts`
- Create: `apps/admin-web/src/leagues/league-navigation.spec.ts`

**Interfaces:**
- Produces: `resolveLeagueNavigation(pathname: string): { topKey: string; childKey: string | null }`.
- Produces: `leagueNavigationItems(leagueId: string, includeWechatBot: boolean): LeagueNavigationItem[]`, where each item has `key`, `label`, `path`, and optional `children` with the same three fields.
- Group keys: `teams`, `seasons`, `allocation`, `cups`, `windows`, `reviews`, `finance`, `auctions`, optional `more`.

- [ ] **Step 1: Write failing table-driven tests** in `league-navigation.spec.ts` for `/teams/x/roster → teams`, `/nomination-windows/x/candidates → windows/nomination-windows`, `/auctions/x/edit → auctions`, `/transfer-proposals → reviews/transfer-proposals`, `/salary-rules → finance/salary-rules`, and unknown child → `teams/null`; assert item order and that the two competition entries are separate.
- [ ] **Step 2: Run the red test:** `pnpm --filter @efm/admin-web test -- src/leagues/league-navigation.spec.ts`; expect missing module/function failure.
- [ ] **Step 3: Implement the two pure exports** in `league-navigation.ts`; match route segments rather than substring chains, and keep every existing canonical path.
- [ ] **Step 4: Run the green test** with the same command; expect all cases to pass.
- [ ] **Step 5: Commit only the two task files** with `git add -- <exact files> && git commit -m "feat(admin): model grouped league navigation"`.

### Task 2: Render grouped top and secondary navigation

**Files:**
- Modify: `apps/admin-web/src/leagues/league-shell.tsx`
- Modify: `apps/admin-web/src/leagues/league-shell.spec.tsx`

**Interfaces:**
- Consumes Task 1's `resolveLeagueNavigation` and `leagueNavigationItems`.
- Produces unchanged `<Outlet />` child rendering and unchanged route paths; the top group links to its first child.

- [ ] **Step 1: Rewrite the shell test first**: `seasons` remains top-level; `/valuation-windows` selects top “窗口设置” and secondary “身价窗口”; `/disappearance-requests` selects top “审核” and secondary “消失审核”; `/ledger` selects “财务”; existing feature-flag and access-denied assertions remain. Assert `aria-current="page"` only on the relevant selected link.
- [ ] **Step 2: Run the red test:** `pnpm --filter @efm/admin-web test -- src/leagues/league-shell.spec.tsx`; expect old flat-navigation assertions to fail.
- [ ] **Step 3: Render top tabs and an `aria-label="联赛分组导航"` secondary nav** from Task 1's items. Use `Link` and `aria-current`; retain the identity check and existing heading/`Outlet` structure. Do not create redirect routes or duplicate page components.
- [ ] **Step 4: Run the green shell and application tests:** `pnpm --filter @efm/admin-web test -- src/leagues/league-shell.spec.tsx src/application-shell.spec.tsx`; expect pass.
- [ ] **Step 5: Commit only the shell and its test** with message `feat(admin): group league workspace tabs`.

### Task 3: Compact spacing and responsive verification

**Files:**
- Modify: `apps/admin-web/src/styles.css`
- Modify: `apps/admin-web/src/leagues/league-shell.spec.tsx`

**Interfaces:**
- Consumes Task 2's `.league-heading-nav` and secondary navigation class.
- Produces no new route or API.

- [ ] **Step 1: Add failing layout assertions** that the top nav and secondary nav have bounded overflow classes and the selected route still exposes its link after a narrow-width render; keep them behavior-focused, not snapshot-only.
- [ ] **Step 2: Run the red shell test** with the Task 2 command; expect the new layout assertions to fail.
- [ ] **Step 3: Add league-scoped CSS** with `8px` horizontal tab padding and `8px` tab gaps, `min-width: 0`, bounded `overflow-x`, visible selected/keyboard focus states, and a readable secondary row. Do not globally shrink unrelated Ant tabs.
- [ ] **Step 4: Run `pnpm --filter @efm/admin-web test` and `pnpm --filter @efm/admin-web typecheck`; inspect desktop and narrow viewport (about 390px and 320px) in the browser. Verify last tab and selected underline stay inside the viewport, every child is reachable, and old deep links render their page.
- [ ] **Step 5: Commit only the CSS and updated shell test** with message `style(admin): contain compact league navigation`.

## Execution Order and Handoff

Complete this navigation plan first. The forced-offer-window plan then adds “强报期” to the `windows` children; the season-phase-calendar plan adds “赛季日历” there after its page works. Keep unrelated dirty changes untouched; do not claim live-environment verification from local tests.
