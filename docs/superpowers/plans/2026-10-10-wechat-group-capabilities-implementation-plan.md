# WeChat Group Capabilities and Auction Auto-Advance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one league bind multiple WeChat groups with independently selected schedule-query and player-auction capabilities, while automatically advancing every completed or unsold auction lot to the next lot.

**Architecture:** Add a normalized capability relation to each existing `WechatGroupBinding`, expose it through the shared contracts and admin configuration, and enforce it at both command-routing and auction-creation boundaries. Keep the Windows Bridge transport unchanged; the API remains authoritative for routing, auction deadlines, automatic lot transitions, durable outbox ordering, and manual result review.

**Tech Stack:** TypeScript 5.9, NestJS 12, Prisma 7/MySQL, Zod, React 19/Ant Design, Jest/Supertest/Vitest, Python 3.12 Windows Bridge (regression only).

**Spec:** `docs/superpowers/specs/2026-10-10-wechat-group-capabilities-design.md`

## Global Constraints

- One WeChat group binds to exactly one league; one league may bind multiple groups.
- The only group capabilities are `SCHEDULE_QUERY` and `PLAYER_AUCTION`; a group may have zero, one, or both.
- Disabled groups handle no group commands, while saved capabilities and schedule sources remain intact.
- Schedule commands and auction commands remain silent in groups lacking their corresponding capability; they create no outbox message.
- Auction batches may only target enabled groups with `PLAYER_AUCTION`; separate groups in one league may run auctions concurrently.
- Users bid with a pure number such as `120`; a valid reply is exactly `【球队名称】出价有效：⭐120⭐，倒计时重置为 30 秒。`
- Countdown messages are exactly `20、10、3、2、1`; never enqueue `30`, `5`, `4`, or `0`.
- A valid bid resets the authoritative deadline to 30 seconds and invalidates the prior deadline epoch.
- Closing either a bid lot or a no-bid lot automatically starts the next queued lot; manual result review never blocks this transition.
- The final lot automatically completes the batch; no routine `下一位` command remains.
- Reviews only record final outcomes and never mutate finance, roster transactions, or player ownership.
- Preserve all existing group IDs, schedule sources, identities, messages, outbox rows, auction batches, lots, bids, and reviews.
- Real Windows acceptance uses the installed and already validated WeChat version `4.1.15.50`, with `expected_wechat_version` set explicitly to the same value.
- Do not modify or stage the existing uncommitted `apps/wechat-bridge` fixes in feature commits; they are separately verified prior work.

## Review Focus

- Removing `PLAYER_AUCTION` or disabling a group while a batch becomes active concurrently must fail closed with `WECHAT_GROUP_HAS_ACTIVE_AUCTION`; covered by Task 2 transaction-lock tests.
- Switching between two observed groups in the admin page must not leak the first group's capabilities, sources, enabled state, or optimistic version into the second; covered by Task 3 UI tests.
- A schedule command in an auction-only group and a numeric bid in a query-only group must be marked ignored without calling a handler or creating outbox; covered by Task 5 router tests.
- Two worker ticks closing the same epoch must start the next lot once and enqueue one ordered result/opening pair; covered by Task 6 idempotency tests.
- Migration backfill must choose the same creator in every environment when several schedule sources or batches exist; covered by Task 1 deterministic ordering checks and migration verification.

---

### Task 1: Capability contracts, Prisma model, and deterministic backfill

**Files:**
- Modify: `packages/contracts/src/wechat-bot.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261010120000_wechat_group_capabilities/migration.sql`
- Create: `apps/api/src/database/wechat-group-capability-migration.spec.ts`

**Interfaces:**
- Consumes: existing `WechatGroupBinding`, `WechatGroupScheduleSource`, `PlayerAuctionBatch`, and `AdminAccount` records.
- Produces: `WechatGroupCapabilityTypeSchema`, `WechatGroupCapabilityType`, `AdminWechatGroupBinding.capabilities`, and `SaveWechatGroupBindingRequest.capabilities` using `('SCHEDULE_QUERY' | 'PLAYER_AUCTION')[]`; Prisma produces `WechatGroupCapability` and the `capabilities` relation.

