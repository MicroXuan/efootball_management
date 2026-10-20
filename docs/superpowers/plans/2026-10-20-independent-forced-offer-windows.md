# Independent Forced-Offer Windows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let league administrators configure multiple independent forced-offer periods per season, while existing bids survive a period's close for later review.

**Architecture:** A dedicated window model and service own period configuration. Player-market reads and mutations choose a transfer window for normal purchases or a forced-offer window for forced offers; review remains valid after the forced period closes while rechecking current eligibility. Admin and mini-program interfaces consume explicit, typed window identities. The companion navigation plan is completed first.

**Tech Stack:** Prisma 7/MySQL, NestJS 12, Zod 4 contracts, React/Ant Design, native WeChat mini-program, Jest/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-20-admin-navigation-and-forced-offer-windows-design.zh-CN.md`

## Global Constraints

- Multiple forced-offer windows per season; half-open intervals `[startsAt, endsAt)` may touch but not overlap.
- Forced offers ignore transfer-window dates; normal purchase, release and negotiated transfer retain current transfer-window rules.
- After deadline, block new forced offers and price changes, but keep pending review and withdrawal; queue order spans periods by first valid submission time, then ID.
- Never migrate or delete historical applications by inventing a fake period; never seed demo records.
- API unit/e2e test commands must explicitly set `DATABASE_URL` to a local isolated database whose name includes `test` or `verify`. No shared-database test, seed, cleanup or development migration.
- Inspect target `pnpm db:status` before any deployment; apply migration before API/frontend traffic. Preserve current dirty checkout. Before committing inspect both staged and unstaged diffs; stage only owned hunks, never pre-existing changes in overlapping files. If separation is unsafe, leave that task uncommitted and report it.

## Review Focus

- An interval ending exactly when the next begins is valid; overlapping concurrent creates are rejected (Task 2 tests).
- A legacy pending forced offer with only `transferWindowId` survives the old window's close and stays reviewable (Task 5 tests).
- A price increase required after the forced period ends must resolve explicitly, not leave `REQUOTE_REQUIRED` stuck (Task 5 tests).
- Two periods with pending bids on the same player preserve oldest-first order and reject duplicate active team bids (Task 5 tests).
- A currently open transfer window with no forced-offer window must never permit a forced offer, while a forced period with no transfer window must permit one (Task 4 tests).

---

### Task 1: Schema and typed contracts

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261020120000_forced_offer_windows/migration.sql`
- Create: `packages/contracts/src/forced-offer-window.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/player-market.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`

**Interfaces:**
- Produces `ForcedOfferWindowSchema`, `CreateForcedOfferWindowRequestSchema`, `UpdateForcedOfferWindowRequestSchema`, `ForcedOfferWindowListResponseSchema` and matching inferred TypeScript types with `id`, `seasonId`, `name`, `startsAt`, `endsAt`, `version` and audit fields.
- Produces application window reference as `{ kind: 'TRANSFER' | 'FORCED_OFFER'; id: string }`; submit inputs require the matching kind for `NORMAL_PURCHASE` and `FORCED_TRANSFER` respectively. Market list/detail expose `activeTransferWindowId` and `activeForcedOfferWindowId` independently. The additive read fields keep existing paths; old forced writes that omit the forced window reference return `CLIENT_UPGRADE_REQUIRED` rather than being accepted under a transfer window.
- Prisma `ForcedOfferWindow` has season/admin relations, indexes by season/time, and application relation; `PlayerAcquisitionApplication.transferWindowId` becomes nullable and gains nullable `forcedOfferWindowId`.

- [ ] **Step 1: Add failing contract tests**: normal purchase with transfer reference parses; forced offer with forced reference parses; mixed type/reference fails; both active window IDs can vary independently; list/status schemas reject inverted timestamps and invalid names.
- [ ] **Step 2: Run red contracts:** `pnpm --filter @efm/contracts test`; expect missing export/schema failures.
- [ ] **Step 3: Implement schemas and Prisma model; create an additive SQL migration** that preserves old application rows. Use service validation for exactly one window source on new writes and document the legacy forced-row exception; inspect the generated SQL before any database use.
- [ ] **Step 4: Run `pnpm --filter @efm/contracts test`, `pnpm --filter @efm/contracts build`, and `pnpm --filter @efm/api prisma:generate`; expect pass. Run read-only schema validation; do not run a migration against `.env`.
- [ ] **Step 5: Commit only the listed files** with message `feat(market): define independent forced-offer windows`.

### Task 2: Admin window service and API

**Files:**
- Create: `apps/api/src/player-market/forced-offer-windows.service.ts`
- Create: `apps/api/src/player-market/forced-offer-windows.service.spec.ts`
- Create: `apps/api/src/player-market/admin-forced-offer-windows.controller.ts`
- Modify: `apps/api/src/player-market/player-market.module.ts`

