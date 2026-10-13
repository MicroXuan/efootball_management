# Miniprogram Player Auction Room Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native WeChat miniprogram auction room and server-authoritative bidding while preserving the existing WeChat group robot auction as a selectable batch mode.

**Architecture:** Extend the existing `PlayerAuctionBatch` and `PlayerAuctionBid` records with explicit channels, then route group and miniprogram bids through one transactional arbitration service. Add authenticated participant APIs and native miniprogram pages that poll once per second, while admin controls and the existing worker continue to drive one shared persisted state machine.

**Tech Stack:** TypeScript 5.9, NestJS 12, Prisma 7/MySQL, Zod contracts, React 19/Ant Design 6, native WeChat miniprogram, Jest, Vitest, Supertest.

**Spec:** `docs/superpowers/specs/2026-10-10-miniprogram-player-auction-room-design.zh-CN.md`

## Global Constraints

- Work only on `codex/league-center-banner`; preserve the pre-existing unstaged miniprogram league/login edits and untracked `apps/api` agent configuration.
- Existing WeChat schedule queries, identity binding, pure-number group bids, countdown marks `20、10、3、2、1`, Windows Bridge behavior, and manual result review remain supported.
- A batch uses exactly one bid channel: `WECHAT_GROUP` or `MINIPROGRAM`; existing rows default to `WECHAT_GROUP`.
- Different leagues may auction concurrently; one league may have at most one batch in `READY`, `ACTIVE`, `PAUSED`, or `RECOVERY_REQUIRED`.
- The database clock is authoritative; an accepted bid resets the deadline to exactly 30 seconds.
- Miniprogram auctions continue when the Windows Bridge is unavailable; group auctions retain recovery behavior.
- Results remain review-only and never mutate finance, roster, or ownership records.
- Do not add WebSocket, SSE, payment, automated card sending, or a second authentication system.
- Miniprogram sharing path is `/pages/auction-room/index?batchId=<id>`.

## Review Focus

- A stale phone submitting the previous `lotId` or `deadlineEpoch` after auto-advance must receive `AUCTION_EPOCH_CHANGED` and must not create a bid.
- Concurrent retries with the same user/lot/idempotency key must return one persisted result and never reset the deadline twice.
- A Bridge outage must move `WECHAT_GROUP` batches to recovery but must leave `MINIPROGRAM` batches active and accepting bids.
- Concurrent prepare/start attempts for two batches in one league must leave at most one non-terminal batch; batches in different leagues must both succeed.
- A user whose team becomes non-active while the room is open must lose bid permission on the next read and receive `NO_ACTIVE_TEAM` on submission.

---

### Task 1: Persist bid channels and channel-neutral bid metadata

**Files:**
- Create: `apps/api/prisma/migrations/20261010180000_miniprogram_player_auction/migration.sql`
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `packages/contracts/src/player-auction.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`

**Interfaces:**
- Produces: `PlayerAuctionBidChannel = 'WECHAT_GROUP' | 'MINIPROGRAM'`.
- Produces: `PlaceMiniprogramAuctionBidRequest = { amount: number; lotId: string; deadlineEpoch: number }`.
- Produces: channel-aware batch and bid response schemas consumed by every later task.

- [ ] **Step 1: Write failing contract tests**

Add tests named `parses channel-aware auction batches`, `parses miniprogram bid requests`, and `rejects invalid auction money and epochs`. Assert that existing batch fixtures parse with `bidChannel: 'WECHAT_GROUP'`, miniprogram requests require a positive integer amount plus UUID-like resource IDs and a non-negative integer epoch, and bid views allow nullable WeChat-only fields.

- [ ] **Step 2: Run the focused contracts test and verify failure**

Run: `pnpm --filter @efm/contracts test -- contracts.spec.ts`

Expected: FAIL because channel and miniprogram bid schemas do not exist.

- [ ] **Step 3: Add contract types and channel-neutral bid fields**