- [ ] **Step 1: Write failing contract tests**

Add tests named `accepts explicit WeChat group capabilities` and `rejects duplicate or unknown WeChat group capabilities`. Assert that response and save-request schemas accept `[]`, `['SCHEDULE_QUERY']`, `['PLAYER_AUCTION']`, and both values; duplicate and unknown values must throw.

- [ ] **Step 2: Run the contract test and verify failure**

Run: `pnpm --filter @efm/contracts test -- contracts.spec.ts`

Expected: FAIL because the WeChat group schemas do not expose `capabilities`.

- [ ] **Step 3: Add the shared capability contract**

Define `WechatGroupCapabilityTypeSchema = z.enum(['SCHEDULE_QUERY', 'PLAYER_AUCTION'])`, add `capabilities` to `AdminWechatGroupBindingSchema` and `SaveWechatGroupBindingRequestSchema`, and use `superRefine` to reject duplicates just as schedule-source duplicates are rejected. Export the inferred type.

- [ ] **Step 4: Add the Prisma enum, model, relations, and indexes**

Add `WechatGroupCapabilityType`, `WechatGroupCapability`, `WechatGroupBinding.capabilities`, and `AdminAccount.createdWechatGroupCapabilities`. Use required `groupBindingId` and `createdByAdminId` foreign keys with `onDelete: Restrict`, a unique `(groupBindingId, capability)` index, and a capability lookup index.

- [ ] **Step 5: Write the additive migration and deterministic backfill test**

Create a focused migration test that reads the SQL and asserts both backfills order candidates by `created_at ASC, id ASC`, use one row per binding/capability, and use duplicate-safe insertion. This pins the creator-selection rule even when the normal test database has already applied the migration.

- [ ] **Step 6: Run the migration test and verify failure**

Run: `pnpm --filter @efm/api test -- wechat-group-capability-migration.spec.ts --runInBand`

Expected: FAIL because the capability migration SQL does not exist.

- [ ] **Step 7: Write the additive migration and deterministic backfill**

Create `wechat_group_capabilities` without changing existing tables beyond foreign keys and indexes. Insert one `SCHEDULE_QUERY` row per binding that has schedule sources, choosing the source creator ordered by `created_at ASC, id ASC`; insert one `PLAYER_AUCTION` row per binding referenced by a batch, choosing the batch creator by the same ordering. Use unique-key-safe inserts so a binding satisfying both rules receives exactly two rows and rerunning the insert statements in a disposable database creates no duplicates.

- [ ] **Step 8: Generate and verify schema and migration**

Run: `pnpm db:generate && pnpm --filter @efm/contracts test -- contracts.spec.ts && pnpm --filter @efm/api test -- wechat-group-capability-migration.spec.ts --runInBand && pnpm --filter @efm/api typecheck && pnpm db:migrate && pnpm db:status`

Expected: contracts and typecheck PASS; migration applies; Prisma reports the database schema is current. Query representative backfilled rows and verify the selected creator matches the earliest `(created_at, id)` source record.

- [ ] **Step 9: Commit**

```bash
git add packages/contracts/src/wechat-bot.ts packages/contracts/src/contracts.spec.ts apps/api/prisma/schema.prisma apps/api/prisma/migrations/20261010120000_wechat_group_capabilities apps/api/src/database/wechat-group-capability-migration.spec.ts
git commit -m "feat(wechat): add group capability model"
```

### Task 2: Persist group capabilities and protect active auctions