**Interfaces:**
- `list(adminId: string, leagueId: string, seasonId: string): Promise<ForcedOfferWindowListResponse>`.
- `create(adminId: string, leagueId: string, seasonId: string, input: CreateForcedOfferWindowRequest, key: string): Promise<ForcedOfferWindow>`.
- `update(adminId: string, leagueId: string, seasonId: string, windowId: string, input: UpdateForcedOfferWindowRequest, key: string): Promise<ForcedOfferWindow>`.
- REST routes: `GET/POST /v1/admin/leagues/:leagueId/seasons/:seasonId/forced-offer-windows`, `PATCH .../:windowId`.

- [ ] **Step 1: Write failing service/controller tests** for authorization, same-season non-overlap, adjacent periods, `startsAt < endsAt`, started-period start immutability, no shortening after bids, safe extension, version conflict, concurrent overlapping creates and idempotent retry.
- [ ] **Step 2: Run red tests:** `DATABASE_URL=mysql://verify:verify@127.0.0.1:3306/efm_verify pnpm --filter @efm/api test -- --runInBand src/player-market/forced-offer-windows.service.spec.ts`; expect missing service failure.
- [ ] **Step 3: Implement service/controller** using existing admin scope, mutation receipt and season lock patterns. Check overlap inside the transaction under a season lock; return distinct stable error codes for invalid date, overlap and locked edit.
- [ ] **Step 4: Run the same focused API command and API typecheck** with the same explicit local `DATABASE_URL`; expect pass.
- [ ] **Step 5: Commit only the four task files** with message `feat(api): manage forced-offer windows`.

### Task 3: Admin page and navigation child

**Files:**
- Create: `apps/admin-web/src/leagues/forced-offer-windows-page.tsx`
- Create: `apps/admin-web/src/leagues/forced-offer-windows-page.spec.tsx`
- Modify: `apps/admin-web/src/app.tsx`
- Modify: `apps/admin-web/src/leagues/league-navigation.ts`
- Modify: `apps/admin-web/src/leagues/league-navigation.spec.ts`

**Interfaces:**
- Consumes Task 2 endpoints and Task 1 Zod schemas.
- Adds canonical `/leagues/:leagueId/forced-offer-windows` route and `windows/forced-offer-windows` navigation child.

- [ ] **Step 1: Add failing page/navigation tests** for season selection, create/edit requests, time zone display, loading/empty/error states, status labels, and direct-link top/secondary selection.
- [ ] **Step 2: Run red admin tests:** `pnpm --filter @efm/admin-web test -- src/leagues/forced-offer-windows-page.spec.tsx src/leagues/league-navigation.spec.ts`; expect missing page/route.
- [ ] **Step 3: Build page with existing window form pattern**; register lazy route and add child only after page exists. Disable invalid local form values but rely on server time/overlap decision; show field-specific API errors.
- [ ] **Step 4: Run focused tests, full admin tests and `pnpm --filter @efm/admin-web typecheck`; expect pass. Verify the four window children at 320px and 390px without clipping.
- [ ] **Step 5: Commit only listed task files** with message `feat(admin): configure forced-offer periods`.

### Task 4: Market eligibility and submission/amendment

**Files:**
- Modify: `apps/api/src/player-market/player-market-query.service.ts`
- Modify: `apps/api/src/player-market/player-market-query.service.spec.ts`
- Modify: `apps/api/src/player-market/player-application.service.ts`
- Modify: `apps/api/src/player-market/player-application.service.spec.ts`
- Modify: `apps/api/src/player-market/my-player-market.controller.ts`
- Create: `apps/api/src/player-market/my-player-market.controller.spec.ts`
- Modify: `apps/api/src/player-market/player-market-application-reconciliation.ts`
- Create: `apps/api/src/player-market/player-market-application-reconciliation.spec.ts`
- Modify: `apps/api/src/player-market/forced-transfer-policy.ts`
- Modify: `apps/api/src/player-market/forced-transfer-policy.spec.ts`

**Interfaces:**
- Consumes Task 1's type-discriminated window reference and Task 2's active-window lookup.
- `resolvePlayerMarketAction` takes separate `transferWindowOpen` and `forcedOfferWindowOpen` flags and returns `FORCED_OFFER_WINDOW_CLOSED` for an owned opponent player outside a forced period.
- `submit` stores exactly the appropriate window relation; `amend` checks the forced period only for forced applications.