In `packages/contracts/src/player-auction.ts`, export `PlayerAuctionBidChannelSchema`, `PlaceMiniprogramAuctionBidRequestSchema`, and inferred types. Extend batch schemas with `bidChannel`; extend bid schemas with `source`, `submittedAt`, nullable WeChat fields, and keep `receivedAt`.

- [ ] **Step 4: Add the Prisma schema and forward-only migration**

Add `PlayerAuctionBidChannel`, `PlayerAuctionBatch.bidChannel @default(WECHAT_GROUP)`, `PlayerAuctionBid.source @default(WECHAT_GROUP)`, nullable WeChat-only columns, nullable `idempotencyKey`, and required `submittedAt`. Add `@@unique([lotId, userId, idempotencyKey])` and an ordering index on `[lotId, submittedAt, id]`. The SQL migration must backfill `submitted_at = wechat_sent_at` before making it non-null and must preserve all existing foreign keys and rows.

- [ ] **Step 5: Generate Prisma and run schema checks**

Run: `pnpm db:generate && pnpm --filter @efm/contracts test -- contracts.spec.ts && pnpm --filter @efm/api typecheck`

Expected: all commands PASS.

- [ ] **Step 6: Commit the data contract**

```bash
git add apps/api/prisma packages/contracts/src/player-auction.ts packages/contracts/src/contracts.spec.ts
git commit -m "feat(auction): add miniprogram bid channel"
```

### Task 2: Unify transactional bid arbitration

**Files:**
- Modify: `apps/api/src/player-auctions/player-auction-bid.service.ts`
- Modify: `apps/api/src/player-auctions/player-auction-bid.service.spec.ts`
- Modify: `apps/api/src/player-auctions/player-auction-lock.repository.ts`
- Modify: `apps/api/src/player-auctions/player-auction-command.handler.ts`
- Modify: `apps/api/src/player-auctions/player-auction-command.handler.spec.ts`

**Interfaces:**
- Consumes: Task 1 channel and request types.
- Produces: existing `placeBid(inboundMessageId: string, amount: number)` for group compatibility.
- Produces: `placeMiniprogramBid(userId: string, batchId: string, input: PlaceMiniprogramAuctionBidRequest, idempotencyKey: string)`.
- Produces: `PlayerAuctionLockRepository.lockLeague(tx, leagueId)` and fixed lock order league → batch → lot.

- [ ] **Step 1: Add failing group-regression and miniprogram unit tests**

Cover: existing group bid response text is unchanged; a group bid is rejected for a `MINIPROGRAM` batch with `AUCTION_CHANNEL_MISMATCH`; an active-team miniprogram user can bid; a user with a newly archived team receives `NO_ACTIVE_TEAM`; and a client-provided timestamp is never accepted or read.

- [ ] **Step 2: Add failing stale-state and idempotency tests**

Assert stale `lotId` or epoch returns `AUCTION_EPOCH_CHANGED` without inserting; the same idempotency key returns the original result; two simultaneous uses of that key create one row and reset the deadline once; distinct keys can create consecutive valid bids.

- [ ] **Step 3: Run the focused service tests and verify failure**

Run: `pnpm --filter @efm/api test -- player-auction-bid.service.spec.ts player-auction-command.handler.spec.ts`

Expected: FAIL on missing miniprogram method, channel checks, and league lock.

- [ ] **Step 4: Implement channel-aware arbitration**

Keep the public group method signature. Resolve group identity as today, but require `WECHAT_GROUP`. Implement the miniprogram method using authenticated `userId`, server-side active `LeagueTeam` lookup, the request lot/epoch, and transaction database time. Share the minimum-price calculation and deadline reset inside one private transaction path; do not trust a client team, time, price, or batch status.

- [ ] **Step 5: Normalize persisted ordering**

Store group `submittedAt` from verified `wechatSentAt`, miniprogram `submittedAt` from `locks.now(tx)`, and order/replay only within the batch channel. Retain existing stable group sort fields for equal WeChat timestamps.

- [ ] **Step 6: Run focused and full auction unit tests**