**Files:**
- Modify: `apps/api/src/wechat-bot/admin-wechat-bot.service.ts`
- Modify: `apps/api/src/wechat-bot/admin-wechat-bot.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 `SaveWechatGroupBindingRequest.capabilities` and Prisma `WechatGroupCapability`.
- Produces: `AdminWechatBotService.saveGroupBinding(adminId, leagueId, input)` returning every saved capability; conflict code `WECHAT_GROUP_HAS_ACTIVE_AUCTION` when disabling a protected group or removing its auction capability.

- [ ] **Step 1: Extend the service harness and write failing persistence tests**

Add `wechatGroupCapability` mocks and capability includes. Assert `getLeagueConfig()` returns each binding's capabilities, and saving atomically replaces only the selected binding's capability rows with `createdByAdminId: adminId` while retaining schedule sources when `SCHEDULE_QUERY` is absent or `enabled` is false.

- [ ] **Step 2: Write failing active-auction protection tests**

For an existing auction-capable group, assert disabling it or removing `PLAYER_AUCTION` is rejected when a batch is `READY`, `ACTIVE`, `PAUSED`, or `RECOVERY_REQUIRED`. Assert the same edits succeed for only `DRAFT`, `COMPLETED`, or `CANCELLED` batches and that schedule capability may be removed independently.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `pnpm --filter @efm/api test -- admin-wechat-bot.service.spec.ts --runInBand`

Expected: FAIL because capabilities are neither loaded nor persisted and no active-auction guard exists.

- [ ] **Step 4: Implement transactional replacement and protection**

Expand `GroupBindingViewInput` and `bindingView()` with `capabilities`. Inside the save transaction, lock and reload an existing binding plus its current capabilities before changing it; if the change disables the group or removes `PLAYER_AUCTION`, query protected batch statuses and throw `ConflictException` with code `WECHAT_GROUP_HAS_ACTIVE_AUCTION`. Replace capability rows with the request values, continue replacing schedule-source rows from `scheduleSourceIds`, and include both arrays in the audit metadata.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `pnpm --filter @efm/api test -- admin-wechat-bot.service.spec.ts --runInBand && pnpm --filter @efm/api typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/wechat-bot/admin-wechat-bot.service.ts apps/api/src/wechat-bot/admin-wechat-bot.service.spec.ts
git commit -m "feat(wechat): persist group capabilities safely"
```

### Task 3: Configure multiple groups and independent capabilities in admin web

**Files:**
- Modify: `apps/admin-web/src/leagues/wechat-bot-page.tsx`
- Modify: `apps/admin-web/src/leagues/wechat-bot-page.spec.tsx`

**Interfaces:**
- Consumes: Task 1 `AdminLeagueWechatBotConfig.bindings[].capabilities` and Task 2 save behavior.
- Produces: an editor keyed by selected observed group, with `enabled`, `capabilities`, `scheduleSourceIds`, and the matching binding's `expectedVersion` isolated per group selection.

- [ ] **Step 1: Write failing multi-group UI tests**

Render two observed groups where one saved binding is query-only and one is auction-only. Switch between them and assert each group's switches, source selections, enabled state, and save request are independent. Save the second group and assert the first binding remains in the local `bindings` array rather than being replaced.

- [ ] **Step 2: Write failing capability and conflict-copy tests**

Assert the page exposes “赛程查询” and “球员拍卖” checkboxes, hides the schedule-source section when query capability is off without clearing its selected IDs, permits both capabilities, and translates `WECHAT_GROUP_HAS_ACTIVE_AUCTION` into a message instructing the administrator to finish or cancel the batch first.

- [ ] **Step 3: Run the page test and verify failure**

Run: `pnpm --filter @efm/admin-web test -- wechat-bot-page.spec.tsx`

Expected: FAIL because the page always hydrates and replaces `bindings[0]` and has no capability controls.

- [ ] **Step 4: Implement selected-group binding hydration**

Resolve a selected group's binding by `(deviceId, wechatGroupId)`. On every selection, hydrate from that binding or default a new group to `enabled: true`, empty capabilities, and empty sources. Submit the matching binding version only, then upsert the returned binding into `config.bindings` by ID.

- [ ] **Step 5: Implement capability controls and conditional schedule sources**

Rename the introduction to plural group binding, show independent capability checkboxes, conditionally render sources only when `SCHEDULE_QUERY` is selected, retain hidden source state, and keep the existing total enable switch. Keep device/login status and stable group selection behavior unchanged.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `pnpm --filter @efm/admin-web test -- wechat-bot-page.spec.tsx && pnpm --filter @efm/admin-web typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-web/src/leagues/wechat-bot-page.tsx apps/admin-web/src/leagues/wechat-bot-page.spec.tsx
git commit -m "feat(admin): configure multiple WeChat group roles"
```

### Task 4: Restrict auction batches to auction-capable groups

**Files:**
- Modify: `apps/api/src/player-auctions/admin-player-auctions.service.ts`
- Modify: `apps/api/src/player-auctions/admin-player-auctions.service.spec.ts`
- Modify: `apps/admin-web/src/auctions/auction-editor-page.tsx`
- Modify: `apps/admin-web/src/auctions/auction-editor-page.spec.tsx`

**Interfaces:**
- Consumes: Task 1 capability relation and Task 3 capability-bearing config response.
- Produces: auction create/prepare validation requiring `enabled = true` plus `PLAYER_AUCTION`; the auction editor lists only eligible groups.

- [ ] **Step 1: Write failing API eligibility tests**

Assert `create()` rejects an enabled query-only group with `AUCTION_GROUP_INVALID`; assert `prepare()` revalidates the saved group so a stale draft cannot start after auction capability removal. Keep the existing same-group unresolved-batch conflict, and assert an active batch in group A does not prevent preparing another batch in auction-capable group B.

- [ ] **Step 2: Write failing editor filtering tests**

Return query-only, auction-only, combined, and disabled auction bindings. Assert only enabled auction-only and combined groups appear in “绑定微信群”, and an existing draft retains its saved eligible group.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `pnpm --filter @efm/api test -- admin-player-auctions.service.spec.ts --runInBand && pnpm --filter @efm/admin-web test -- auction-editor-page.spec.tsx`

Expected: FAIL because eligibility currently checks only `enabled`.

- [ ] **Step 4: Enforce capability in create and prepare**

Use a Prisma relation filter requiring `capabilities: { some: { capability: 'PLAYER_AUCTION' } }` in both mutations. Preserve the existing group-version check during create and the parent-group lock plus same-group conflict check during prepare.

- [ ] **Step 5: Filter the auction editor**

Filter loaded bindings by `binding.enabled && binding.capabilities.includes('PLAYER_AUCTION')`. If none exist, render actionable empty-state copy linking the administrator back to the WeChat group configuration instead of allowing an invalid save.

- [ ] **Step 6: Run focused tests and typechecks**

Run: `pnpm --filter @efm/api test -- admin-player-auctions.service.spec.ts --runInBand && pnpm --filter @efm/admin-web test -- auction-editor-page.spec.tsx && pnpm --filter @efm/api typecheck && pnpm --filter @efm/admin-web typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/player-auctions/admin-player-auctions.service.ts apps/api/src/player-auctions/admin-player-auctions.service.spec.ts apps/admin-web/src/auctions/auction-editor-page.tsx apps/admin-web/src/auctions/auction-editor-page.spec.tsx
git commit -m "feat(auction): require auction-capable groups"
```

### Task 5: Gate commands by group capability and generate scoped help

**Files:**
- Modify: `apps/api/src/wechat-bot/wechat-command-router.service.ts`
- Modify: `apps/api/src/wechat-bot/wechat-command-router.service.spec.ts`
- Modify: `apps/api/src/wechat-bot/wechat-message-formatter.ts`
- Modify: `apps/api/src/wechat-bot/wechat-bridge.service.ts`

**Interfaces:**
- Consumes: Task 1 group capability relation and existing `PlayerAuctionCommandHook`.
- Produces: `formatWechatHelp(capabilities: readonly WechatGroupCapabilityType[]): string`; internal result codes `SCHEDULE_CAPABILITY_DISABLED` and `AUCTION_CAPABILITY_DISABLED` for silent rejection.

- [ ] **Step 1: Write failing routing-matrix tests**

Cover query-only, auction-only, combined, empty-capability, disabled, and unbound groups. Assert schedule handlers run only with `SCHEDULE_QUERY`; auction hook runs only with `PLAYER_AUCTION`; unsupported commands become `IGNORED` with the capability-specific result code and enqueue nothing. Confirm private `绑定 123456` behavior is unchanged.

- [ ] **Step 2: Write failing dynamic-help tests**

Assert query-only help lists `查询赛程` and `我的赛程` but no bids; auction-only help lists auction management commands and pure-number bidding but no schedule commands; combined help lists both; empty-capability help states that no group functions are enabled.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `pnpm --filter @efm/api test -- wechat-command-router.service.spec.ts --runInBand`

Expected: FAIL because the router invokes the auction hook before loading group capabilities and help is static.

- [ ] **Step 4: Implement capability-aware routing**

Load the enabled binding's capability values after validating `groupBindingId`. Classify numeric and auction-manager commands before invoking the optional auction hook, classify schedule commands before querying schedules, and return silent ignored results when the required capability is absent. Do not add any capability rule to private identity binding.

- [ ] **Step 5: Replace static help and retire the routine next command**

Replace `WECHAT_HELP_TEXT` with `formatWechatHelp()`. Remove `下一位` from the bridge `GROUP_COMMAND` regular expression and from advertised/accepted auction manager commands; retain `开始拍卖`, `暂停拍卖`, `继续拍卖`, and `取消拍卖`.

- [ ] **Step 6: Run focused tests and typecheck**

Run: `pnpm --filter @efm/api test -- wechat-command-router.service.spec.ts --runInBand && pnpm --filter @efm/api typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/wechat-bot/wechat-command-router.service.ts apps/api/src/wechat-bot/wechat-command-router.service.spec.ts apps/api/src/wechat-bot/wechat-message-formatter.ts apps/api/src/wechat-bot/wechat-bridge.service.ts
git commit -m "feat(wechat): isolate commands by group capability"
```

### Task 6: Auto-advance lots and emit only the confirmed countdown marks

**Files:**
- Modify: `apps/api/src/player-auctions/player-auction-worker.ts`
- Modify: `apps/api/src/player-auctions/player-auction-worker.spec.ts`
- Modify: `apps/api/src/player-auctions/player-auction-state.service.ts`
- Modify: `apps/api/src/player-auctions/player-auction-state.service.spec.ts`
- Modify: `apps/api/src/player-auctions/player-auction-command.handler.ts`
- Modify: `apps/api/src/player-auctions/player-auction-command.handler.spec.ts`
- Modify: `apps/api/src/player-auctions/player-auction-message.formatter.ts`
- Modify: `apps/api/src/player-auctions/player-auction-message.formatter.spec.ts`

**Interfaces:**
- Consumes: the existing transaction locks, 30-second deadline epoch, lot snapshots, and batch group target.
- Produces: `PlayerAuctionWorker.closeDueLot(lotId, epoch)` that atomically closes the current lot and either activates the next queued lot or completes the batch; countdown formatter accepts only `20 | 10 | 3 | 2 | 1`.

- [ ] **Step 1: Replace manual-next tests with failing automatic-transition tests**

For both a highest-bid lot and a no-bid lot, assert closing lot 1 changes it to `PENDING_REVIEW` or `NO_BID`, starts lot 2 with a new 30-second deadline and incremented epoch, and points `batch.currentLotId` to lot 2. Assert the final lot sets `COMPLETED` and clears `currentLotId`.

- [ ] **Step 2: Add failing idempotency and message-order tests**

Call `closeDueLot()` twice for the same epoch and assert only the first returns true, only one next lot is activated, and exactly one result/opening pair exists. Assert the result outbox priority is higher than the next opening priority so claim order is “本轮结果 → 下一位开拍”; for the final lot assert result precedes the completed message.

- [ ] **Step 3: Add failing countdown tests**

Drive ticks across 20, 10, 5, 4, 3, 2, and 1 seconds. Assert outbox contains exactly `20`, `10`, `3`, `2`, `1`, with no `30`, `5`, `4`, or `0`; assert stale epochs remain rejected by the existing outbox claim guard.

- [ ] **Step 4: Run focused tests and verify failure**

Run: `pnpm --filter @efm/api test -- player-auction-worker.spec.ts player-auction-state.service.spec.ts player-auction-command.handler.spec.ts player-auction-message.formatter.spec.ts wechat-outbox.service.spec.ts --runInBand`

Expected: FAIL because worker marks are `20,10,5,4,3,2,1`, closing leaves the next lot queued, and state/command code still exposes `next()`.

- [ ] **Step 5: Implement the locked automatic transition**

Within `closeDueLot()`, lock current lot and batch, close the current lot, select and lock the next `QUEUED` lot by `(displayOrder ASC, id ASC)`, and use database time for its `deadlineAt = now + 30_000`. Update the next lot and batch in the same transaction. Create the result and opening outbox rows against the batch's stable group ID with distinct business keys and deterministic priorities; complete the batch only when no queued lot remains.

- [ ] **Step 6: Remove manual-next state and command paths**

Delete `PlayerAuctionStateService.next()`, remove `下一位` from `MANAGER_COMMANDS` and the handler transition chain, and update tests and copy to state that progression is automatic. Keep explicit pause, resume, recovery, and cancel behavior.

- [ ] **Step 7: Restrict countdown marks**

Set worker marks and formatter types to `20, 10, 3, 2, 1`. Preserve the rule that congestion may skip a display mark but never extends or changes the deadline.

- [ ] **Step 8: Run focused tests and typecheck**

Run: `pnpm --filter @efm/api test -- player-auction-worker.spec.ts player-auction-state.service.spec.ts player-auction-command.handler.spec.ts player-auction-message.formatter.spec.ts wechat-outbox.service.spec.ts --runInBand && pnpm --filter @efm/api typecheck`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/player-auctions apps/api/src/wechat-bot/wechat-outbox.service.spec.ts
git commit -m "feat(auction): auto-advance completed lots"
```

