# Player Auction Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add administrator-configured player auction batches and reliable group bidding with server-authoritative 30-second deadlines, manual next-lot control, and manual result review.

**Architecture:** Extend the WeChat bot foundation with auction aggregate tables, a transaction-locked state machine, a database-time deadline worker, and command handlers. Every bid and state transition is durable; group replies use the existing inbox/outbox, while the admin web configures lots and reviews results without changing finance or rosters.

**Tech Stack:** TypeScript 5.9, NestJS 12, Prisma 7/MySQL, Zod contracts, React 19/Ant Design, Jest/Supertest/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-wechat-group-bot-auction-design.zh-CN.md`

**Prerequisite:** Complete `docs/superpowers/plans/2026-10-09-wechat-group-bot-foundation-implementation-plan.md` first.

## Global Constraints

- Each lot independently stores a positive integer starting price and positive integer minimum increment.
- A valid bid is a pure positive decimal integer, comes from an actively bound user who owns an active team in the group league, and arrives before the authoritative deadline.
- The first valid bid is at least the starting price; every later valid bid is at least current price plus the lot minimum increment.
- Money is rendered as `⭐120⭐`; users send only `120`.
- Every valid bid resets the deadline to database current time plus exactly 30 seconds.
- Countdown display marks are `30, 20, 10, 5, 4, 3, 2, 1`; display latency never changes the deadline.
- A closed lot never auto-starts the next lot; only an authorized `下一位` command does so.
- No auction operation checks balance, salary cap, roster capacity, or player ownership, and no review creates finance or roster transactions.
- Heartbeat loss, API restart ambiguity, or send circuit breaker changes an active batch to `RECOVERY_REQUIRED`; it never guesses a winner.

## Review Focus

- Two valid bids with the same WeChat timestamp must resolve deterministically by stable message order without both becoming highest; pinned in Task 3 concurrency tests.
- A stale countdown worker tick from the previous deadline epoch must enqueue nothing after a bid reset; pinned in Task 4 worker tests.
- A numeric message sent while manually paused must be audited as rejected and must not alter the remaining time; pinned in Task 3 state tests.
- A group administrator bound to another league must not control this batch; pinned in Task 5 command authorization tests.
- Result review, including an adjusted winner or price, must leave `FinanceLedgerEntry`, `RosterTransaction`, and `LeaguePlayerOwnership` unchanged; pinned in Task 7 e2e tests.

---

### Task 1: Auction schema, permissions, and contracts

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261009130000_player_auction/migration.sql`
- Modify: `apps/api/prisma/seed.ts`
- Create: `packages/contracts/src/player-auction.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`

**Interfaces:**
- Consumes: `WechatGroupBinding`, `WechatIdentityBinding`, `LeagueTeam`, `Player`, `PlayerCard`, and admin/user identities.
- Produces: Prisma auction models and `PlayerAuctionBatch*`, `PlayerAuctionLot*`, `PlayerAuctionBid*`, `PlayerAuctionReview*` schemas exported from `@efm/contracts`.

- [ ] **Step 1: Write failing contract tests**

Cover batch/lot statuses, positive integer prices, ordered lot creation, bid audit results, review decisions, and response snapshots with ISO timestamps and `⭐price⭐` display helpers kept out of persistence contracts.

- [ ] **Step 2: Run contract tests and verify failure**

Run: `pnpm --filter @efm/contracts test`

Expected: FAIL because `player-auction.ts` does not exist.

- [ ] **Step 3: Add auction contracts**

Define create/update/prepare/list/detail/review request and response schemas. Require `expectedVersion` on every mutating admin request and a non-empty reason when a review changes the computed winner/price or voids a result.

- [ ] **Step 4: Add auction schema and migration**

Add `PlayerAuctionBatch`, `PlayerAuctionLot`, `PlayerAuctionBid`, and `PlayerAuctionReview` with the statuses and uniqueness rules from the spec. Store `deadlineEpoch`, `lastCountdownMark`, `wechatMessageId`, `wechatSortKey`, `wechatSentAt`, computed result, reviewed result, and optimistic versions. Enforce one bid per inbound message in the database; enforce one unresolved batch per group by locking the parent group row because MySQL has no partial unique index over active statuses.

- [ ] **Step 5: Seed `league.auction.manage` permission**

Grant it to the existing `LEAGUE_MANAGER` role without changing other permissions.

- [ ] **Step 6: Generate Prisma and run checks**

Run: `pnpm db:generate && pnpm --filter @efm/contracts test && pnpm --filter @efm/api typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/prisma packages/contracts/src
git commit -m "feat(auction): add player auction domain schema"
```

