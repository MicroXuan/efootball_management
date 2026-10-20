# Season Phase Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the same Beijing-time current-season phase calendar in the mini-program and admin workspace, with admin-managed informational dates and no fixtures.

**Architecture:** Extend the existing season-calendar aggregation instead of storing copies of windows. It merges transfer, forced-offer, valuation and nomination windows with a separate table for manual all-day notes; separate user/admin controllers enforce read/write permissions. The mini-program renders a non-interactive month overview and always-visible monthly summary, while admin gets a wide month view and note editor under “窗口设置”.

**Tech Stack:** Prisma 7/MySQL, NestJS 12, Zod 4 contracts, React/Ant Design, native WeChat mini-program, Jest/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-season-phase-calendar-design.zh-CN.md`

## Global Constraints

- Implement after `2026-10-20-independent-forced-offer-windows.md`; use its `ForcedOfferWindow` as the fourth automatic source.
- Calendar contains transfer, forced-offer, valuation, nomination windows and admin notes only. Never query or render competition fixtures.
- The existing mini-program “赛季日程” route stays; no tap on a day is required to see all information. Admin entry is `窗口设置 → 赛季日历`.
- Calendar dates and month boundaries use `Asia/Shanghai`, not device locale; automatic windows remain half-open and manual all-day notes include both endpoint dates.
- Logged-in league viewers need no approved `SeasonEntry` for read-only calendar access; nomination/market permissions remain unchanged. Only league admins write notes.
- API tests and migrations never inherit `.env`: explicitly use an inspected local database whose name contains `test` or `verify`. Preserve existing dirty changes; stage only owned hunks, or leave a task uncommitted if hunks overlap unsafely.

## Review Focus

- A window ending at Beijing 00:00 must not color the new day, even if its UTC date differs (Task 2 test).
- A previous-month window crossing into the requested month must appear, and a next-month-only window must not (Task 2 test).
- A signed-in non-participant may read the current season, but a season from another league cannot leak (Task 2 test).
- A manual note's inclusive end date must appear in the last cell and survive month switching; deleted notes must disappear without losing audit data (Tasks 2 and 3 tests).
- At 320px, all seven mini-program columns and the final-day labels stay inside the viewport, with every event represented in the always-visible summary (Task 5 test and device check).

---

### Task 1: Calendar item contract and manual-note model

**Files:**
- Modify: `packages/contracts/src/season-calendar.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261020130000_season_calendar_notes/migration.sql`

**Interfaces:**
- `SeasonAgendaKindSchema` becomes `TRANSFER | FORCED_OFFER | VALUATION | NOMINATION | MANUAL`, with no `FIXTURE`.
- Each `SeasonAgendaItem` exposes `id`, `kind`, nullable `noteKind` (`HOLIDAY | MAINTENANCE | NOTICE` only for manual items), `title`, nullable `description`, `firstDate`, `lastDate` (inclusive `YYYY-MM-DD` in `Asia/Shanghai`), nullable `startsAt`/`endsAt`, `status`, and nullable `targetPath`; `SeasonAgendaResponse` exposes `month`, nullable `seasonId`, literal `timezone: 'Asia/Shanghai'`, and `items`.
- Produces `CreateSeasonCalendarNoteRequestSchema`, `UpdateSeasonCalendarNoteRequestSchema`, `SeasonCalendarNoteSchema` and inferred types. Notes use `kind: HOLIDAY | MAINTENANCE | NOTICE`, `title` length 1–64, optional description up to 300, inclusive `startsOn`/`endsOn` date strings, version and audit fields.
- Prisma `SeasonCalendarNote` belongs to `LeagueSeason`, has `deletedAt` nullable and creator/updater admin IDs.

- [ ] **Step 1: Write failing contract tests** for accepted four phase kinds plus manual, rejected `FIXTURE`, Beijing timezone literal, nullable `seasonId` only for no-current-season response, manual `noteKind`, inclusive date syntax, `endsOn < startsOn` rejection, and nullable times only on manual notes.
- [ ] **Step 2: Run red:** `pnpm --filter @efm/contracts test`; expect new contracts absent and fixture assertion mismatch.
- [ ] **Step 3: Implement schemas and additive Prisma migration**; keep all existing rows and do not seed notes. Use `@db.Date` for manual dates and convert via UTC calendar components rather than device-local `Date` formatting.
- [ ] **Step 4: Run contracts tests/build, `pnpm --filter @efm/api prisma:generate` and read-only Prisma validation; expect pass. Inspect SQL; do not run a database migration against `.env`.
- [ ] **Step 5: Commit only owned hunks/files** with message `feat(calendar): define season phase items and notes`.

### Task 2: Beijing-time aggregation and read authorization

**Files:**
- Modify: `apps/api/src/season-calendar/season-calendar.service.ts`
- Modify: `apps/api/src/season-calendar/season-calendar.service.spec.ts`
- Modify: `apps/api/src/season-calendar/season-calendar.controller.ts`
- Create: `apps/api/src/season-calendar/admin-season-calendar.controller.ts`
- Modify: `apps/api/src/season-calendar/season-calendar.module.ts`

**Interfaces:**
- `listForUser(userId: string, leagueId: string, seasonId: string, month: string, now?: Date): Promise<SeasonAgendaResponse>`.
- `listForAdmin(adminId: string, leagueId: string, month: string, now?: Date): Promise<SeasonAgendaResponse>` resolves `league.currentSeasonId` and returns `{ seasonId: null, items: [] }` when none is set. `listForUser` validates that the supplied season is the league's current season; absence of a current season is represented as an empty result, not a fixture or permission error.
- Existing mini route `/me/leagues/:leagueId/seasons/:seasonId/agenda?month=YYYY-MM` stays; new admin route `/admin/leagues/:leagueId/current-season/agenda?month=YYYY-MM` uses admin authentication and grant check.

- [ ] **Step 1: Write failing service/controller tests** for all five sources, absence of fixture query, Beijing month overlap, exact 00:00 cutoff, valuation `closedAt` before scheduled end, manual inclusive last day, multiple same-day items, deterministic order, no current season, non-participant read, cross-league denial and admin grant denial.
- [ ] **Step 2: Run red:** `DATABASE_URL=mysql://verify:verify@127.0.0.1:3306/efm_verify pnpm --filter @efm/api test -- --runInBand src/season-calendar/season-calendar.service.spec.ts`; expect existing fixture/participation behavior to fail.
- [ ] **Step 3: Implement shared aggregator** with Beijing month bounds and `firstDate`/`lastDate` projection. Remove `seasonEntry` gate and `competitionMatch` query only for calendar; keep visibility and current-season checks. Add admin controller and module imports; no business window mutations from calendar.
- [ ] **Step 4: Run focused API tests and API typecheck** with explicit local `DATABASE_URL`; expect pass.
- [ ] **Step 5: Commit only Task 2 files** with message `feat(api): aggregate current-season phase calendar`.

