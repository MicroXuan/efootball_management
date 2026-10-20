# Native Auction Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an authenticated, image-led native auction experience with deterministic concurrent bidding and searchable immutable confirmed-sale records.

**Architecture:** Extend existing auction contracts and Prisma models, snapshot final winner identity during administrator review, and expose one authenticated confirmed-sales read model. Reuse the player-card detail and artwork components in redesigned Native mini-program auction pages, while enforcing player-catalog authentication at both API and client boundaries.

**Tech Stack:** NestJS, Prisma/MariaDB, Zod contracts, TypeScript, native WeChat Mini Program, Jest, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-native-auction-experience-design.md`

## Global Constraints

- Native WeChat mini-program only; do not introduce a web auction client.
- Every new auction lot requires a concrete active, published `playerCardId` belonging to its `playerId`.
- User-visible sales contain only reviewed `CONFIRM` and `ADJUST` results; exclude pending, no-bid, void, and cancelled lots.
- Confirmed sale identity and price are immutable snapshots and cannot drift after team/user edits.
- Public live history exposes only `VALID` bids and includes team number, team name, bidder display name, amount, and submitted time.
- Quick amounts equal `minimumValidPrice`, `minimumValidPrice + 10`, `+ 50`, and `+ 100`.
- Remove all `⭐` characters from mini-program auction money and feedback copy.
- Preserve unrelated working-tree changes in admin-web, seed data, and local agent/config files.

## Review Focus

- Two different users submit the same amount concurrently: exactly one bid is `VALID`, one is below the recomputed minimum, and one public row appears; Task 3 pins this.
- One client retries the same idempotency key after a timeout: it receives the original result without a second row or deadline reset; Task 3 pins this.
- A team or user is renamed after settlement: history still returns the snapshotted number/name/bidder identity; Task 2 pins this.
- A signed-out user opens a catalog tab or direct card URL: no protected data request runs before login and the return URL survives; Task 4 pins this.
- A long live bid list on a small device remains internally scrollable while the safe-area bid button stays reachable; Task 5 pins this.

---

### Task 1: Auction Contracts, Required Cards, and Settlement Storage

**Files:**
- Modify: `packages/contracts/src/player-auction.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261019210000_auction_sale_snapshots/migration.sql`
- Modify: `apps/api/src/player-auctions/admin-player-auctions.service.ts`
- Test: `apps/api/src/player-auctions/admin-player-auctions.service.spec.ts`

**Interfaces:**
- Produces: required `PlayerAuctionLotInput.playerCardId: string`; `AuctionPlayerCardSnapshot`; enriched `MyPlayerAuctionPublicBid`; `MyPlayerAuctionSaleListQuery` and `MyPlayerAuctionSaleListResponse` contract types.
- Produces: nullable legacy-safe review columns `winnerTeamNumberSnapshot`, `winnerTeamNameSnapshot`, and `winnerDisplayNameSnapshot`; new confirmations must populate all three.
- Consumes: active published `PlayerCard` and its existing `imageUrl`, `position`, `overallRating`, `cardType`, and card/player names.

- [ ] **Step 1: Write failing contract and admin-service tests**

Assert lot input rejects missing/null `playerCardId`; room card snapshot accepts `playerCardId`, `imageUrl`, position, overall, and card type; public bids require bidder identity; sale queries normalize `keyword`, `cursor`, and `limit`; sale results contain immutable winner/card fields. Assert lot replacement rejects inactive, unpublished, missing, and wrong-player cards and snapshots the valid card's artwork and presentation fields.

- [ ] **Step 2: Run focused tests and verify red**

Run: `pnpm --filter @efm/contracts test && pnpm --filter @efm/api test -- --runInBand src/player-auctions/admin-player-auctions.service.spec.ts`

Expected: FAIL on required-card and snapshot assertions.

- [ ] **Step 3: Add the schema migration and contract shapes**

Make `PlayerAuctionLotInputSchema.playerCardId` required. Add the three nullable snapshot columns to `PlayerAuctionReview` for legacy rows, generate Prisma client output, and define exact public room/sales schemas without changing unrelated auction status enums.

- [ ] **Step 4: Enforce and snapshot the selected card**

Update `replaceLots(...)` so every lot resolves one active published card belonging to the player and writes `playerCardId`, `imageUrl`, card name, position, overall rating, and card type into `playerSnapshot.card`.

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter @efm/contracts test && pnpm --filter @efm/api test -- --runInBand src/player-auctions/admin-player-auctions.service.spec.ts && pnpm --filter @efm/api typecheck`