### Task 7: Review no-bid results and update the admin review flow

**Files:**
- Modify: `apps/api/src/player-auctions/admin-player-auctions.service.ts`
- Modify: `apps/api/src/player-auctions/admin-player-auctions.service.spec.ts`
- Modify: `apps/admin-web/src/auctions/auction-detail-page.tsx`
- Modify: `apps/admin-web/src/auctions/auction-detail-page.spec.tsx`

**Interfaces:**
- Consumes: existing `ReviewPlayerAuctionLotRequest` decisions and Task 6 `NO_BID` terminal result.
- Produces: review support for `NO_BID` with `CONFIRM` or `VOID`; `ADJUST` remains valid only for `PENDING_REVIEW` with a computed bid result.

- [ ] **Step 1: Write failing service tests for no-bid review**

Assert a `NO_BID` lot can be confirmed into `REVIEWED` with null computed/reviewed winner and price, or voided with a required reason. Assert `ADJUST` on `NO_BID` returns `AUCTION_REVIEW_NOT_ALLOWED`, and reviewing it never changes the batch's automatically active next lot.

- [ ] **Step 2: Write failing detail-page tests**

Render one `PENDING_REVIEW`, one `NO_BID`, and one active next lot. Assert pending count includes both reviewable results; no-bid offers “确认流拍” and “作废” but not “调整结果”; the information alert says the batch automatically advances and no longer instructs the administrator to send `下一位`.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `pnpm --filter @efm/api test -- admin-player-auctions.service.spec.ts --runInBand && pnpm --filter @efm/admin-web test -- auction-detail-page.spec.tsx`