### Task 3: Admin note mutations and audit

**Files:**
- Create: `apps/api/src/season-calendar/season-calendar-note.service.ts`
- Create: `apps/api/src/season-calendar/season-calendar-note.service.spec.ts`
- Create: `apps/api/src/season-calendar/admin-season-calendar-notes.controller.ts`
- Modify: `apps/api/src/season-calendar/season-calendar.module.ts`

**Interfaces:**
- `create(adminId: string, leagueId: string, seasonId: string, input: CreateSeasonCalendarNoteRequest, key: string): Promise<SeasonCalendarNote>`.
- `update(adminId: string, leagueId: string, seasonId: string, noteId: string, input: UpdateSeasonCalendarNoteRequest, key: string): Promise<SeasonCalendarNote>`.
- `remove(adminId: string, leagueId: string, seasonId: string, noteId: string, expectedVersion: number, key: string): Promise<SeasonCalendarNote>` sets `deletedAt`, increments version, and leaves an audit record.
- Routes: `POST/PATCH/DELETE /admin/leagues/:leagueId/seasons/:seasonId/calendar-notes[/:noteId]`.

- [ ] **Step 1: Write failing service/controller tests** for create/edit/soft-delete, inclusive dates, invalid reverse range, wrong season or league, idempotent retry, version conflict, missing grant and audit actor.
- [ ] **Step 2: Run red focused API tests** with explicit local `DATABASE_URL`; expect missing service/controller failure.
- [ ] **Step 3: Implement mutation service and guarded controller** using existing admin authorization, mutation receipt and audit patterns. Reject edits of a soft-deleted note; do not alter any window state.
- [ ] **Step 4: Run focused tests, full API unit suite and API typecheck** with explicit local `DATABASE_URL`; expect pass.
- [ ] **Step 5: Commit only Task 3 files** with message `feat(api): manage calendar notes with audit`.