Expected: PASS.

```bash
git add packages/contracts/src/player-auction.ts packages/contracts/src/contracts.spec.ts apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/player-auctions/admin-player-auctions.service.ts apps/api/src/player-auctions/admin-player-auctions.service.spec.ts
git commit -m "feat: require cards for auction lots"
```

### Task 2: Immutable Confirmed-Sale History API

**Files:**
- Modify: `apps/api/src/player-auctions/admin-player-auctions.service.ts`
- Modify: `apps/api/src/player-auctions/my-player-auctions.controller.ts`
- Modify: `apps/api/src/player-auctions/my-player-auctions.service.ts`
- Test: `apps/api/src/player-auctions/admin-player-auctions.service.spec.ts`
- Test: `apps/api/src/player-auctions/my-player-auctions.controller.spec.ts`
- Test: `apps/api/src/player-auctions/my-player-auctions.service.spec.ts`

**Interfaces:**
- Produces: `MyPlayerAuctionsService.listSales(userId: string, query: MyPlayerAuctionSaleListQuery): Promise<MyPlayerAuctionSaleListResponse>`.
- Produces: authenticated `GET /me/player-auction-sales?keyword=&cursor=&limit=`.
- Consumes: Task 1 sale contracts, card snapshots, and review snapshot columns.

- [ ] **Step 1: Write failing settlement and sales-query tests**

Assert `CONFIRM` and `ADJUST` snapshot team number, team name, and owner display name during review. Assert `listSales` returns only reviewed confirm/adjust rows for active-team leagues, newest `reviewedAt` first, searches player/team number/team/bidder case-insensitively, returns a stable cursor, and keeps old snapshot values after source records are renamed. Assert pending, `NO_BID`, `VOID`, other leagues, and unauthenticated controller requests are absent/rejected.

- [ ] **Step 2: Run focused API tests and verify red**

Run: `pnpm --filter @efm/api test -- --runInBand src/player-auctions/admin-player-auctions.service.spec.ts src/player-auctions/my-player-auctions.service.spec.ts src/player-auctions/my-player-auctions.controller.spec.ts`

Expected: FAIL because snapshots and sales endpoint are missing.

- [ ] **Step 3: Snapshot final winner identity during review**

Load the reviewed winner with `teamNumber`, `name`, and `owner.displayName` inside the review transaction and write the Task 1 snapshot columns for both `CONFIRM` and `ADJUST`; reject any non-void final result without a complete winner and price.

- [ ] **Step 4: Implement the confirmed-sales read model**

Query through the user's active league teams, restrict decisions to `CONFIRM|ADJUST`, map player/card and winner snapshots, implement opaque cursor pagination with deterministic `reviewedAt,id` ordering, and add trimmed keyword matching across the four approved fields.