Expected: FAIL because service and UI only review `PENDING_REVIEW` and the page still advertises manual next.

- [ ] **Step 4: Implement no-bid review rules**

Allow `CONFIRM` and `VOID` for `NO_BID`; create the immutable review record with null computed values and update the lot to `REVIEWED` or `VOID`. Keep optimistic version checks and the existing non-financial boundary. Reject `ADJUST` unless the lot is `PENDING_REVIEW`.

- [ ] **Step 5: Update review UI and copy**

Include `NO_BID` in reviewable counts and forms, render the reduced decision set for no-bid lots, and replace all manual-next copy with automatic-progress copy. Do not alter the currently active lot when submitting a prior lot's review.

- [ ] **Step 6: Run focused tests and typechecks**

Run: `pnpm --filter @efm/api test -- admin-player-auctions.service.spec.ts --runInBand && pnpm --filter @efm/admin-web test -- auction-detail-page.spec.tsx && pnpm --filter @efm/api typecheck && pnpm --filter @efm/admin-web typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/player-auctions/admin-player-auctions.service.ts apps/api/src/player-auctions/admin-player-auctions.service.spec.ts apps/admin-web/src/auctions/auction-detail-page.tsx apps/admin-web/src/auctions/auction-detail-page.spec.tsx
git commit -m "feat(auction): review automatic lot outcomes"
```