Run: `pnpm --filter @efm/api test -- player-auction`

Expected: all player-auction unit suites PASS, including existing group tests.

- [ ] **Step 7: Commit arbitration**

```bash
git add apps/api/src/player-auctions
git commit -m "feat(auction): arbitrate miniprogram bids"
```

### Task 3: Add authenticated participant auction APIs

**Files:**
- Create: `apps/api/src/player-auctions/my-player-auctions.controller.ts`
- Create: `apps/api/src/player-auctions/my-player-auctions.service.ts`
- Create: `apps/api/src/player-auctions/my-player-auctions.service.spec.ts`
- Modify: `apps/api/src/player-auctions/player-auctions.module.ts`
- Modify: `packages/contracts/src/player-auction.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`

**Interfaces:**
- Consumes: `placeMiniprogramBid(...)` from Task 2.
- Produces: `GET /v1/me/player-auctions?status=active`.
- Produces: `GET /v1/me/player-auctions/:batchId`.
- Produces: `POST /v1/me/player-auctions/:batchId/bids` with `Idempotency-Key`.
- Produces: `MyPlayerAuctionRoom` including `serverNow`, team summary, `canBid`, current lot, minimum valid price, visible valid bids, queue, and share path.

- [ ] **Step 1: Add failing room projection tests**

Test active-team access, cross-league denial, archived-team denial after an earlier successful read, no leakage of failed bids or WeChat identifiers, exact share path, and correct minimum valid price before and after the first valid bid.

- [ ] **Step 2: Add failing controller/guard tests**

Assert all three routes use `JwtAuthGuard`; POST requires a non-empty idempotency key; malformed amount/lot/epoch receives validation error; duplicate key returns the original response.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `pnpm --filter @efm/api test -- my-player-auctions.service.spec.ts`

Expected: FAIL because controller, service, and response schemas are absent.

- [ ] **Step 4: Implement `MyPlayerAuctionsService`**

Add `list(userId, status)`, `detail(userId, batchId)`, and `placeBid(userId, batchId, input, key)`. Reads must require an active team in the batch league; detail returns only valid public bid fields and uses database time for `serverNow`.

- [ ] **Step 5: Implement guarded routes and module registration**

Use `JwtAuthGuard`, `CurrentUser`, `ZodValidationPipe`, and the existing error envelope. Limit `status` to a small explicit filter rather than forwarding arbitrary Prisma conditions.

- [ ] **Step 6: Run API unit tests and typecheck**

Run: `pnpm --filter @efm/api test -- my-player-auctions player-auction-bid && pnpm --filter @efm/api typecheck`

Expected: PASS.

- [ ] **Step 7: Commit participant APIs**

```bash
git add apps/api/src/player-auctions packages/contracts/src/player-auction.ts packages/contracts/src/contracts.spec.ts
git commit -m "feat(api): expose participant auction room"
```

### Task 4: Enforce league-level exclusivity and add admin lifecycle controls

**Files:**
- Modify: `apps/api/src/player-auctions/player-auction-state.service.ts`
- Modify: `apps/api/src/player-auctions/player-auction-state.service.spec.ts`
- Modify: `apps/api/src/player-auctions/admin-player-auctions.controller.ts`
- Modify: `apps/api/src/player-auctions/admin-player-auctions.service.ts`
- Modify: `apps/api/src/player-auctions/admin-player-auctions.service.spec.ts`
- Modify: `packages/contracts/src/player-auction.ts`

**Interfaces:**
- Consumes: Task 1 `bidChannel` and Task 2 league lock.
- Produces: create/update contracts containing `bidChannel`.
- Produces: idempotent admin `start`, `pause`, and `resume` endpoints using `expectedVersion`.
- Preserves: existing group-command state methods and authorization.

- [ ] **Step 1: Add failing create/prepare conflict tests**

Assert channel defaults are explicit, channel cannot change after draft, two groups in the same league cannot both hold non-terminal batches, and batches in two different leagues can both prepare.

