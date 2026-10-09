# WeChat Group Bot Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the server, admin, and mini-program foundation that securely connects one ordinary WeChat group to one league, binds WeChat identities to existing users, and answers schedule commands through a simulated Bridge contract.

**Architecture:** Add a focused `wechat-bot` NestJS module backed by MySQL inbox/outbox tables. A Windows Bridge authenticates through signed HTTPS requests, reports observed groups, uploads text events, claims outbound messages, and acknowledges verified sends; command routing, identity binding, schedule queries, and all authoritative state stay in the API.

**Tech Stack:** TypeScript 5.9, NestJS 12, Prisma 7/MySQL, Zod contracts, React 19/Ant Design, native WeChat Mini Program, Jest/Supertest/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-wechat-group-bot-auction-design.zh-CN.md`

## Global Constraints

- One stable WeChat group ID binds to exactly one `League`; one group may select multiple existing `Competition` schedule sources.
- Public `查询赛程` needs no user binding; `我的赛程` requires an active identity binding and an owned team in the group league.
- Binding codes are six decimal digits, expire after exactly 5 minutes, are single-use, and are stored only as hashes.
- Only text commands from enabled groups and private `绑定 NNNNNN` commands are persisted; unrelated chat content must not reach the API.
- Bridge requests use TLS plus `Authorization: Bridge <token>`, `X-Bridge-Device`, timestamp, nonce, and HMAC-SHA256 request signature; timestamps older than 5 minutes and repeated nonces are rejected.
- The API persists every accepted inbound message before acknowledging it and advances no Bridge watermark itself.
- Outbox business keys are unique; sending success requires a Bridge read-back message ID.
- Do not introduce Redis or a second TypeScript service in this plan.

## Review Focus

- A validly signed request with a reused nonce must return `409 BRIDGE_REQUEST_REPLAYED`; pinned in Task 2 bridge-auth tests.
- Repeated invalid six-digit guesses from one sender must be rate-limited before they can brute-force a binding code; pinned in Task 3 binding tests.
- An enabled group with no schedule sources must answer explicitly instead of returning another league's competitions; pinned in Task 3 query tests.
- A bound user who owns a team in another league must not receive `我的赛程` data in this group; pinned in Task 3 query tests.
- A Bridge retry after an ambiguous HTTP failure must neither duplicate an inbound command nor enqueue a second reply; pinned in Task 7 end-to-end tests.

---

### Task 1: Foundation schema and shared contracts

**Files:**
- Create: `packages/contracts/src/wechat-bot.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261009120000_wechat_bot_foundation/migration.sql`

**Interfaces:**
- Consumes: existing `User`, `League`, `Competition`, and admin audit identities.
- Produces: `WechatBridgeHeartbeatSchema`, `WechatInboundBatchSchema`, `WechatOutboxClaimResponseSchema`, `WechatOutboxAckSchema`, `WechatBindingStatusSchema`, `WechatBindingCodeResponseSchema`, and admin device/group response schemas exported from `@efm/contracts`.

- [ ] **Step 1: Write failing contract tests**

Add tests named `validates bridge heartbeat and bounded observed groups`, `rejects non-text inbound payloads`, `validates outbox acknowledgements`, and `parses binding/admin responses`. Assert a batch maximum of 100, observed-group maximum of 500, text maximum of 2,000 characters, six-digit binding codes, and `SENT | FAILED` acknowledgement status.

- [ ] **Step 2: Run the contract tests and verify failure**

Run: `pnpm --filter @efm/contracts test`

Expected: FAIL because `./wechat-bot.js` and its schemas do not exist.

- [ ] **Step 3: Add the contract module**

Define the schemas and inferred response/request types in `packages/contracts/src/wechat-bot.ts`; export them from `index.ts`. Use ISO datetime strings, opaque IDs, and explicit enums rather than open strings.

- [ ] **Step 4: Add the Prisma foundation models**

Add focused enums and models for `WechatBotDevice`, `WechatObservedGroup`, `WechatGroupBinding`, `WechatGroupScheduleSource`, `WechatIdentityBinding`, `WechatBindingCode`, `WechatBridgeRequestReceipt`, `WechatInboundMessage`, and `WechatOutboxMessage`. Use unique constraints for device/group, `(deviceId, wechatContactId)`, `(deviceId, userId)`, device/nonce, device/message ID, and outbox business key. Rebinding updates the existing disabled identity row instead of relying on a MySQL partial unique index. Add relations to `User`, `League`, and `Competition` without changing existing deletion semantics.

- [ ] **Step 5: Write the SQL migration and generate the client**

Run: `pnpm db:generate`

Expected: Prisma client generation succeeds with the new models.

- [ ] **Step 6: Run contract, schema, and type checks**

Run: `pnpm --filter @efm/contracts test && pnpm --filter @efm/contracts typecheck && pnpm --filter @efm/api typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src apps/api/prisma
git commit -m "feat(bot): add WeChat bridge foundation schema"
```

### Task 2: Bridge authentication, inbox, heartbeat, and outbox

**Files:**
- Create: `apps/api/src/wechat-bot/wechat-bot.module.ts`
- Create: `apps/api/src/wechat-bot/wechat-bridge-auth.guard.ts`
- Create: `apps/api/src/wechat-bot/wechat-bridge-auth.guard.spec.ts`
- Create: `apps/api/src/wechat-bot/wechat-bridge.controller.ts`
- Create: `apps/api/src/wechat-bot/wechat-bridge.service.ts`
- Create: `apps/api/src/wechat-bot/wechat-outbox.service.ts`
- Create: `apps/api/src/wechat-bot/wechat-outbox.service.spec.ts`
- Create: `apps/api/src/wechat-bot/wechat-retention.service.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/config/env.schema.ts`
- Modify: `apps/api/src/config/configuration.ts`

**Interfaces:**
- Consumes: Task 1 Prisma models and bridge contracts.
- Produces: `BridgePrincipal { deviceId: string }`, `WechatBridgeService.acceptBatch(deviceId, input)`, `WechatOutboxService.enqueue(input)`, `claim(deviceId, limit)`, and `ack(deviceId, messageId, input)`.

- [ ] **Step 1: Write failing guard tests**

Cover missing headers, unknown/disabled device, bad token, bad signature, timestamp outside ±5 minutes, a repeated nonce returning `BRIDGE_REQUEST_REPLAYED`, and a valid signature over exactly `METHOD\n/v1/path\nTIMESTAMP\nNONCE`.

- [ ] **Step 2: Run guard tests and verify failure**

Run: `pnpm --filter @efm/api test -- wechat-bridge-auth.guard.spec.ts --runInBand`

Expected: FAIL because the guard does not exist.

- [ ] **Step 3: Implement `WechatBridgeAuthGuard`**

Authenticate `Authorization: Bridge <token>` against the stored bcrypt token hash, verify the HMAC-SHA256 hex signature with the presented token, atomically insert the device/nonce receipt, reject stale requests, and attach `BridgePrincipal` to the request. Bound request-receipt retention to 24 hours with an opportunistic cleanup after successful authentication.

- [ ] **Step 4: Write failing inbox/outbox tests**

Assert: observed groups upsert from heartbeat; duplicate `(deviceId, messageId)` returns the existing result; messages from unbound/disabled groups are ignored with no text persisted; private messages persist only when matching `^绑定\s+\d{6}$`; claims lease only pending messages for the device; `SENT` requires `readbackMessageId`; failed attempts stop at the configured maximum and open the device circuit; an open circuit claims nothing; business-key duplicates return the original outbox row; expired nonce receipts and command text past the configured retention are deleted without removing bid/audit references.

- [ ] **Step 5: Implement bridge services and controller**

Expose:

- `POST /v1/wechat-bot/bridge/heartbeat`
- `POST /v1/wechat-bot/bridge/messages`
- `POST /v1/wechat-bot/bridge/outbox/claim`
- `POST /v1/wechat-bot/bridge/outbox/:id/ack`

Keep controller methods validation-only; put persistence, leasing, idempotency, and bounded retention cleanup in the services. Configure exact lease duration, maximum attempts, heartbeat timeout, and command-text retention through validated environment values with safe defaults.

- [ ] **Step 6: Register the module and run unit tests**

Run: `pnpm --filter @efm/api test -- wechat-bridge-auth.guard.spec.ts wechat-outbox.service.spec.ts --runInBand && pnpm --filter @efm/api typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/wechat-bot apps/api/src/app.module.ts apps/api/src/config
git commit -m "feat(bot): add authenticated Bridge inbox and outbox"
```

### Task 3: Binding, command routing, and schedule replies

**Files:**
- Create: `apps/api/src/wechat-bot/wechat-binding.service.ts`
- Create: `apps/api/src/wechat-bot/wechat-binding.service.spec.ts`
- Create: `apps/api/src/wechat-bot/wechat-bindings.controller.ts`
- Create: `apps/api/src/wechat-bot/wechat-command-router.service.ts`
- Create: `apps/api/src/wechat-bot/wechat-command-router.service.spec.ts`
- Create: `apps/api/src/wechat-bot/wechat-schedule-query.service.ts`
- Create: `apps/api/src/wechat-bot/wechat-schedule-query.service.spec.ts`
- Create: `apps/api/src/wechat-bot/wechat-message-formatter.ts`
- Modify: `apps/api/src/wechat-bot/wechat-bot.module.ts`
- Modify: `apps/api/src/wechat-bot/wechat-bridge.service.ts`

**Interfaces:**
- Consumes: `WechatOutboxService.enqueue`, existing published competition matches, identity/team relations, and Task 1 binding contracts.
- Produces: `WechatBindingService.issue(userId)`, `status(userId)`, `unbind(userId)`, `consume(deviceId, senderId, code)`, `WechatCommandRouter.route(inboundId)`, and `WechatScheduleQueryService.forGroup(bindingId, userId?)`.

- [ ] **Step 1: Write failing binding tests**

Assert exactly 5-minute expiry, only a hash persisted, a new code invalidates prior unused codes, atomic single consumption under concurrency, idempotent replay from the same inbound message, conflict when either identity or user already has another active binding, five invalid attempts per sender in 10 minutes triggering a rate limit, and successful unbind.

- [ ] **Step 2: Run binding tests and verify failure**

Run: `pnpm --filter @efm/api test -- wechat-binding.service.spec.ts --runInBand`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement binding service and authenticated user endpoints**

Expose:

- `GET /v1/me/wechat-bot/binding`
- `POST /v1/me/wechat-bot/binding-code`
- `DELETE /v1/me/wechat-bot/binding`

Return the code only from the creation call; never return stored hashes.

- [ ] **Step 4: Write failing schedule and router tests**

Cover `帮助`, `查询赛程`, `我的赛程`, private binding, ignored ordinary chat, disabled/unbound group, no configured sources, unpublished/cancelled competition exclusion, deterministic ordering, paging into messages of at most 800 characters, a user with only another league's team, and a user whose current schedule belongs to a selected source.

- [ ] **Step 5: Implement schedule query, formatter, and router**

`WechatCommandRouter.route(inboundId)` must read the persisted inbound row, choose exactly one command handler, enqueue replies with business keys derived from inbound ID plus page number, then persist the processing result in the same transaction boundary used for handler idempotency.

- [ ] **Step 6: Connect accepted inbound messages to routing**

After `acceptBatch` commits each new allowed inbound message, route it once. A duplicate upload returns the stored result and must not call the router again.

- [ ] **Step 7: Run focused tests**

Run: `pnpm --filter @efm/api test -- wechat-binding.service.spec.ts wechat-command-router.service.spec.ts wechat-schedule-query.service.spec.ts --runInBand && pnpm --filter @efm/api typecheck`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/wechat-bot
git commit -m "feat(bot): bind users and answer schedule commands"
```