### Task 8: End-to-end isolation, migration, and Windows acceptance gates

**Files:**
- Modify: `apps/api/test/wechat-bot.e2e-spec.ts`
- Modify: `apps/api/test/player-auctions.e2e-spec.ts`
- Modify: `docs/development/player-auction-bot-verification.zh-CN.md`
- Modify: `docs/development/wechat-bot-foundation-verification.zh-CN.md`
- Modify: `docs/deployment/windows-wechat-bridge.zh-CN.md`

**Interfaces:**
- Consumes: all prior task contracts, routes, state transitions, UI-visible behavior, and existing Bridge deployment process.
- Produces: automated proof for capability isolation and auto-advance, plus a real-Windows checklist that the user can run after repository verification passes.

- [ ] **Step 1: Extend WeChat bot E2E setup with three groups**

Create query-only, auction-only, and combined bindings for one league. Assert `查询赛程` responds only in query-enabled groups, numeric input reaches auction only in auction-enabled groups, help is scoped, and each disabled-capability command leaves the outbox count unchanged.

- [ ] **Step 2: Rewrite auction E2E for automatic progression**

Configure the binding with `PLAYER_AUCTION`, remove every `下一位` message, and run at least three lots: one with valid bids, one with no bids, and a final lot. After each forced expiry assert the next lot is already `ACTIVE`; after the last assert the batch is `COMPLETED`. Confirm result/opening outbox order, exact countdown set, valid-bid star format, no-bid review, duplicate protection, recovery, and unchanged finance/roster/ownership counts.

