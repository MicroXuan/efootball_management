# Season Calendar and Nominations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reliable “我的赛程” filter, a real season agenda, and a nomination-to-auction-draft pipeline.

**Architecture:** Extend the existing season-fixture query with exact owned-team scope. Build a read-only agenda from published fixtures and configured windows; add a separate nomination window/record module whose admin shortlist feeds existing auction drafts. Preserve the auction state machine.

**Tech Stack:** NestJS, Prisma/MySQL, Zod contracts, React/Ant Design admin, native WeChat mini-program, Jest/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-season-calendar-nominations-team-assets-transfers-design.zh-CN.md`

## Global Constraints

- Nomination candidates must have no ownership in the current league at submit, import, and auction prepare time.
- One active nomination per window/team/player; multiple teams may nominate the same player.
- Server time decides all window boundaries; nomination never starts an auction automatically.
- Preserve existing auction and fixture data; do not change the copied text into a formal application.
- Do not stage or overwrite unrelated dirty workspace files.

## Review Focus

- A user with two approved teams selects one exact team; similarly named opponents must not leak into “我的赛程” (Task 1 test).
- A fixture request cursor from another scope/team is rejected, not reused (Task 1 test).
- A nomination submitted at the exact window end is rejected using server time (Task 4 test).
- Two teams nominating the same free player yield one admin candidate with two nominators (Task 5 test).
- A player acquired after nomination cannot be imported or prepared for auction (Task 6 test).

---

## File structure

- Extend `packages/contracts/src/competition.ts` for exact fixture scope. Add `packages/contracts/src/season-calendar.ts` and `player-nomination.ts`; export from `index.ts`.
- Keep agenda query in `apps/api/src/season-calendar/`, nomination mutations/aggregation in `apps/api/src/player-nominations/`, and auction preparation ownership guard in `apps/api/src/player-auctions/`.
- Keep mini-program agenda/nomination pages separate; extend the existing `my-matches` page. Admin shortlist has its own page, linked from the auction editor.

### Task 1: Exact owned-team fixture scope

**Files:** Modify `packages/contracts/src/competition.ts`, `apps/api/src/competitions/season-fixtures.service.ts`, `apps/api/src/competitions/season-fixtures.service.spec.ts`, `apps/miniprogram/miniprogram/services/competitions.ts`.

**Interfaces:** `SeasonFixtureListQuery` gains `scope: 'ALL'|'MINE'` (default `ALL`) and optional `leagueTeamId`; `MINE` requires a team ID. `SeasonFixturesService.list(userId, leagueId, seasonId, query)` keeps its response shape.

- [ ] **Step 1: Write failing tests.** Assert `MINE` returns only matches whose home/away `seasonEntry.leagueTeamId` equals the requested owned approved team, denies another user's team, and rejects a cursor encoded for another scope/team.
- [ ] **Step 2: Run red.** `pnpm --filter @efm/api test --runInBand src/competitions/season-fixtures.service.spec.ts`; expect new cases to fail.
- [ ] **Step 3: Implement.** Validate `scope/teamId` in Zod, resolve exact approved team ownership, include both fields in cursor encoding/checks, and filter before pagination; update `seasonFixturesPath` options.
- [ ] **Step 4: Run green.** Same command plus `pnpm --filter @efm/contracts test`; expect all pass.
- [ ] **Step 5: Commit** only Task 1 files with `feat: filter fixtures by exact owned team`.

### Task 2: Fourth “我的赛程” tab

**Files:** Modify `apps/miniprogram/miniprogram/pages/my-matches/index.ts`, `index.wxml`, `index.wxss`, `my-matches.page.spec.ts`, `my-matches.template.spec.ts`; use existing `services/league-teams.ts`.

**Interfaces:** Page state `fixtureScope: 'ALL'|'MINE'`, `selectedLeagueTeamId: string`, `mineTeams: Array<{id:string; name:string}>`; Task 1 fixture query.

- [ ] **Step 1: Write failing tests.** Fourth tab text is present; switching to it loads owned team IDs, sends `scope=MINE&leagueTeamId=<id>`, clears stale rows/cursor, allows team switching, and shows an empty-team explanation.
- [ ] **Step 2: Run red.** `pnpm --filter @efm/miniprogram exec vitest run miniprogram/pages/my-matches/my-matches.page.spec.ts miniprogram/pages/my-matches/my-matches.template.spec.ts`.
- [ ] **Step 3: Implement.** Add the fourth visible tab without replacing the three status tabs; `MINE` uses exact team IDs and keeps status `ALL`. Preserve existing search/status state when returning to all fixtures.
- [ ] **Step 4: Run green.** Repeat the targeted command and `pnpm --filter @efm/miniprogram typecheck`.
- [ ] **Step 5: Commit** Task 2 files with `feat: add my fixtures tab`.

### Task 3: Season agenda read model

**Files:** Create `packages/contracts/src/season-calendar.ts`, `apps/api/src/season-calendar/season-calendar.service.ts`, `.spec.ts`, `.controller.ts`, `.module.ts`, `apps/miniprogram/miniprogram/services/season-calendar.ts`, `pages/season-calendar/index.{ts,wxml,wxss,json}`, page tests; modify `packages/contracts/src/index.ts`, `apps/api/src/app.module.ts`, `apps/miniprogram/miniprogram/app.json`, `pages/league-detail/index.{ts,wxml}`.

**Interfaces:** `SeasonAgendaItem = {id,kind:'FIXTURE'|'TRANSFER'|'VALUATION'|'NOMINATION',title,startsAt,endsAt,status:'UPCOMING'|'ACTIVE'|'ENDED',targetPath:null|string}`; `GET /me/leagues/:leagueId/seasons/:seasonId/agenda?month=YYYY-MM` returns sorted items.

- [ ] **Step 1: Write failing tests.** Service combines published fixtures, transfer windows and valuation windows; excludes other seasons and unpublished fixtures; exact start/end timestamps drive status. Mini page shows month grouping and links to fixture details. Task 4 adds the nomination-window agenda case after its table exists.
- [ ] **Step 2: Run red.** `pnpm --filter @efm/api test --runInBand src/season-calendar/season-calendar.service.spec.ts` and the new mini page Vitest file.
- [ ] **Step 3: Implement.** Query source tables without copying dates into a new agenda table; authorize visible season; add month navigation, timezone label, and league-detail entry.
- [ ] **Step 4: Run green.** Targeted tests, contracts test, API/miniprogram typechecks.
- [ ] **Step 5: Commit** Task 3 files with `feat: show live season agenda`.

### Task 4: Nomination window administration

**Files:** Modify `apps/api/prisma/schema.prisma`; create `apps/api/prisma/migrations/202610200003_nomination_windows/migration.sql`, `packages/contracts/src/player-nomination.ts`, `apps/api/src/player-nominations/{player-nominations.module.ts,admin-nomination.controller.ts,nomination-window.service.ts,nomination-window.service.spec.ts}`; modify `packages/contracts/src/index.ts`, `apps/api/src/app.module.ts`, `apps/admin-web/src/app.tsx`; add admin window form under `apps/admin-web/src/leagues/` with test.

**Interfaces:** `NominationWindow {id,leagueId,seasonId,startsAt,endsAt,perTeamLimit,version}`; admin create/update endpoints under `/admin/leagues/:leagueId/seasons/:seasonId/nomination-windows`; positive integer limit and `startsAt < endsAt`.

- [ ] **Step 1: Write failing tests.** Unauthorized admin denied; invalid or overlapping window rejected; at `now === endsAt` window is closed; edit uses expected version; admin form requires a positive per-team limit.
- [ ] **Step 2: Run red.** `pnpm --filter @efm/api test --runInBand src/player-nominations/nomination-window.service.spec.ts` and targeted admin Vitest.
- [ ] **Step 3: Implement.** Add Prisma model and migration, Zod contracts, scoped admin CRUD with receipt/audit patterns, and admin form; wire Task 3 agenda query to the table and add a test that nomination windows appear in month order.
- [ ] **Step 4: Run green.** Targeted tests, `pnpm --filter @efm/api prisma:generate`, contracts/admin/API typechecks.
- [ ] **Step 5: Commit** Task 4 files with `feat: configure nomination windows`.

### Task 5: Team nominations and admin shortlist

**Files:** Add `apps/api/prisma/migrations/202610200004_player_nominations/migration.sql`, extend nomination Prisma model and contracts; create `apps/api/src/player-nominations/{my-nominations.controller.ts,nomination.service.ts,nomination.service.spec.ts}`, `apps/miniprogram/miniprogram/services/nominations.ts`, `pages/player-nominations/index.{ts,wxml,wxss,json}` and tests; create `apps/admin-web/src/auctions/nomination-shortlist-page.tsx` and test; modify `apps/miniprogram/miniprogram/app.json`, `pages/league-detail/index.{ts,wxml}`, and `apps/admin-web/src/app.tsx` to register routes.

**Interfaces:** `POST /me/nomination-windows/:windowId/nominations {playerId}`; `DELETE /me/nomination-windows/:windowId/nominations/:id`; admin `GET /admin/leagues/:leagueId/nomination-windows/:windowId/candidates` returns one row per player with nominators/count/eligibility.

- [ ] **Step 1: Write failing tests.** Free-only eligibility, active approved team permission, per-team cap, repeat submit idempotency, withdrawal before cutoff, and two teams aggregated to one candidate; UI shows remaining slots and own nominations.
- [ ] **Step 2: Run red.** Targeted nomination service Jest and mini/admin Vitest.
- [ ] **Step 3: Implement.** Unique `(windowId,leagueTeamId,footballPlayerId)` constraint; receipt/version checks and server clock; scoped candidate aggregate and pages. Search reuses player catalog, not a new catalog.
- [ ] **Step 4: Run green.** Targeted tests and all three typechecks.
- [ ] **Step 5: Commit** Task 5 files with `feat: collect auction nominations`.

### Task 6: Import shortlist into an auction draft

**Files:** Modify `apps/api/prisma/schema.prisma`, add `apps/api/prisma/migrations/202610200005_nomination_auction_source/migration.sql`; modify `packages/contracts/src/player-auction.ts`, `apps/api/src/player-auctions/admin-player-auctions.service.ts`, `.spec.ts`, `apps/admin-web/src/auctions/auction-editor-page.tsx`, `.spec.tsx`, nomination shortlist page/test.

**Interfaces:** `PlayerAuctionLotInputSchema` gains optional `nominationId`; `PlayerAuctionLot.nominationId` is nullable. `AdminPlayerAuctionsService.replaceLots(...)` remains the only write path; shortlist UI includes `nominationId` after card/price/increment/order selection.

- [ ] **Step 1: Write failing tests.** Selected nominees append once to a DRAFT, preserve existing order/prices, require card/start/increment, and reject a player acquired after nomination both at import and `prepare`.
- [ ] **Step 2: Run red.** Targeted auction service Jest and editor Vitest.
- [ ] **Step 3: Implement.** Persist nomination source ID, validate free-player eligibility for nomination-sourced lots at replace and prepare, and preserve source ID when editing the draft. Shortlist import composes current lots with selected candidates then calls existing replace endpoint. Never auto-prepare or start.
- [ ] **Step 4: Run green.** Targeted tests, API/admin typechecks, and auction regression tests.
- [ ] **Step 5: Commit** Task 6 files with `feat: import nominations into auction drafts`.

## Final verification

- [ ] Run `pnpm --filter @efm/contracts test`, focused API tests, `pnpm --filter @efm/admin-web test`, `pnpm --filter @efm/miniprogram test`, `pnpm typecheck`, and `pnpm build`; report any slow/full-suite limitation without implying a pass.
- [ ] Inspect fixtures, agenda, nomination and auction import in the WeChat developer tools and admin UI; keep unrelated working-tree changes untouched.