- [ ] **Step 2: Add failing admin lifecycle tests**

Test start from `READY`, pause from `ACTIVE`, resume from `PAUSED`, exact 30-second start deadline, version conflicts, idempotent retry receipts, and authorization via `league.auction.manage`.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `pnpm --filter @efm/api test -- admin-player-auctions.service.spec.ts player-auction-state.service.spec.ts`

Expected: FAIL on league-level conflict and missing lifecycle endpoints.

- [ ] **Step 4: Refactor state transitions around batch identity**

Add internal transition methods that lock league → batch → lot and are callable by both the existing group-authorized wrapper and the admin-authorized service. Keep public group command behavior and response messages unchanged.

- [ ] **Step 5: Implement admin channel and lifecycle mutations**

Persist `bidChannel` at creation, reject channel changes after draft, lock the league while preparing/starting, and add controller actions with `Idempotency-Key`, `expectedVersion`, audit records, and mutation receipts.

- [ ] **Step 6: Run the full API auction unit set**

Run: `pnpm --filter @efm/api test -- player-auction`

Expected: PASS.

- [ ] **Step 7: Commit admin lifecycle**

```bash
git add apps/api/src/player-auctions packages/contracts/src/player-auction.ts
git commit -m "feat(auction): control channel batches from admin"
```

### Task 5: Decouple miniprogram auctions from Bridge recovery

**Files:**
- Modify: `apps/api/src/player-auctions/player-auction-worker.ts`
- Modify: `apps/api/src/player-auctions/player-auction-worker.spec.ts`
- Modify: `apps/api/src/player-auctions/player-auction-recovery.service.ts`
- Modify: `apps/api/src/player-auctions/player-auction-recovery.service.spec.ts`
- Modify: `apps/api/src/player-auctions/player-auction-command.handler.ts`
- Modify: `apps/api/src/player-auctions/player-auction-command.handler.spec.ts`
- Modify: `apps/api/src/player-auctions/player-auction-message.formatter.ts`
- Modify: `apps/api/src/player-auctions/player-auction-message.formatter.spec.ts`

**Interfaces:**
- Consumes: channel-aware batches and fixed lock order.
- Produces: best-effort group notifications for `MINIPROGRAM` batches.
- Produces: channel mismatch reply `本批次请点击小程序拍卖大厅出价。` under existing rate limits.

- [ ] **Step 1: Add failing recovery separation tests**

Assert a Bridge outage transitions active `WECHAT_GROUP` batches only; `MINIPROGRAM` batches remain active; bootstrap overdue recovery follows the same rule; later Bridge restoration does not reset miniprogram deadlines.

- [ ] **Step 2: Add failing worker tests**

Assert both channels close due lots and auto-open the next lot; group mode preserves countdown outbox behavior; miniprogram mode still closes when outbox is congested or unavailable; expired countdowns are not recreated after recovery.

- [ ] **Step 3: Add failing group numeric-message test for miniprogram mode**

Assert no bid row is created and the exact instruction is enqueued once through existing throttling; group admin start/pause/resume commands still work.

- [ ] **Step 4: Run focused tests and verify failure**

Run: `pnpm --filter @efm/api test -- player-auction-worker.spec.ts player-auction-recovery.service.spec.ts player-auction-command.handler.spec.ts`

Expected: FAIL because recovery and bid routing are not channel-aware.

- [ ] **Step 5: Implement channel-aware worker, recovery, and command routing**

Change due-lot processing to lock league → batch → lot before re-reading state. Treat miniprogram group messages and all notifications as auxiliary; never make an outbox failure block the persisted transition.

- [ ] **Step 6: Run all WeChat bot and auction unit tests**

Run: `pnpm --filter @efm/api test -- player-auction wechat`

Expected: PASS with previous message-format assertions unchanged except the new channel instruction.

- [ ] **Step 7: Commit recovery separation**

```bash
git add apps/api/src/player-auctions
git commit -m "feat(auction): keep app auctions alive without bridge"
```