### Task 4: Admin device, group, and schedule-source APIs

**Files:**
- Create: `apps/api/src/wechat-bot/admin-wechat-bot.controller.ts`
- Create: `apps/api/src/wechat-bot/admin-wechat-bot.service.ts`
- Create: `apps/api/src/wechat-bot/admin-wechat-bot.service.spec.ts`
- Modify: `apps/api/src/wechat-bot/wechat-bot.module.ts`
- Modify: `packages/contracts/src/wechat-bot.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`

**Interfaces:**
- Consumes: Task 1 models, `AdminScopeGuard`, `AuditLogService`, and existing admin league authorization.
- Produces: platform device provisioning/status endpoints and league-scoped group/schedule-source configuration endpoints used by Task 6.

- [ ] **Step 1: Extend contracts and write failing service tests**

Assert platform-only device creation/disable/token rotation/circuit reset, token returned only on creation/rotation, observed-group listing without unrelated message text, league-manager group binding, one-group/one-league conflict, source replacement limited to existing competitions, and an audit record for every mutation.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @efm/api test -- admin-wechat-bot.service.spec.ts --runInBand`

Expected: FAIL because admin services do not exist.

- [ ] **Step 3: Implement admin service and controllers**

Expose platform routes under `/v1/admin/wechat-bot/devices` and league routes under `/v1/admin/leagues/:leagueId/wechat-bot`. Reuse `AdminScopeGuard`; never return credential hashes or inbound command text from status endpoints.

- [ ] **Step 4: Run contracts and service tests**

Run: `pnpm --filter @efm/contracts test && pnpm --filter @efm/api test -- admin-wechat-bot.service.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src apps/api/src/wechat-bot
git commit -m "feat(admin): configure WeChat bot groups and schedules"
```

### Task 5: Mini-program binding page

**Files:**
- Create: `apps/miniprogram/miniprogram/services/wechat-bot.ts`
- Create: `apps/miniprogram/miniprogram/pages/wechat-bot-binding/binding.viewmodel.ts`
- Create: `apps/miniprogram/miniprogram/pages/wechat-bot-binding/binding.viewmodel.spec.ts`
- Create: `apps/miniprogram/miniprogram/pages/wechat-bot-binding/index.ts`
- Create: `apps/miniprogram/miniprogram/pages/wechat-bot-binding/index.json`
- Create: `apps/miniprogram/miniprogram/pages/wechat-bot-binding/index.wxml`
- Create: `apps/miniprogram/miniprogram/pages/wechat-bot-binding/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.wxml`
- Modify: `apps/miniprogram/miniprogram/app.json`

**Interfaces:**
- Consumes: Task 3 user endpoints and `@efm/contracts` binding schemas.
- Produces: profile entry point and binding UI with generate, copy, status, expiry, and unbind actions.

- [ ] **Step 1: Write failing view-model tests**

Cover unbound, active binding, generated-code countdown copy, expired code, request error, and disabled generate button while a request is in flight.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @efm/miniprogram test -- wechat-bot-binding`

