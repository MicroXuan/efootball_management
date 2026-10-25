# CELL Rules Phase One Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate current-season match eligibility from immediate player ownership, and award unbid nominated players to the earliest valid nominator at the rule's base price.

**Architecture:** Persist a season-scoped playing roster snapshot at season start; keep existing ownership as the source of truth for assets, salaries and prices. Reuse the auction review transaction for unbid nominated lots, selecting the earliest active nomination server-side.

**Tech Stack:** NestJS, Prisma/MySQL, Zod contracts, React admin web, WeChat miniprogram, Jest.

**Spec:** `docs/superpowers/specs/2026-10-24-cell-rules-phase-one-design.zh-CN.md`

## Global Constraints

- Work on `dev`; do not modify other branches.
- Test commands must explicitly set `DATABASE_URL` to local MySQL with `test` or `verify` in the database name.
- Do not deploy API code before target database migrations are applied.
- Keep existing ownership API semantics for assets, salaries and valuations.

## Review Focus

- A forced transfer is approved during an active season: old team keeps match eligibility, buyer owns the asset immediately.
- A player is released after season start: current-season match eligibility remains.
- An old season exists without a playing-roster snapshot: response must be explicit, not silently inferred from current ownership.
- Two nominations share the same timestamp: ID decides deterministically.
- No-bid review races a new ownership or roster-cap change: transaction fails without partial ledger or review records.

---

### Task 1: Effective nomination order

**Files:** Modify `apps/api/prisma/schema.prisma`, add migration, modify `apps/api/src/player-nominations/nomination.service.ts`; test in `nomination.service.spec.ts`.

**Interfaces:** `PlayerNomination.effectiveSubmittedAt: DateTime`; `NominationService.submit` resets this on reactivation; `NominationService.candidates` uses it for source selection.

- [x] Write a failing test: withdraw and resubmit loses its original priority to a later still-active nomination; equal timestamps sort by ID.
- [x] Run API unit test with explicit local verify `DATABASE_URL`; expect failure for old priority.
- [x] Add schema/migration and update submission and candidate ordering.
- [x] Run focused tests, typecheck, and affected nomination/auction tests.

### Task 2: Unbid nomination award

**Files:** Modify `apps/api/src/player-auctions/admin-player-auctions.service.ts`, `apps/admin-web/src/auctions/auction-detail-page.tsx`; test in auction service and admin web tests.

**Interfaces:** `reviewLot(..., { decision: 'CONFIRM' })` for a `NO_BID` lot with a nomination derives winner and fixed base price 10; unsourced `NO_BID` stays unsold.

- [x] Cover nominated unbid award, unsourced no-bid, withdrawn nomination, ownership race, and repeated review with unit tests.
- [x] Run focused tests with explicit local verify `DATABASE_URL`; expect the nominated case to fail.
- [x] Implement transactional earliest-nominator lookup and base-price acquisition, preserve current bid review behavior.
- [x] Update admin review copy and preview; run focused API and admin tests and typecheck.

### Task 3: Playing-roster snapshot

**Files:** Modify `apps/api/prisma/schema.prisma`, add migration, create `apps/api/src/competitions/season-playing-roster.service.ts`, modify `apps/api/src/competitions/schedules.service.ts`, add a season playing-roster read endpoint and contract.

**Interfaces:** `captureSeasonPlayingRoster(tx, seasonId)` is idempotent and creates one row per active ownership for each approved team when the first league stage is published and season enters `IN_PROGRESS`; season playing-roster query reads those rows only.

- [x] Cover snapshot capture, repeated capture, legacy seasons, and participant access with unit tests.
- [x] Add a database-backed transfer/release test that verifies the original team retains the current-season snapshot and the buyer appears next season.
- [x] Add schema/migration, capture service and read contract; wire at season transition.
- [x] Run focused tests and old-entry regression tests.

### Task 4: End-to-end verification and delivery

**Files:** Adjust only failures caused by Tasks 1-3; document migration order.

- [x] Run `pnpm db:status` against the local verify database; target environment remains to be checked before deployment.
- [ ] Run API and admin unit suites, typecheck, lint and build, with explicit isolated database URL on API tests.
- [ ] Run relevant e2e tests against local verify database, clean and recheck generated data.
- [ ] Regress backend active/exited team list, team detail and miniprogram “我的联赛”; identify any unverified target-environment checks.