### Task 2: Admin auction aggregate service and API

**Files:**
- Create: `apps/api/src/player-auctions/player-auctions.module.ts`
- Create: `apps/api/src/player-auctions/admin-player-auctions.controller.ts`
- Create: `apps/api/src/player-auctions/admin-player-auctions.service.ts`
- Create: `apps/api/src/player-auctions/admin-player-auctions.service.spec.ts`
- Create: `apps/api/src/player-auctions/player-auction.errors.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: Task 1 models/contracts, `AdminScopeGuard`, `AdminMutationReceiptService`, and `AuditLogService`.
- Produces: `createBatch`, `updateBatch`, `replaceLots`, `prepare`, `cancel`, `list`, `detail`, and `reviewLot` league-scoped methods and REST endpoints.

- [ ] **Step 1: Write failing aggregate tests**

Assert league scope, draft-only editing, ordered unique lots, valid player/card references, positive pricing, prepare validation, one unresolved batch per group, optimistic conflict, cancellation rules, review reason requirements, and immutable original computed result.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @efm/api test -- admin-player-auctions.service.spec.ts --runInBand`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the aggregate service**

Use one transaction per mutation, lock the parent group binding before prepare, snapshot player display fields onto each lot, and write an admin audit entry for create, prepare, cancel, and review.

- [ ] **Step 4: Implement admin endpoints**

Expose CRUD/prepare/review routes under `/v1/admin/leagues/:leagueId/player-auctions`. Apply `AdminScopeGuard`, Zod pipes, idempotency keys, and contract response parsing consistent with existing admin modules.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `pnpm --filter @efm/api test -- admin-player-auctions.service.spec.ts --runInBand && pnpm --filter @efm/api typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/player-auctions apps/api/src/app.module.ts
git commit -m "feat(auction): add admin auction configuration API"
```

### Task 3: Transactional auction state machine and bid processing

**Files:**
- Create: `apps/api/src/player-auctions/player-auction-lock.repository.ts`
- Create: `apps/api/src/player-auctions/player-auction-state.service.ts`
- Create: `apps/api/src/player-auctions/player-auction-state.service.spec.ts`
- Create: `apps/api/src/player-auctions/player-auction-bid.service.ts`
- Create: `apps/api/src/player-auctions/player-auction-bid.service.spec.ts`
- Modify: `apps/api/src/player-auctions/player-auctions.module.ts`

**Interfaces:**
- Consumes: a persisted inbound message, active group/batch/lot, identity/team bindings, and Task 2 prepared batches.
- Produces: `start(groupBindingId, actorUserId)`, `pause(...)`, `resume(...)`, `next(...)`, `cancel(...)`, `enterRecovery(...)`, and `placeBid(inboundMessageId, amount)` returning typed transition/bid results.

- [ ] **Step 1: Write failing state-transition tests**

Cover ready→active first lot, active→paused with exact remaining milliseconds, paused→active, closed→next queued lot, last closed→completed, cancellation, invalid transitions, wrong group, and actor lacking `league.auction.manage`.

- [ ] **Step 2: Run state tests and verify failure**

Run: `pnpm --filter @efm/api test -- player-auction-state.service.spec.ts --runInBand`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement locking and state transitions**

Lock the `WechatGroupBinding`, batch, and active lot rows in stable order with `SELECT ... FOR UPDATE`. Use database current time for all deadline calculations. Start and every manual full restart at 30,000 ms; manual pause/resume preserves exact remaining time.

- [ ] **Step 4: Write failing bid tests**

Cover first bid equal to starting price, lower first bid, exact and insufficient increments, unbound sender, no team, team in another league, inactive/paused/recovery lot, message at/after deadline, duplicate message, overflow, numeric message auditing, and deterministic concurrent same-time bids ordered by `wechatSortKey` then message ID.

- [ ] **Step 5: Implement `placeBid`**

Parse no text here; accept a validated integer from the command router. Within the lot lock, persist every numeric attempt, update only valid highest bids, increment `deadlineEpoch`, set `lastCountdownMark = 30`, and set `deadlineAt = databaseNow + 30 seconds`.

- [ ] **Step 6: Run state and bid tests**

Run: `pnpm --filter @efm/api test -- player-auction-state.service.spec.ts player-auction-bid.service.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/player-auctions
git commit -m "feat(auction): process bids with authoritative deadlines"
```

### Task 4: Countdown, closing, and recovery workers