### Task 6: Add channel selection and lifecycle controls to admin web

**Files:**
- Modify: `apps/admin-web/src/auctions/auction-editor-page.tsx`
- Modify: `apps/admin-web/src/auctions/auction-editor-page.spec.tsx`
- Modify: `apps/admin-web/src/auctions/auction-detail-page.tsx`
- Modify: `apps/admin-web/src/auctions/auction-detail-page.spec.tsx`
- Modify: `apps/admin-web/src/auctions/auction-list-page.tsx`
- Modify: `apps/admin-web/src/styles.css`

**Interfaces:**
- Consumes: channel-aware admin contracts and lifecycle endpoints.
- Produces: immutable post-create channel selection and start/pause/resume UI.
- Produces: miniprogram share path instructions without attempting automated WeChat sharing.

- [ ] **Step 1: Add failing editor tests**

Test both channel options, default `WECHAT_GROUP`, request body persistence, immutable mode after batch creation, and explanatory copy distinguishing group numeric bids from app bids.

- [ ] **Step 2: Add failing detail tests**

Test start/pause/resume button visibility by status, idempotency headers and expected versions, source-aware bid table labels, share path display for miniprogram mode, and Bridge outage copy that says bidding continues.

- [ ] **Step 3: Run focused admin tests and verify failure**

Run: `pnpm --filter @efm/admin-web test -- auction-editor-page.spec.tsx auction-detail-page.spec.tsx`

Expected: FAIL on missing channel controls and lifecycle actions.

- [ ] **Step 4: Implement editor and detail UI**

Use existing Ant Design patterns and API client. Update legacy copy such as “微信群负责实时出价” to depend on `bidChannel`; keep review, cancel, and lot ordering behavior unchanged.

- [ ] **Step 5: Run admin tests, typecheck, and build**

Run: `pnpm --filter @efm/admin-web test && pnpm --filter @efm/admin-web typecheck && pnpm --filter @efm/admin-web build`

Expected: PASS.

- [ ] **Step 6: Commit admin UI**

```bash
git add apps/admin-web/src/auctions apps/admin-web/src/styles.css
git commit -m "feat(admin): manage miniprogram auctions"
```

### Task 7: Build the miniprogram auction client and view model

**Files:**
- Create: `apps/miniprogram/miniprogram/services/player-auctions.ts`
- Create: `apps/miniprogram/miniprogram/pages/auction-room/auction-room.viewmodel.ts`
- Create: `apps/miniprogram/miniprogram/pages/auction-room/auction-room.viewmodel.spec.ts`
- Create: `apps/miniprogram/miniprogram/pages/player-auctions/player-auctions.viewmodel.ts`
- Create: `apps/miniprogram/miniprogram/pages/player-auctions/player-auctions.viewmodel.spec.ts`

**Interfaces:**
- Consumes: Task 3 list/detail/bid APIs and contract schemas.
- Produces: `listMyPlayerAuctions()`, `getMyPlayerAuction(batchId)`, and `placeMyPlayerAuctionBid(batchId, input, idempotencyKey)`.
- Produces: pure functions for countdown, status labels, minimum-price shortcuts, bid feedback, queue projections, and share metadata.

- [ ] **Step 1: Add failing countdown and stale-room ViewModel tests**

Assert server offset calculation, `30 → 20 → 10 → 3 → 2 → 1 → 0`, no negative display, pause behavior, epoch change replacement, background return resync, and reconnect labels after 1/2/5-second backoff.

- [ ] **Step 2: Add failing bid feedback and list projection tests**

Assert exact valid message `【球队名称】出价有效：⭐120⭐，倒计时重置为 30 秒。`, minimum required price, `DEADLINE_PASSED`, `AUCTION_EPOCH_CHANGED`, `NO_ACTIVE_TEAM`, and active auctions grouped by league without cross-league merging.

- [ ] **Step 3: Run focused miniprogram tests and verify failure**