Expected: FAIL because the view model does not exist.

- [ ] **Step 3: Implement the API service and pure view model**

Expose `status()`, `issueCode()`, and `unbind()` in the service. Keep time formatting and state derivation in `binding.viewmodel.ts` so they run in Jest without WeChat globals.

- [ ] **Step 4: Implement the Native page and profile link**

Display the six-digit code, exact expiry, `私聊机器人发送：绑定 NNNNNN`, copy action, binding status, and confirmation before unbind. Do not display internal wxid values.

- [ ] **Step 5: Run mini-program tests and typecheck**

Run: `pnpm --filter @efm/miniprogram test && pnpm --filter @efm/miniprogram typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/miniprogram/miniprogram
git commit -m "feat(miniprogram): add WeChat bot identity binding"
```

### Task 6: Admin bot configuration pages

**Files:**
- Create: `apps/admin-web/src/platform/wechat-bot-devices-page.tsx`
- Create: `apps/admin-web/src/platform/wechat-bot-devices-page.spec.tsx`
- Create: `apps/admin-web/src/leagues/wechat-bot-page.tsx`
- Create: `apps/admin-web/src/leagues/wechat-bot-page.spec.tsx`
- Modify: `apps/admin-web/src/app.tsx`
- Modify: `apps/admin-web/src/leagues/league-shell.tsx`
- Modify: `apps/admin-web/src/styles.css`