- [ ] **Step 5: Add the guarded controller route and verify**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/player-auctions/admin-player-auctions.service.ts apps/api/src/player-auctions/admin-player-auctions.service.spec.ts apps/api/src/player-auctions/my-player-auctions.controller.ts apps/api/src/player-auctions/my-player-auctions.controller.spec.ts apps/api/src/player-auctions/my-player-auctions.service.ts apps/api/src/player-auctions/my-player-auctions.service.spec.ts
git commit -m "feat: expose confirmed auction sales"
```

### Task 3: Public Bid Identity and Equal-Bid Arbitration

**Files:**
- Modify: `apps/api/src/player-auctions/my-player-auctions.service.ts`
- Modify: `apps/api/src/player-auctions/player-auction-bid.service.ts`
- Test: `apps/api/src/player-auctions/my-player-auctions.service.spec.ts`
- Test: `apps/api/src/player-auctions/player-auction-bid.service.spec.ts`
- Test: `apps/api/test/player-auctions.e2e-spec.ts`

**Interfaces:**
- Produces: public valid-bid rows `{ id, teamNumber, teamName, bidderDisplayName, amount, submittedAt }`, newest first.
- Preserves: `placeMiniprogramBid(userId, batchId, input, idempotencyKey)` and row-lock ordering from `PlayerAuctionLockRepository`.

- [ ] **Step 1: Write failing identity, concurrency, and replay tests**

Run two distinct-user equal bids concurrently against one active lot and assert one `VALID`, one `BELOW_MINIMUM_INCREMENT`, one visible public bid, and the loser receives `requiredMinimum`. Replay one idempotency key and assert one stored row and one deadline epoch increment. Assert the room maps team number/name and bidder display name and returns valid bids newest first.

- [ ] **Step 2: Run focused tests and verify red**

Run: `pnpm --filter @efm/api test -- --runInBand src/player-auctions/player-auction-bid.service.spec.ts src/player-auctions/my-player-auctions.service.spec.ts && pnpm --filter @efm/api test:e2e -- --runInBand test/player-auctions.e2e-spec.ts`

Expected: at least the new public-identity/order assertions fail.

- [ ] **Step 3: Enrich the room query and preserve serialized arbitration**

Include `leagueTeam.teamNumber/name` and `user.displayName`, map only `VALID` bids, and order public rows descending. Keep league/batch/lot row locks before monetary recomputation; return the recomputed minimum to the losing equal bid without adding a public row.

- [ ] **Step 4: Verify and commit**

Run the Step 2 command.

Expected: PASS, including concurrency and idempotency assertions.

```bash
git add apps/api/src/player-auctions/my-player-auctions.service.ts apps/api/src/player-auctions/my-player-auctions.service.spec.ts apps/api/src/player-auctions/player-auction-bid.service.ts apps/api/src/player-auctions/player-auction-bid.service.spec.ts apps/api/test/player-auctions.e2e-spec.ts
git commit -m "fix: serialize and identify live auction bids"
```

### Task 4: Authenticated Player Catalog and Detail

**Files:**
- Create: `apps/api/src/player-catalog/catalog-read-auth.guard.ts`
- Create: `apps/api/src/player-catalog/catalog-read-auth.guard.spec.ts`
- Modify: `apps/api/src/player-catalog/player-catalog.controller.ts`
- Create: `apps/api/src/player-catalog/player-catalog.controller.spec.ts`
- Modify: `apps/api/src/player-catalog/player-catalog.module.ts`
- Modify: `apps/miniprogram/miniprogram/services/catalog.ts`
- Modify: `apps/miniprogram/miniprogram/pages/players/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/players/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/player-card-detail/index.ts`
- Test: `apps/miniprogram/miniprogram/pages/players/players.viewmodel.spec.ts`
- Test: `apps/miniprogram/miniprogram/pages/player-card-detail/runtime-dependency.spec.ts`

**Interfaces:**
- Produces: `CatalogReadAuthGuard`, accepting an active user JWT or an active administrator JWT (the latter preserves existing authenticated admin-web catalog reads) and rejecting anonymous requests.
- Produces: authenticated player/card/pack catalog endpoints without changing their paths or response shapes.
- Produces: login return routes `/pages/players/index` and `/pages/player-card-detail/index?id=<id>`; no catalog request begins without `session.getAccessToken()`.

- [ ] **Step 1: Write failing API and Native authentication tests**

Assert the catalog guard accepts active user and administrator tokens, rejects absent/invalid/disabled identities, and catalog endpoints reject missing tokens. Assert the player tab displays a login state and makes no player/pack request while signed out; login navigation preserves the catalog route. Assert direct card links preserve the encoded card route and do not load details before authentication.

- [ ] **Step 2: Run focused tests and verify red**

Run: `pnpm --filter @efm/api test -- --runInBand src/player-catalog/catalog-read-auth.guard.spec.ts src/player-catalog/player-catalog.controller.spec.ts && pnpm --filter @efm/miniprogram test -- miniprogram/pages/players miniprogram/pages/player-card-detail/runtime-dependency.spec.ts`

Expected: FAIL because catalog calls currently use `skipAuth: true` and the controller is public.

- [ ] **Step 3: Guard API routes and remove public client calls**

Register and apply `CatalogReadAuthGuard` to player, card, and pack reads, remove mini-program `skipAuth: true`, and retain paths and response shapes so authenticated admin-web catalog reads keep working.

- [ ] **Step 4: Add Native login gates and return navigation**

Before loading catalog or detail data, test the session token, render the login state, and navigate to login with the exact encoded return path. On `onShow`, resume loading once authenticated without duplicating in-flight requests.

- [ ] **Step 5: Verify and commit**

Run the Step 2 command.

Expected: PASS.

```bash
git add apps/api/src/player-catalog/catalog-read-auth.guard.ts apps/api/src/player-catalog/catalog-read-auth.guard.spec.ts apps/api/src/player-catalog/player-catalog.controller.ts apps/api/src/player-catalog/player-catalog.controller.spec.ts apps/api/src/player-catalog/player-catalog.module.ts apps/miniprogram/miniprogram/services/catalog.ts apps/miniprogram/miniprogram/pages/players apps/miniprogram/miniprogram/pages/player-card-detail/index.ts apps/miniprogram/miniprogram/pages/player-card-detail/runtime-dependency.spec.ts
git commit -m "feat: require login for player catalog"
```

### Task 5: Image-Led Auction Room and Safe Bid Dock

**Files:**
- Modify: `apps/miniprogram/miniprogram/pages/auction-room/auction-room.viewmodel.ts`
- Test: `apps/miniprogram/miniprogram/pages/auction-room/auction-room.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/auction-room/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/auction-room/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/auction-room/index.wxss`
- Test: `apps/miniprogram/miniprogram/pages/auction-room/auction-room.template.spec.ts`

**Interfaces:**
- Produces: `minimumPriceShortcuts(minimum)` returning exact labels/amounts `最低价`, `+10`, `+50`, `+100`.
- Produces: `playerCardDetailPath(cardId: string): string` and display-ready bid time/identity rows.
- Consumes: Task 1 room card snapshot and Task 3 public bid identity.

- [ ] **Step 1: Write failing view-model and template tests**

Assert minimum `120` yields `120/130/170/220`; feedback and WXML contain no `⭐`; tapping the player opens its card detail; the valid-bid panel precedes the bid form, uses a bounded vertical `scroll-view`, and shows number/team/bidder/time/amount; the bid dock uses `env(safe-area-inset-bottom)` and remains outside the history scroller. Assert equal-bid rejection copy says another user submitted first and shows the refreshed minimum.

- [ ] **Step 2: Run focused Native tests and verify red**

Run: `pnpm --filter @efm/miniprogram test -- miniprogram/pages/auction-room`

Expected: FAIL on the new layout, shortcuts, and copy.

- [ ] **Step 3: Implement presentation helpers and interaction state**

Map the room card snapshot to artwork/initials metadata, newest-first bid identity/time rows, four shortcuts, star-free feedback, and the existing detail route. Preserve draft amount and bid scroll state while lot id and deadline epoch remain unchanged.

- [ ] **Step 4: Rebuild the room layout**

Create the tappable player hero, countdown/prices, bounded activity scroller, and bottom safe-area bid dock. Use the existing `entity-artwork` component and plain tabular numbers with a small `资金` label. Keep queue content below the active interaction.

- [ ] **Step 5: Verify and commit**

Run: `pnpm --filter @efm/miniprogram test -- miniprogram/pages/auction-room && pnpm --filter @efm/miniprogram typecheck`

Expected: PASS.

```bash
git add apps/miniprogram/miniprogram/pages/auction-room
git commit -m "feat: redesign native auction room"
```

### Task 6: Searchable Native Confirmed-Sales Page and Final Verification

**Files:**
- Modify: `apps/miniprogram/miniprogram/services/player-auctions.ts`
- Modify: `apps/miniprogram/miniprogram/pages/player-auctions/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/player-auctions/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/player-auctions/index.wxss`
- Create: `apps/miniprogram/miniprogram/pages/auction-sales/index.json`
- Create: `apps/miniprogram/miniprogram/pages/auction-sales/index.ts`
- Create: `apps/miniprogram/miniprogram/pages/auction-sales/index.wxml`
- Create: `apps/miniprogram/miniprogram/pages/auction-sales/index.wxss`
- Create: `apps/miniprogram/miniprogram/pages/auction-sales/auction-sales.viewmodel.ts`
- Create: `apps/miniprogram/miniprogram/pages/auction-sales/auction-sales.viewmodel.spec.ts`
- Create: `apps/miniprogram/miniprogram/pages/auction-sales/auction-sales.template.spec.ts`
- Modify: `apps/miniprogram/miniprogram/app.json`

**Interfaces:**
- Produces: `listMyPlayerAuctionSales({ keyword, cursor, limit })` using Task 2's authenticated endpoint.
- Produces: `/pages/auction-sales/index` with debounced search, cursor pagination, artwork fallback, and card-detail navigation.

- [ ] **Step 1: Write failing service, view-model, and template tests**

Assert query encoding trims keyword and preserves cursor/limit; refresh replaces rows while append deduplicates by sale id; stale searches cannot overwrite newer results; rows render player/card, team number/name, bidder, price, and confirmed time; tapping artwork opens the exact card id; and the player-auctions page exposes `成交纪录`.

- [ ] **Step 2: Run focused Native tests and verify red**

Run: `pnpm --filter @efm/miniprogram test -- miniprogram/services/player-auctions.runtime-dependency.spec.ts miniprogram/pages/player-auctions miniprogram/pages/auction-sales`

Expected: FAIL because the service and page do not exist.

- [ ] **Step 3: Implement sales service and page state**

Add authenticated query serialization, 300 ms keyword debounce, latest-request token protection, pull-to-refresh, reach-bottom pagination, empty/error states, deduplication, and local confirmed-time formatting.

- [ ] **Step 4: Build the Native sales UI and register the page**

Add the auction-list entry, searchable sales cards using `entity-artwork`, plain money presentation, bidder/team metadata, and detail navigation. Register the new page in `app.json`.

- [ ] **Step 5: Run focused and workspace verification**

Run: `pnpm --filter @efm/contracts test && pnpm --filter @efm/api test -- --runInBand src/player-auctions src/player-catalog && pnpm --filter @efm/miniprogram test && pnpm --filter @efm/contracts typecheck && pnpm --filter @efm/api typecheck && pnpm --filter @efm/miniprogram typecheck && pnpm --filter @efm/api build && pnpm --filter @efm/miniprogram build`

Expected: PASS with no auction stars, no unauthenticated catalog access, deterministic equal-bid results, and confirmed-sale search coverage.

- [ ] **Step 6: Commit**

```bash
git add apps/miniprogram/miniprogram/services/player-auctions.ts apps/miniprogram/miniprogram/pages/player-auctions apps/miniprogram/miniprogram/pages/auction-sales apps/miniprogram/miniprogram/app.json
git commit -m "feat: add native auction sale history"
```