Run: `pnpm --filter @efm/miniprogram test -- auction-room.viewmodel.spec.ts player-auctions.viewmodel.spec.ts`

Expected: FAIL because service and ViewModels do not exist.

- [ ] **Step 4: Implement API client and pure ViewModels**

Use the existing `api.request` and contract parsing pattern. Generate one idempotency key per user submission and reuse it only for retries of that same submission; never send team ID or client time.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `pnpm --filter @efm/miniprogram test -- auction && pnpm --filter @efm/miniprogram typecheck`

Expected: PASS.

- [ ] **Step 6: Commit miniprogram domain client**

```bash
git add apps/miniprogram/miniprogram/services/player-auctions.ts apps/miniprogram/miniprogram/pages/auction-room apps/miniprogram/miniprogram/pages/player-auctions
git commit -m "feat(miniprogram): model live player auctions"
```

### Task 8: Build and register native auction pages and sharing

**Files:**
- Create: `apps/miniprogram/miniprogram/pages/player-auctions/index.ts`
- Create: `apps/miniprogram/miniprogram/pages/player-auctions/index.wxml`
- Create: `apps/miniprogram/miniprogram/pages/player-auctions/index.wxss`
- Create: `apps/miniprogram/miniprogram/pages/player-auctions/index.json`
- Create: `apps/miniprogram/miniprogram/pages/auction-room/index.ts`
- Create: `apps/miniprogram/miniprogram/pages/auction-room/index.wxml`
- Create: `apps/miniprogram/miniprogram/pages/auction-room/index.wxss`
- Create: `apps/miniprogram/miniprogram/pages/auction-room/index.json`
- Create: `apps/miniprogram/miniprogram/pages/auction-room/auction-room.template.spec.ts`
- Modify: `apps/miniprogram/miniprogram/app.json`
- Modify: `apps/miniprogram/miniprogram/pages/login/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/detail.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/detail.viewmodel.spec.ts`

**Interfaces:**
- Consumes: Task 7 service and ViewModels.
- Produces: `/pages/player-auctions/index` and `/pages/auction-room/index?batchId=<id>`.
- Produces: `onShareAppMessage()` with batch title and exact room path.

- [ ] **Step 1: Add failing template and registration tests**

Assert both pages are registered, the room has amount input, minimum-price action, disabled states, reconnect notice, team identity, queue, valid bid history, `open-type="share"`, and no finance/roster mutation controls.

- [ ] **Step 2: Add failing navigation tests**

Assert eligible league detail shows “球员拍卖”, direct card entry preserves `batchId`, unauthenticated entry passes an encoded room path to login, successful login returns to that room instead of the default profile tab, and `onHide/onUnload` clears timers.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `pnpm --filter @efm/miniprogram test -- auction-room league-detail`

Expected: FAIL on missing pages, templates, and navigation.

- [ ] **Step 4: Implement the auction list and room page controllers**

Poll immediately on `onShow`, then every second; stop on hide/unload. On POST success replace the room snapshot immediately. Disable submission while disconnected, paused, completed, unauthorized, or already submitting.

- [ ] **Step 5: Implement templates and styles**

Follow the existing dark football design tokens, keep the player and countdown as the strongest hierarchy, use tabular numerals, ensure touch targets meet existing design tests, and keep the share button explicit rather than gated or incentivized.

- [ ] **Step 6: Register routes and league-detail entry**

Append the new pages to `app.json`. Add redirect-query handling only to `pages/login/index.ts`; do not overwrite the pre-existing unstaged `pages/login/index.wxml`, `pages/login/index.wxss`, or `pages/leagues` changes. Modify league-detail files for the authenticated entry.

- [ ] **Step 7: Run full miniprogram verification**

Run: `pnpm --filter @efm/miniprogram test && pnpm --filter @efm/miniprogram typecheck && pnpm --filter @efm/miniprogram build`

Expected: PASS.

- [ ] **Step 8: Commit native pages**