**Interfaces:**
- Consumes: Task 4 admin contracts through the existing `AdminApi.request` interface.
- Produces: platform device management and league group/schedule-source configuration screens.

- [ ] **Step 1: Write failing component tests**

Cover loading/error/empty states, device offline and circuit-breaker badges, one-time token modal, observed-group selection, conflicting group error, schedule-source selection, save success, and league-manager visibility without device credential controls.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @efm/admin-web test -- wechat-bot`

Expected: FAIL because pages and routes do not exist.

- [ ] **Step 3: Implement pages and routes**

Add `机器人设备` to platform navigation and `微信群机器人` to the league workspace tabs. Keep mutations explicit with confirmation, disable duplicate submissions, and show credential plaintext only in the immediate create/rotate result modal.

- [ ] **Step 4: Run admin tests and build**

Run: `pnpm --filter @efm/admin-web test && pnpm --filter @efm/admin-web typecheck && pnpm --filter @efm/admin-web build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src
git commit -m "feat(admin): manage WeChat bot devices and groups"
```

### Task 7: Foundation end-to-end verification and operations guide

**Files:**
- Create: `apps/api/test/wechat-bot.e2e-spec.ts`
- Create: `docs/development/wechat-bot-foundation-verification.zh-CN.md`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: all prior tasks in this plan.
- Produces: a simulated-Bridge acceptance path and documented environment/verification procedure for the auction and Windows plans.

- [ ] **Step 1: Write the failing e2e acceptance test**

Create device → sign heartbeat with one observed group → bind group to league and schedule source → issue user code → upload private binding command → upload `查询赛程` and `我的赛程` → claim and acknowledge replies. Repeat the inbound batch after the first response and assert one inbox row and one reply per business key.

- [ ] **Step 2: Run the e2e test and verify failure**

Run: `pnpm --filter @efm/api test:e2e -- wechat-bot.e2e-spec.ts --runInBand`

Expected: FAIL on the first incomplete integration seam.

- [ ] **Step 3: Complete only the missing integration wiring**

Fix module exports/imports, test cleanup order, environment defaults, and response schemas revealed by the e2e test; do not add auction behavior.

- [ ] **Step 4: Document local verification and secrets**

Add exact environment variables, simulated request signing, group binding, binding-code flow, schedule commands, outbox acknowledgement, database inspection, and cleanup steps. State that Windows real sending remains disabled until the Bridge plan is complete.

- [ ] **Step 5: Run foundation verification**

Run: `pnpm --filter @efm/contracts test && pnpm --filter @efm/api test -- --runInBand && pnpm --filter @efm/api test:e2e -- wechat-bot.e2e-spec.ts --runInBand && pnpm --filter @efm/miniprogram test && pnpm --filter @efm/admin-web test && pnpm -r typecheck && git diff --check`

Expected: PASS with no diff-check output.

- [ ] **Step 6: Commit**

```bash
git add apps/api/test .env.example README.md docs/development
git commit -m "test(bot): verify WeChat bot foundation flow"
```
