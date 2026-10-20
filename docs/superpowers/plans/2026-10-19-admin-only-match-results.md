# Administrator-Only Match Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all participant score submission, evidence, dispute, and adjudication surfaces while keeping administrator score entry/correction and historical data intact.

**Architecture:** Unregister participant and dispute controllers/workers at the Nest module boundary, keep legacy services/tables available to the administrator score command, remove match-result items from the shared action-center contract, and delete the now-unreachable mini/admin screens. Administrator score routes and their dispute-closing transaction stay unchanged.

**Tech Stack:** NestJS, Prisma, React/Ant Design, native WeChat Mini Program, Zod contracts, Jest, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-player-presentation-and-season-fixtures-design.md`

## Global Constraints

- Participants cannot submit, confirm, reject, upload/read evidence for, or open/view disputes.
- Removed participant routes must return `404`; hiding UI alone is insufficient.
- Keep both existing administrator result routes, required reason, optimistic version checks, and legacy-dispute closure.
- Do not delete historical result, evidence, dispute, event, audit tables, rows, retention support, or internal services used by administrator correction.
- Remove the administrator “赛果争议” menu, route, page, and API controller registration.
- Preserve unrelated working-tree changes, especially current admin-shell edits.

## Review Focus

- Old participant clients calling every removed mutation/read path must receive `404`; Task 1 pins controller/module absence.
- Administrator score correction over a legacy active dispute must still resolve it and update standings once; Task 1 pins this.
- Evidence retention for historical records must remain registered even though participant upload endpoints disappear; Task 1 pins this.
- Action-center responses created from old pending/disputed matches must contain no match-result items or counts; Task 2 pins this.
- No mini-program template or admin navigation may retain a route to a removed screen; Tasks 3 and 4 pin this.

---

### Task 1: Close Participant and Dispute API Surfaces

**Files:**
- Modify: `apps/api/src/competitions/results.controller.ts`
- Modify: `apps/api/src/competitions/results.controller.spec.ts`
- Modify: `apps/api/src/competitions/competitions.module.ts`
- Create: `apps/api/src/competitions/competitions.module.spec.ts`
- Test: `apps/api/src/competitions/results.service.spec.ts`

**Interfaces:**
- Consumes: existing `ResultsService.recordByManager(...)` and `recordByLeagueAdmin(...)`.
- Produces: `ResultsController` exposing only the two administrator result mutations and public standings; module metadata excludes `ResultEvidenceController`, `AdminMatchResultDisputesController`, and `MatchResultDeadlineWorker` while retaining `ResultEvidenceRetentionWorker` and internal dispute services.

- [ ] **Step 1: Replace route-presence tests with route-absence and admin-preservation tests**

Assert participant result/dispute methods no longer have route metadata or no longer exist, module controllers/providers omit the three disabled classes, and both administrator result paths retain their guards. Add/retain a service test where administrator correction resolves a legacy active dispute and keeps audit/standings behavior.

- [ ] **Step 2: Run focused API tests and verify red**

Run: `pnpm --filter @efm/api test -- --runInBand src/competitions/results.controller.spec.ts src/competitions/competitions.module.spec.ts src/competitions/results.service.spec.ts`

Expected: FAIL while participant/dispute controllers and the deadline worker remain registered.

- [ ] **Step 3: Remove public methods and module registrations**

Delete participant route methods/imports from `ResultsController`; unregister result-evidence and admin-dispute controllers and the deadline worker. Keep `MatchResultDisputesService`, `ResultEvidenceStorageService`, `ResultEvidenceRetentionWorker`, result events, and administrator score methods because historical cleanup and legacy dispute closure still use them.

- [ ] **Step 4: Run focused API tests and verify green**

Run: `pnpm --filter @efm/api test -- --runInBand src/competitions/results.controller.spec.ts src/competitions/competitions.module.spec.ts src/competitions/results.service.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/competitions/results.controller.ts apps/api/src/competitions/results.controller.spec.ts apps/api/src/competitions/competitions.module.ts apps/api/src/competitions/competitions.module.spec.ts apps/api/src/competitions/results.service.spec.ts
git commit -m "feat: restrict match results to administrators"
```

### Task 2: Remove Match Results from the Action Center

**Files:**
- Modify: `packages/contracts/src/action-center.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`
- Modify: `apps/api/src/action-center/action-center.service.ts`
- Modify: `apps/api/src/action-center/action-center.service.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/action-center/action-center.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/action-center/action-center.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/action-center/action-center.page.spec.ts`

**Interfaces:**
- Consumes: transaction, forced-transfer, and auction action-center sources.
- Produces: `ActionCenterSource = 'TRANSACTION' | 'FORCED_TRANSFER' | 'AUCTION'`; no match query, route, item, or source count remains.

- [ ] **Step 1: Write failing contract/service/view-model assertions**

Assert `MATCH_RESULT` is rejected by the schema, the API does not query matches even when legacy rows exist, and mini-program counts/labels include only the three retained sources.

- [ ] **Step 2: Run focused tests and verify red**

Run: `pnpm --filter @efm/contracts test && pnpm --filter @efm/api test -- --runInBand src/action-center/action-center.service.spec.ts && pnpm --filter @efm/miniprogram test -- miniprogram/pages/action-center`

Expected: FAIL because match-result remains a source.

- [ ] **Step 3: Remove match aggregation end-to-end**

Delete `MATCH_SELECT`, match queries, `matchItem`, source schema value/refinement, mini-program label/count handling, and match-route fixtures. Keep all non-score action-center behavior unchanged.

- [ ] **Step 4: Verify contracts, API, and mini-program**

Run: `pnpm --filter @efm/contracts test && pnpm --filter @efm/api test -- --runInBand src/action-center && pnpm --filter @efm/miniprogram test -- miniprogram/pages/action-center`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/action-center.ts packages/contracts/src/contracts.spec.ts apps/api/src/action-center apps/miniprogram/miniprogram/pages/action-center
git commit -m "feat: remove score tasks from action center"
```