**Files:**
- Create: `apps/api/src/player-auctions/player-auction-clock.ts`
- Create: `apps/api/src/player-auctions/player-auction-worker.ts`
- Create: `apps/api/src/player-auctions/player-auction-worker.spec.ts`
- Create: `apps/api/src/player-auctions/player-auction-recovery.service.ts`
- Create: `apps/api/src/player-auctions/player-auction-recovery.service.spec.ts`
- Modify: `apps/api/src/player-auctions/player-auctions.module.ts`
- Modify: `apps/api/src/wechat-bot/wechat-bridge.service.ts`
- Modify: `apps/api/src/wechat-bot/wechat-outbox.service.ts`

**Interfaces:**
- Consumes: Task 3 state services, Foundation `WechatOutboxService`, device heartbeat/circuit status, and injectable `PlayerAuctionClock.now()`.
- Produces: periodic `tick()`, `closeDueLot(lotId, epoch)`, `onBridgeUnavailable(deviceId)`, and `recover(batchId, actorUserId)` behavior.

- [ ] **Step 1: Write failing countdown/closing tests**

Assert marks exactly `20,10,5,4,3,2,1` after the opening/valid-bid message covers 30; delayed ticks emit only the current applicable mark; stale epoch emits nothing; outbox congestion may skip marks; closing rechecks the epoch/deadline under lock; highest bid becomes `PENDING_REVIEW`; no bid becomes `NO_BID`; no next lot auto-starts.

- [ ] **Step 2: Run worker tests and verify failure**

Run: `pnpm --filter @efm/api test -- player-auction-worker.spec.ts --runInBand`

Expected: FAIL because the worker does not exist.

- [ ] **Step 3: Implement the injectable clock and worker**

Use a short process interval only to discover work; database timestamps and locks decide outcomes. Derive outbox business keys from lot ID, deadline epoch, and mark. On application bootstrap, overdue active lots go to recovery rather than closing automatically.

- [ ] **Step 4: Write failing recovery tests**

Cover heartbeat timeout, send circuit breaker, API bootstrap ambiguity, frozen remaining time, replay of messages before detection, rejection after detection, recovery summary, and authorized full 30-second restart.

- [ ] **Step 5: Implement recovery integration**

Bridge heartbeat transitions must call `onBridgeUnavailable` once per outage. Recovery must never enqueue obsolete countdown messages; retain bids and computed ordering for administrator inspection.

- [ ] **Step 6: Run worker/recovery tests and typecheck**

Run: `pnpm --filter @efm/api test -- player-auction-worker.spec.ts player-auction-recovery.service.spec.ts --runInBand && pnpm --filter @efm/api typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/player-auctions apps/api/src/wechat-bot
git commit -m "feat(auction): close and recover timed auctions"
```

### Task 5: Group commands and auction message formatting

**Files:**
- Create: `apps/api/src/player-auctions/player-auction-command.handler.ts`
- Create: `apps/api/src/player-auctions/player-auction-command.handler.spec.ts`
- Create: `apps/api/src/player-auctions/player-auction-message.formatter.ts`
- Create: `apps/api/src/player-auctions/player-auction-message.formatter.spec.ts`
- Modify: `apps/api/src/wechat-bot/wechat-command-router.service.ts`
- Modify: `apps/api/src/wechat-bot/wechat-bot.module.ts`
- Modify: `apps/api/src/player-auctions/player-auctions.module.ts`

**Interfaces:**
- Consumes: Task 3/4 services and persisted inbound messages from the Foundation router.
- Produces: handlers for `开始拍卖`, `暂停拍卖`, `继续拍卖`, `下一位`, `取消拍卖`, and pure integer bids, plus stable Chinese output text.

- [ ] **Step 1: Write failing formatter tests**

Snapshot queue summary, lot opening, valid bid (`【球队名称】出价有效：⭐120⭐，倒计时重置为 30 秒。`), invalid bid reasons, countdown marks, pending-review result, no-bid result, recovery pause, and completed batch. Assert every stored integer is rendered between two stars.

- [ ] **Step 2: Run formatter tests and verify failure**

Run: `pnpm --filter @efm/api test -- player-auction-message.formatter.spec.ts --runInBand`

Expected: FAIL because the formatter does not exist.

- [ ] **Step 3: Implement formatter**

Keep all user-facing copy and `money(value) => \`⭐${value}⭐\`` in this file. Use player/card snapshots and configured increment; do not read mutable catalog fields while formatting historical lots.

- [ ] **Step 4: Write failing command-handler tests**

Cover exact command matching, whitespace normalization, pure digits only, ignored mixed text, unauthorized manager, manager from another league, bid by unbound user, valid bid, duplicate inbound, and one outbox reply per handler result.

- [ ] **Step 5: Implement and register the handler**

