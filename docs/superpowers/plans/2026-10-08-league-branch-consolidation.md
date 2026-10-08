# League Branch Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `codex/league-center-banner` the single complete branch by integrating all unique behavior from `codex/league-presentation-admin-binding` without losing the center branch's newer league, admin, data-sync, mini-program, and roster workflows.

**Architecture:** Merge the presentation branch into the current center branch so Git records ancestry, then resolve conflicts by preserving the center branch's current interfaces and UI while porting the presentation branch's automatic-overall salary semantics and public-league authorization fix. Reconcile the shared development database only after the merged Prisma schema and migration history are final.

**Tech Stack:** Git, TypeScript, React, NestJS, Prisma/MySQL, Vitest, Jest, native WeChat mini-program.

**Spec:** `codex/league-presentation-admin-binding:docs/superpowers/specs/2026-10-07-auto-overall-salary-design.zh-CN.md`

## Global Constraints

- Work directly on `codex/league-center-banner`; do not create another branch or worktree.
- Preserve all 122 center-only commits and integrate all 12 presentation-only commits.
- Salary tiers, roster snapshots, acquisition, transfer, upgrade, and recalculation must consistently use automatic-build overall rather than DT.
- Preserve the current center branch's richer admin acquisition filters, team-shell workflows, data-sync center, league workspaces, and mini-program UI.
- Keep the shared local database; perform schema repair only after the final migration shape is known and do not discard existing snapshot data.

## Review Focus

- Existing `min_dt_rating` databases and already-renamed `min_overall` databases must both reach the merged schema without a half-applied migration.
- Trending/final cards with persisted automatic builds must remain searchable and purchasable even when DT is null.
- Trainable cards without persisted builds must derive the same automatic overall in API, admin UI, and mini-program.
- The enriched purchase drawer filters, optional reason, transaction-fee rules, and roster limits from the center branch must survive conflict resolution.
- Public league detail must not receive an admin bearer token, while protected admin calls must continue to refresh authentication correctly.

---

### Task 1: Record Branch Ancestry and Resolve Presentation/UI Conflicts

**Files:**
- Modify: `apps/admin-web/src/leagues/seasons-page.tsx`
- Modify: `apps/admin-web/src/rosters/acquire-player-drawer.tsx`
- Modify: `apps/admin-web/src/rosters/roster-page.tsx`
- Modify: `apps/admin-web/src/rosters/upgrade-card-drawer.tsx`
- Modify: corresponding `*.spec.tsx` files
- Modify: `apps/admin-web/src/lib/api.ts`

**Interfaces:**
- Consumes: current center-branch roster and league-management UI.
- Produces: the same UI with automatic-overall terminology and correct public/admin authentication boundaries.

- [ ] **Step 1: Merge `codex/league-presentation-admin-binding` with `--no-commit` and enumerate conflicts.**
- [ ] **Step 2: Resolve admin UI conflicts by retaining center layouts, filters, optional reason, and fee behavior while adopting automatic-overall fields/copy.**
- [ ] **Step 3: Retain the presentation branch's public league-detail token omission in `api.ts`.**
- [ ] **Step 4: Run `pnpm --filter @efm/admin-web test` and require all tests to pass.**

### Task 2: Consolidate Contracts, Prisma Schema, and Migration

**Files:**
- Modify: `packages/contracts/src/league-roster.ts`
- Modify: `packages/contracts/src/player-catalog.ts`
- Modify: `packages/contracts/src/player-auto-build.ts`
- Modify: `apps/api/prisma/schema.prisma`
- Modify/Create: `apps/api/prisma/migrations/20261007090000_auto_overall_salary/migration.sql`
- Test: `packages/contracts/src/contracts.spec.ts`

**Interfaces:**
- Consumes: persisted `PlayerCardAutoBuild.maxOverall` and current roster DTOs.
- Produces: automatic-overall salary tier and ownership snapshot contracts used by API and both clients.

- [ ] **Step 1: Resolve contract conflicts so automatic overall is the salary input and DT remains optional legacy metadata only.**
- [ ] **Step 2: Resolve Prisma conflicts to use `min_overall`, `max_overall`, and `max_overall_snapshot` consistently.**
- [ ] **Step 3: Make the migration safe for the current shared database state and retain existing snapshot values.**
- [ ] **Step 4: Run `pnpm --filter @efm/contracts test`, Prisma generation, and API typecheck.**

### Task 3: Consolidate API Salary, Roster, Build, and PESDATA Behavior

**Files:**
- Modify: `apps/api/src/league-rosters/admin-roster-queries.service.ts`
- Modify: `apps/api/src/league-rosters/roster-transactions.service.ts`
- Modify: `apps/api/src/league-rosters/salary-rules.service.ts`
- Modify: `apps/api/src/league-rosters/salary-recalculation.service.ts`
- Modify: `apps/api/src/player-builds/player-builds.service.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata-mapper.ts`
- Modify: corresponding unit and E2E tests

**Interfaces:**
- Consumes: consolidated automatic-overall contracts and schema from Task 2.
- Produces: player search, purchase, transfer, upgrade, roster, and salary recalculation responses based on automatic overall.

- [ ] **Step 1: Resolve service conflicts while preserving center-only transaction-fee and data-sync behavior.**
- [ ] **Step 2: Keep deterministic fallback derivation for cards whose automatic build has not yet been persisted.**
- [ ] **Step 3: Run focused roster, salary, player-build, PESDATA, and league-roster E2E tests.**
- [ ] **Step 4: Run the complete API unit and E2E suites.**

### Task 4: Consolidate Mini-program Behavior

**Files:**
- Modify: `apps/miniprogram/miniprogram/pages/players/players.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/league-team-detail/index.wxml`
- Verify: `apps/miniprogram/miniprogram/pages/player-card-detail/player-auto-build.ts`
- Test: relevant mini-program view-model and runtime dependency specs

**Interfaces:**
- Consumes: merged player-card responses using automatic overall.
- Produces: current center UI without DT-based recommendation or workspace runtime imports.

- [ ] **Step 1: Resolve mini-program conflicts while preserving the current design and navigation.**
- [ ] **Step 2: Verify no runtime `require("@efm/contracts")` is emitted for the player-card detail page.**
- [ ] **Step 3: Run `pnpm --filter @efm/miniprogram test`, typecheck, and build.**

### Task 5: Reconcile Database and Verify the Complete Branch

**Files:**
- Modify only through the finalized Prisma migration and controlled local SQL reconciliation.

**Interfaces:**
- Consumes: final merged Prisma schema and migration history.
- Produces: a shared local database compatible with `codex/league-center-banner`.

- [ ] **Step 1: Inspect live columns and migration records before changing the database.**
- [ ] **Step 2: Apply the final automatic-overall schema without deleting existing snapshot data.**
- [ ] **Step 3: Re-run player candidate search for `加克波` and verify max overall `95`, salary `300`, and HTTP 200.**
- [ ] **Step 4: Run `pnpm verify`; require lint, typecheck, unit tests, E2E tests, and builds to pass.**
- [ ] **Step 5: Verify the admin purchase drawer and mini-program card detail manually with zero runtime errors.**
- [ ] **Step 6: Commit the resolved merge, push `codex/league-center-banner`, and confirm `git merge-base --is-ancestor codex/league-presentation-admin-binding codex/league-center-banner` succeeds.**