```bash
git add apps/miniprogram/miniprogram/app.json apps/miniprogram/miniprogram/pages/player-auctions apps/miniprogram/miniprogram/pages/auction-room apps/miniprogram/miniprogram/pages/league-detail apps/miniprogram/miniprogram/pages/login/index.ts
git commit -m "feat(miniprogram): add player auction room"
```

### Task 9: Prove multi-league concurrency and backwards compatibility end to end

**Files:**
- Modify: `apps/api/test/player-auctions.e2e-spec.ts`
- Modify: `apps/api/src/database/prisma.service.spec.ts`
- Modify: `README.md`
- Modify: `docs/deployment/windows-wechat-bridge.zh-CN.md`

**Interfaces:**
- Consumes: all earlier tasks.
- Produces: executable acceptance proof and operator instructions for group versus miniprogram modes.

- [ ] **Step 1: Extend E2E fixtures for two leagues and three users**

Create one miniprogram batch per league, two active-team bidders, one cross-league/archived-team case, and a separate existing group-mode batch. Keep timestamps and ids deterministic enough for exact assertions.

- [ ] **Step 2: Add failing end-to-end scenarios**

Cover simultaneous active batches in different leagues; rejection of a second batch in one league; accepted bid and 30-second reset; same-key retry; stale lot/epoch after auto-advance; archived team mid-room; Bridge outage separation; automatic sold/no-bid progression; manual review; and unchanged pure-number group bidding.

- [ ] **Step 3: Run the focused E2E suite**

Run: `pnpm --filter @efm/api test:e2e -- player-auctions.e2e-spec.ts`

Expected: PASS after Tasks 1–8; any failure is fixed in the owning task's implementation file before continuing.

- [ ] **Step 4: Document experience-version verification**

Add concise steps for uploading an experience build, adding experience members, configuring the HTTPS request domain, sharing a room card, testing two phones, and confirming that non-experience members cannot open the experience version. Explain that new auction data does not require code review.

- [ ] **Step 5: Run migration and repository-wide verification**

Run: `pnpm db:status && pnpm verify && git diff --check`

Expected: migrations applied/recognized; lint, typecheck, unit tests, E2E tests, and all builds PASS; no whitespace errors.

- [ ] **Step 6: Re-run the Windows Bridge suite**

Run from `apps/wechat-bridge`: `uv run pytest`

Expected: all platform-independent Bridge tests PASS and only documented Windows-only tests skip on macOS.

- [ ] **Step 7: Commit E2E and operations documentation**

```bash
git add apps/api/test/player-auctions.e2e-spec.ts apps/api/src/database/prisma.service.spec.ts README.md docs/deployment/windows-wechat-bridge.zh-CN.md
git commit -m "test: verify miniprogram auction workflow"
```

### Task 10: Final branch audit without absorbing unrelated work

**Files:**
- Verify only; no planned product file creation.

**Interfaces:**
- Consumes: Tasks 1–9.
- Produces: a clean, reviewable feature diff that leaves the user's unrelated unstaged files intact.

- [ ] **Step 1: Audit commits and changed paths**

Run: `git log --oneline 5836b51..HEAD && git diff --stat 5836b51..HEAD && git status --short`

Expected: feature commits cover the spec; the five pre-existing miniprogram league/login modifications and untracked `apps/api` agent configuration remain visibly separate unless the user later asks to include them.

- [ ] **Step 2: Verify no regression in group bot contracts**

Run: `pnpm --filter @efm/api test -- player-auction-command.handler.spec.ts wechat-command-router.service.spec.ts player-auction-message.formatter.spec.ts`

Expected: PASS with pure-number group bids and schedule-query routing intact.

- [ ] **Step 3: Verify the final implementation against the spec completion definition**

Check each item in spec section 15 against a passing automated test or the documented experience-version checklist. Record any true Windows/WeChat manual dependency explicitly; do not label it automatically verified on macOS.

- [ ] **Step 4: Produce the final handoff**

Report commit range, test counts, migration name, experience-version steps, preserved unrelated files, and the exact Windows/manual tests still required before production use.