The Foundation router delegates auction commands before its ordinary-chat ignore branch. Match no synonyms in v1. Use `AuthorizationService.can(userId, 'league.auction.manage', { type: 'LEAGUE', id })` for manager commands.

- [ ] **Step 6: Run command tests**

Run: `pnpm --filter @efm/api test -- player-auction-command.handler.spec.ts player-auction-message.formatter.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/player-auctions apps/api/src/wechat-bot
git commit -m "feat(auction): add WeChat auction commands"
```

### Task 6: Admin auction configuration and review UI

**Files:**
- Create: `apps/admin-web/src/auctions/auction-list-page.tsx`
- Create: `apps/admin-web/src/auctions/auction-list-page.spec.tsx`
- Create: `apps/admin-web/src/auctions/auction-editor-page.tsx`
- Create: `apps/admin-web/src/auctions/auction-editor-page.spec.tsx`
- Create: `apps/admin-web/src/auctions/auction-detail-page.tsx`
- Create: `apps/admin-web/src/auctions/auction-detail-page.spec.tsx`
- Modify: `apps/admin-web/src/app.tsx`
- Modify: `apps/admin-web/src/leagues/league-shell.tsx`
- Modify: `apps/admin-web/src/styles.css`

**Interfaces:**
- Consumes: Task 2 admin endpoints and contracts through `AdminApi.request`.
- Produces: league auction list, draft editor with ordered lots, live/read-only detail, bid audit, and manual review forms.

- [ ] **Step 1: Write failing list/editor tests**

Cover empty/error/loading states, create draft, player/card search selection, drag/order controls accessible without pointer input, per-lot starting price/increment, duplicate player warning, prepare validation, optimistic conflict, and cancellation confirmation.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @efm/admin-web test -- auction`

Expected: FAIL because auction pages do not exist.

- [ ] **Step 3: Implement list and editor pages**

Add `球员拍卖` to league workspace navigation. Keep draft editing separate from active detail, preserve unsaved-change warnings, and show `⭐price⭐` previews beside numeric inputs.

- [ ] **Step 4: Write failing detail/review tests**

Cover active/paused/recovery/pending-review/no-bid states, bid timeline, computed winner, confirm unchanged result, adjusted winner/price requiring reason, void requiring reason, and refresh without mutation.

- [ ] **Step 5: Implement detail and review pages**

Display that review does not modify funds or roster. Do not add buttons that call roster or ledger endpoints.

- [ ] **Step 6: Run UI tests and build**

Run: `pnpm --filter @efm/admin-web test && pnpm --filter @efm/admin-web typecheck && pnpm --filter @efm/admin-web build`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/src
git commit -m "feat(admin): configure and review player auctions"
```

### Task 7: Auction end-to-end and recovery verification

**Files:**
- Create: `apps/api/test/player-auctions.e2e-spec.ts`
- Create: `docs/development/player-auction-bot-verification.zh-CN.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: every prior task in this plan plus the complete Foundation plan.
- Produces: a simulated group auction acceptance path and a manual test checklist for Windows integration.

- [ ] **Step 1: Write the failing e2e happy-path test**

Configure group → bind two users with teams → create/prepare three lots with different prices/increments → start → reject insufficient bid → accept bids and reset deadline → tick countdown → close pending review → verify `下一位` requirement → produce a no-bid lot → complete → review. Assert all output price strings use two stars.

- [ ] **Step 2: Write the failing recovery/invariance e2e test**

Start a lot → bid → lose Bridge heartbeat → enter recovery → upload duplicate and pre-detection messages → reject post-detection bid → resume for 30 seconds → close. Snapshot counts and rows for `FinanceLedgerEntry`, `RosterTransaction`, and `LeaguePlayerOwnership` before and after review and assert no changes.

- [ ] **Step 3: Run e2e tests and verify failure**

Run: `pnpm --filter @efm/api test:e2e -- player-auctions.e2e-spec.ts --runInBand`

Expected: FAIL on incomplete module or worker integration.

- [ ] **Step 4: Complete only missing integration wiring**

Fix module boundaries, cleanup order, deterministic worker hooks, and contract mismatches found by e2e; do not add automatic finance/roster behavior.

- [ ] **Step 5: Document manual auction verification**

Include group commands, exact expected messages, deadline observation, invalid bids, manual next, recovery drill, result review, database evidence, and rollback/disable instructions.

- [ ] **Step 6: Run full project verification**

Run: `pnpm verify && pnpm db:status && git diff --check`

Expected: all commands PASS and migration status is current.

- [ ] **Step 7: Commit**

```bash
git add apps/api/test docs/development README.md
git commit -m "test(auction): verify group bidding and recovery"
```