- [ ] **Step 3: Run E2E tests against the migrated database**

Run: `pnpm db:migrate && pnpm --filter @efm/api test:e2e -- wechat-bot.e2e-spec.ts player-auctions.e2e-spec.ts --runInBand && pnpm db:status`

Expected: both E2E files PASS and Prisma reports all migrations applied.

- [ ] **Step 4: Update verification and deployment documentation**

Update both development verification guides and the Windows deployment guide. Document multi-group capability selection, auction-group filtering, active-batch protection, `20、10、3、2、1`, automatic advance for bid and no-bid lots, background manual review, and the removal of routine `下一位`. Replace the obsolete `4.1.15.13` deployment requirement with the actually validated `4.1.15.50` plus an explicit matching `expected_wechat_version`; keep the existing dedicated account, whitelist, dry-send, circuit breaker, and no-zero-risk wording.

- [ ] **Step 5: Run complete repository verification**

Run: `pnpm verify && pnpm db:status && git diff --check`

Expected: lint, typecheck, unit tests, E2E tests, builds, migration status, and whitespace checks all PASS. Separately run `cd apps/wechat-bridge && uv run pytest`; expected existing Bridge suite PASS without feature-specific Bridge changes.

- [ ] **Step 6: Perform the real Windows acceptance after code delivery**

On the user's Windows computer, bind one query group and one auction group to the same league. Verify schedule isolation, numeric silence in the query group, a multi-lot auction containing one valid-bid lot and one no-bid lot, automatic transitions, exact countdown nodes, server `SENT` readback, no duplicate outbox, and a closed device circuit. Record real Windows acceptance separately from repository automation.

- [ ] **Step 7: Commit**

```bash
git add apps/api/test/wechat-bot.e2e-spec.ts apps/api/test/player-auctions.e2e-spec.ts docs/development/player-auction-bot-verification.zh-CN.md docs/development/wechat-bot-foundation-verification.zh-CN.md docs/deployment/windows-wechat-bridge.zh-CN.md
git commit -m "test: verify multi-group auction automation"
```