### Task 3: Remove Participant Match-Result Client Surface

**Files:**
- Modify: `apps/miniprogram/miniprogram/services/competitions.ts`
- Modify: `apps/miniprogram/miniprogram/services/competitions.spec.ts`
- Modify: `apps/miniprogram/miniprogram/app.json`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/matches.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/matches.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/my-matches.template.spec.ts`
- Delete: `apps/miniprogram/miniprogram/pages/match-result/index.ts`
- Delete: `apps/miniprogram/miniprogram/pages/match-result/index.wxml`
- Delete: `apps/miniprogram/miniprogram/pages/match-result/index.wxss`
- Delete: `apps/miniprogram/miniprogram/pages/match-result/index.json`
- Delete: `apps/miniprogram/miniprogram/pages/match-result/result.viewmodel.ts`
- Delete: `apps/miniprogram/miniprogram/pages/match-result/result.viewmodel.spec.ts`
- Delete: `apps/miniprogram/miniprogram/pages/match-result/match-result.page.spec.ts`
- Delete: `apps/miniprogram/miniprogram/services/result-evidence.ts` and its participant-only tests if no other caller remains.

**Interfaces:**
- Consumes: none.
- Produces: a mini-program bundle with no participant score/evidence methods or match-result page registration; the existing personal match list remains temporarily read-only until the season-wide fixture plan replaces its data source.

- [ ] **Step 1: Add failing absence assertions**

Update service/app manifest tests to assert no submit/confirm/reject/dispute/evidence API methods and no `pages/match-result/index` registration or route strings remain. Add match-list assertions that cards have no tap handler, action/deadline copy, or score workflow dependency, while official scores remain visible.

- [ ] **Step 2: Run focused tests and verify red**

Run: `pnpm --filter @efm/miniprogram test -- miniprogram/services/competitions.spec.ts miniprogram/pages/action-center miniprogram/pages/my-matches`

Expected: FAIL while methods and page registration remain.

- [ ] **Step 3: Remove participant client methods and page files**

Delete only participant mutations/readers and their unused imports/types. Make `my-matches` read-only by removing `openMatch`, dispute/deadline/action copy, and its import from `result.viewmodel`. Remove the page from `app.json`; then delete the match-result files and delete the evidence service only after `rg -n "result-evidence|match-result" apps/miniprogram/miniprogram` proves they have no retained caller.

- [ ] **Step 4: Verify no dead route remains**

Run: `rg -n "pages/match-result|submitResult|confirmResult|rejectResult|openTimeoutDispute|attachResultEvidence" apps/miniprogram/miniprogram` (expected: no matches), then `pnpm --filter @efm/miniprogram test` (expected: PASS).

- [ ] **Step 5: Commit**

```bash
git add -A apps/miniprogram/miniprogram
git commit -m "refactor: remove participant score client"
```

### Task 4: Remove Administrator Dispute Navigation and Page

**Files:**
- Modify: `apps/admin-web/src/app.tsx`
- Modify: `apps/admin-web/src/leagues/league-shell.tsx`
- Modify: `apps/admin-web/src/leagues/league-shell.spec.tsx`
- Create: `apps/admin-web/src/app.spec.tsx`
- Modify: `apps/admin-web/src/styles.css`
- Delete: `apps/admin-web/src/leagues/result-disputes-page.tsx`
- Delete: `apps/admin-web/src/leagues/result-disputes-page.spec.tsx`

**Interfaces:**
- Consumes: existing administrator schedule score editor, which is unchanged.
- Produces: no `/leagues/:leagueId/result-disputes` route or “赛果争议” navigation entry.

- [ ] **Step 1: Write failing shell/route assertions**

Assert the tabs omit “赛果争议”, the app route tree has no `result-disputes`, and the normal schedule/admin result editor remains discoverable in its existing tests.

- [ ] **Step 2: Run focused admin tests and verify red**

Run: `pnpm --filter @efm/admin-web test -- src/leagues/league-shell.spec.tsx src/app.spec.tsx`

Expected: FAIL while the tab and lazy route remain.

- [ ] **Step 3: Remove route, tab, page, and page-only styles**

Remove the lazy import/route and active-key branch, delete the page files, and remove only selectors proven unique to that page. Reconcile existing dirty `styles.css` edits hunk by hunk.

- [ ] **Step 4: Verify admin surface**

Run: `pnpm --filter @efm/admin-web test && pnpm --filter @efm/admin-web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A apps/admin-web/src/app.tsx apps/admin-web/src/leagues apps/admin-web/src/styles.css
git commit -m "refactor: remove result dispute administration"
```