### Task 4: Admin calendar inside Window Settings

**Files:**
- Create: `apps/admin-web/src/leagues/season-calendar-page.tsx`
- Create: `apps/admin-web/src/leagues/season-calendar-page.spec.tsx`
- Modify: `apps/admin-web/src/app.tsx`
- Modify: `apps/admin-web/src/leagues/league-navigation.ts`
- Modify: `apps/admin-web/src/leagues/league-navigation.spec.ts`
- Modify: `apps/admin-web/src/styles.css`

**Interfaces:**
- Consumes Task 2 read route and Task 3 note routes.
- Produces `/leagues/:leagueId/season-calendar` child route and `windows/season-calendar` secondary navigation key.

- [ ] **Step 1: Add failing page/navigation tests** for current season load, month switch, all four automatic phases and notes, no fixtures, source-page links, Beijing time copy, note save/delete refresh, empty/error states, nested-route active nav and denied edit without grant.
- [ ] **Step 2: Run red admin tests:** `pnpm --filter @efm/admin-web test -- src/leagues/season-calendar-page.spec.tsx src/leagues/league-navigation.spec.ts`; expect missing page/child.
- [ ] **Step 3: Build wide month grid and all-day note editor** from the shared response; link auto items to their window pages, never edit window times in calendar. Register route and compact secondary child; scope CSS to this page.
- [ ] **Step 4: Run focused/full admin tests and typecheck**, then inspect at desktop and 390px widths; expect no navigation overflow and readable overlapping labels.
- [ ] **Step 5: Commit only owned Task 4 hunks/files** with message `feat(admin): show and edit season phase calendar`.

### Task 5: Mini-program at-a-glance month calendar

**Files:**
- Modify: `apps/miniprogram/miniprogram/pages/season-calendar/calendar.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/season-calendar/calendar.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/season-calendar/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/season-calendar/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/season-calendar/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/season-calendar/calendar.template.spec.ts`
- Modify: `apps/miniprogram/miniprogram/services/season-calendar.ts`

**Interfaces:**
- `buildMonthCalendar(response: SeasonAgendaResponse): { weeks: CalendarWeek[]; summary: CalendarSummaryItem[] }` projects server-provided inclusive `firstDate`/`lastDate`; `CalendarWeek` has seven day cells, each with `date`, `dayNumber`, `inMonth`, and compact kind labels/markers.
- The existing page route and `seasonCalendarApi.list(leagueId, seasonId, month)` remain.

- [ ] **Step 1: Add failing viewmodel/template tests** for seven equal columns, phases repeated across covered dates, adjacent-month padding, same-day overlap, no fixture labels, complete always-visible monthly summary, no day tap handler, no-current-season empty state and no device-timezone date conversion.
- [ ] **Step 2: Run red:** `pnpm --filter @efm/miniprogram test -- miniprogram/pages/season-calendar/calendar.viewmodel.spec.ts miniprogram/pages/season-calendar/calendar.template.spec.ts`; expect old agenda-list behavior to fail.
- [ ] **Step 3: Replace date-list projection with month-grid projection** and always-visible range summary. Keep month switch, pull-to-refresh, loading/empty/error states; display “北京时间” and avoid native `button` overflow in seven-column cells.
- [ ] **Step 4: Run full mini-program tests/typecheck and combined contracts/admin/API regressions** (API commands with explicit local `DATABASE_URL`). In WeChat DevTools preview 320px and common phone width, inspect normal/disabled buttons, text centering, seven-column boundaries and final-day contents; test “全部赛程” and “我的联赛” remain reachable.
- [ ] **Step 5: Commit only owned Task 5 hunks/files** with message `feat(miniprogram): preview season phases in month grid`.

## Execution Order and Handoff

Run the admin-navigation and forced-offer-window plans first, then Tasks 1–5 here. Before any target deployment inspect `pnpm db:status`; apply both new migrations through the controlled process before API traffic, then deploy admin and publish mini-program. If no target-environment access exists, report that live migration, old-client behavior and actual pages remain unverified. Do not create demo data or clean shared data.