- [ ] **Step 1: Write failing tests** proving both independence directions, exact start/end boundaries, a forged wrong-season window ID rejection, old-client forced writes returning `CLIENT_UPGRADE_REQUIRED`, forced amend-after-deadline rejection, normal purchase unchanged, and reconciliation excluding forced offers from transfer-window expiration.
- [ ] **Step 2: Run red focused API tests** with explicit local `DATABASE_URL` and `--runInBand`; expect the independence cases to fail under the current transfer-window check.
- [ ] **Step 3: Implement type-specific market query, submit and amend paths**, keeping season → player/ownership → teams → applications lock order and the existing idempotency keys. In the controller, detect a legacy forced request with `transferWindowId` but no forced window reference and return `CLIENT_UPGRADE_REQUIRED` before Zod validation obscures that cause. Change only the transfer-window expiry selection so legacy/new forced offers are never expired just because a transfer window closes.
- [ ] **Step 4: Run focused API tests and API typecheck** with explicit local `DATABASE_URL`; expect pass.
- [ ] **Step 5: Commit only Task 4 files** with message `feat(market): submit forced offers in independent periods`.

### Task 5: Review and cross-period queue

**Files:**
- Modify: `apps/api/src/player-market/player-market-review.service.ts`
- Modify: `apps/api/src/player-market/player-market-review.service.spec.ts`
- Modify: `apps/api/src/player-market/player-market-query.service.ts`
- Modify: `apps/api/src/player-market/player-market-query.service.spec.ts`

**Interfaces:**
- Consumes Task 4's persisted window source and leaves review eligibility independent from the period end.
- Cross-period priority remains `firstValidSubmittedAt ASC, id ASC`; older legacy forced rows retain original timestamps.

- [ ] **Step 1: Add failing tests** for review after period close, legacy forced row after its transfer window closes, queue order across two periods, duplicate active team bids, current ownership/salary/cap checks, and post-close insufficient official value becoming a terminal reason rather than unamendable `REQUOTE_REQUIRED`.
- [ ] **Step 2: Run red focused API tests** using explicit local `DATABASE_URL`; expect old window expiry/review assertions to fail.
- [ ] **Step 3: Implement type-specific review checks and stable queue sorting** without changing normal purchase review. Keep existing transaction, ledger and ownership mutation behavior; revise only window validity and forced-offer terminal status when amendment is impossible.
- [ ] **Step 4: Run focused tests and full API unit suite** with explicit local `DATABASE_URL`, then API typecheck; expect pass.
- [ ] **Step 5: Commit only Task 5 files** with message `feat(market): preserve forced-offer review across periods`.

### Task 6: Mini-program client and safe release verification

**Files:**
- Modify: `apps/miniprogram/miniprogram/services/player-market.ts`
- Modify: `apps/miniprogram/miniprogram/services/player-market.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/player-market-detail/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/player-market-detail/player-market-detail.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/player-market-detail/player-market-detail.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/player-market/player-market.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/player-market/player-market.viewmodel.spec.ts`
- Modify: release notes in `docs/deployment/cloudbase.md` only if current deployment steps do not cover the new staged rollout.

**Interfaces:**
- Consumes Task 1's dual active window IDs and typed submission reference.
- Produces the correct ID for `FORCE_SIGN` versus `APPLY`, with distinct closed-period copy; withdrawal remains available on pending applications.

- [ ] **Step 1: Add failing mini-program tests**: opponent player is force-actionable only in a forced period; free player uses transfer window; detail submit sends the proper typed reference; ended period blocks price edit but not withdrawal; wrong or missing window ID cannot submit.
- [ ] **Step 2: Run red focused mini-program tests:** `pnpm --filter @efm/miniprogram test -- miniprogram/pages/player-market-detail/player-market-detail.viewmodel.spec.ts miniprogram/services/player-market.spec.ts`; expect new contract/path assertions to fail.
- [ ] **Step 3: Update market client, list/detail viewmodels and submit handler**; use server action/status fields rather than client clock as authority. Preserve the existing card layout and all non-market pages.
- [ ] **Step 4: Run contracts, admin, mini-program and API suites/typechecks.** API commands must carry explicit local `DATABASE_URL`. In WeChat DevTools inspect normal/disabled button states and centered text at 320px and 390px; smoke-test old market, league, teams/roster, admin current/withdrawn teams and detail. Before any target deployment inspect `pnpm db:status`, apply migration via controlled flow, then deploy API/admin and publish mini-program before enabling a forced period; if target access is unavailable, report that production acceptance remains unverified.
- [ ] **Step 5: Commit only Task 6 files** with message `feat(miniprogram): use independent forced-offer periods`.

## Execution Order and Handoff

Complete the navigation plan first, then Tasks 1–6 here, then the season-phase-calendar plan, which reads these forced-offer windows. The new strong-offer page and new market behavior must remain unexposed until their migration/API are ready. Do not run any unit/e2e test or migration against an inherited `.env` database; all write operations need an explicit inspected local test target. Work in the existing checkout as previously requested, preserving unrelated uncommitted changes.
