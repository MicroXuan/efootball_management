# Player Disappearance, Negotiated Transfers, and Forced-Offer Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auditable disappearance requests and two-party transfers, and make existing forced offers reachable from public rosters with an accurate copyable group notice.

**Architecture:** Store requests and event history separately from immutable ownership/transaction history. Approval uses the existing roster lifecycle/transfer transaction logic within one atomic review operation. Mini-program asset and market pages present only actions the server authorizes.

**Tech Stack:** Prisma/MySQL, NestJS, Zod, React/Ant Design, native WeChat mini-program, Jest/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-season-calendar-nominations-team-assets-transfers-design.zh-CN.md`

**Dependency:** Complete `2026-10-19-team-salary-cap-assets-plan.md` first so approvals use team-specific caps and public team rosters exist.

## Global Constraints

- A disappearance request has no roster/salary effect until admin approval; approved player remains owned but status becomes `DISAPPEARED`.
- Negotiated transfer requires counterparty confirmation and admin approval; final mutation is atomic with finance/roster/audit writes.
- Forced-offer amount is a bid price, never a new official valuation. Group text is copied by the user; the app does not send to WeChat groups.
- Server rechecks window, ownership, roster size, and destination team cap when executing, even when the UI previously showed an enabled action.
- Preserve unrelated dirty workspace files.

## Review Focus

- A pending disappearance does not reduce current roster size or salary (Task 1 test).
- Two admins reviewing the same request cannot both mutate ownership (Task 2 test).
- A transfer proposed before deadline but approved after the window closes is invalidated without partial ledger writes (Task 4 test).
- A target team that becomes full or over cap after counterparty confirmation is rejected at approval (Task 4 test).
- Copied forced-offer text uses the submitted application amount and IDs, not stale form values (Task 6 test).

---

## File structure

- Add `packages/contracts/src/player-requests.ts` for disappearance and negotiated transfer DTOs; leave forced-transfer contracts in `player-market.ts`.
- Keep request controllers/services in `apps/api/src/player-requests/`; make existing roster transaction/lifecycle core callable with the same Prisma transaction client so request state and ownership mutate atomically.
- Add admin queues under `apps/admin-web/src/rosters/`; add own/public action sections to the mini-program assets page and keep forced price composer in `player-market-detail`.

### Task 1: Disappearance request contract, storage, and owner submit

**Files:** Modify `apps/api/prisma/schema.prisma`, `packages/contracts/src/index.ts`; create `apps/api/prisma/migrations/202610200003_player_requests/migration.sql`, `packages/contracts/src/player-requests.ts`, `apps/api/src/player-requests/{player-requests.module.ts,disappearance.service.ts,disappearance.service.spec.ts,my-player-requests.controller.ts}`; modify `apps/api/src/app.module.ts`.

**Interfaces:** `DisappearanceRequest {id,leagueId,seasonId,ownershipId,requesterTeamId,status:'PENDING'|'APPROVED'|'REJECTED'|'WITHDRAWN'|'INVALIDATED',reason,version,createdAt,reviewedAt}`; `POST /me/league-teams/:teamId/roster/:ownershipId/disappearance-requests {reason,expectedOwnershipVersion}` and `GET /me/player-requests` for owner status.

- [ ] **Step 1: Write failing tests.** Only active owner may submit; blank reason, duplicate pending request, changed ownership version are rejected; successful submit leaves ownership `ACTIVE` and salary unchanged.
- [ ] **Step 2: Run red.** Targeted disappearance service Jest and contracts test.
- [ ] **Step 3: Implement.** Add Prisma model/event and scoped controller with idempotency key; unique active-request behavior and version snapshot; expose current request status for owner assets/action center.
- [ ] **Step 4: Run green.** Targeted tests, Prisma generation, contracts/API typechecks.
- [ ] **Step 5: Commit** Task 1 files with `feat: request player disappearance review`.

### Task 2: Admin disappearance review

**Files:** Modify `apps/api/src/league-rosters/roster-transactions.service.ts` and spec; create `apps/api/src/player-requests/admin-disappearance.controller.ts`, `disappearance-review.service.{ts,spec.ts}`; create `apps/admin-web/src/rosters/disappearance-review-page.tsx` and test; modify `apps/admin-web/src/app.tsx` to register the admin route.

**Interfaces:** `POST /admin/leagues/:leagueId/disappearance-requests/:id/review {decision:'APPROVE'|'REJECT',reason,expectedVersion}`; approval calls shared `updateLifecycleStatusWithClient(tx, ...)`, not a second transaction.

- [ ] **Step 1: Write failing tests.** Pending request approved exactly once moves ACTIVE→DISAPPEARED, keeps team owner, reduces active count/salary; rejection leaves status; two concurrent reviews produce one version conflict and no duplicate audit.
- [ ] **Step 2: Run red.** Targeted review and roster transaction Jest, admin review Vitest.
- [ ] **Step 3: Implement.** Extract transaction-scoped lifecycle core, compose request status + roster mutation in one receipt transaction, preserve existing admin lifecycle route behavior; render admin queue with reason/history.
- [ ] **Step 4: Run green.** Targeted tests, API/admin typechecks.
- [ ] **Step 5: Commit** Task 2 files with `feat: review disappearance requests`.

### Task 3: Negotiated transfer proposal and counterparty consent

**Files:** Extend Prisma request migration/model and `packages/contracts/src/player-requests.ts`; create `apps/api/src/player-requests/{transfer-proposal.service.ts,transfer-proposal.service.spec.ts,my-transfer-proposals.controller.ts}`.

**Interfaces:** `TransferProposal {id,seasonId,ownershipId,sourceTeamId,targetTeamId,amountMinor,initiatorTeamId,status:'PENDING_COUNTERPARTY'|'PENDING_ADMIN'|'REJECTED'|'WITHDRAWN'|'APPROVED'|'EXPIRED'|'INVALIDATED',version}`; submit `{initiatorTeamId,ownershipId,targetTeamId,amountMinor,expectedOwnershipVersion}`, counterparty `POST /me/transfer-proposals/:id/confirm {expectedVersion}`, reject/withdraw endpoints, plus `GET /me/transfer-proposals` for both parties. `GET /me/leagues/:leagueId/transfer-candidates/:playerId` provides action eligibility, current `ownershipId/version`, owner and window to an authenticated participant only; the public asset DTO stays version-free.

- [ ] **Step 1: Write failing tests.** Either team may initiate but no unrelated team may confirm; self-transfer, invalid price, duplicate active proposal, changed ownership and closed window reject; confirmation freezes price/teams; reject/withdraw retain events.
- [ ] **Step 2: Run red.** Targeted proposal service Jest and contracts test.
- [ ] **Step 3: Implement.** Snapshot participants and ownership version, require active transfer window, idempotent submissions, signed confirmation and event history; add candidate lookup for the action composer; expire or invalidate stale proposals without roster mutation.
- [ ] **Step 4: Run green.** Targeted tests, Prisma generation and API/contracts typechecks.
- [ ] **Step 5: Commit** Task 3 files with `feat: negotiate team transfers`.

### Task 4: Atomic admin transfer approval

**Files:** Modify `apps/api/src/league-rosters/roster-transactions.service.ts`, `.spec.ts`; create `apps/api/src/player-requests/{transfer-review.service.ts,transfer-review.service.spec.ts,admin-transfer-proposals.controller.ts}`; create `apps/admin-web/src/rosters/transfer-proposals-page.tsx` and test; modify `apps/admin-web/src/app.tsx` to register the admin route.

**Interfaces:** `POST /admin/leagues/:leagueId/transfer-proposals/:id/review {decision:'APPROVE'|'REJECT',reason,expectedVersion}`; `RosterTransactionsService.transferWithClient(tx, input, adminId, at)` is reused by existing admin `transfer(...)` and review.

- [ ] **Step 1: Write failing tests.** Only `PENDING_ADMIN` reviewable; final window/owner/cap/roster checks use Task B team cap; after cutoff or changed ownership no approval/ledger write; successful approval makes one transfer, fee, two ledger entries, one audit and APPROVED proposal atomically.
- [ ] **Step 2: Run red.** Targeted transfer review and roster transaction Jest, admin page Vitest.
- [ ] **Step 3: Implement.** Extract existing transfer core under one transaction client and call it from review receipt; keep historical direct-admin transfer API intact. Admin queue presents both confirmations, price, projected cap status and reasons.
- [ ] **Step 4: Run green.** Targeted tests, API/admin typechecks and transfer regression.
- [ ] **Step 5: Commit** Task 4 files with `feat: approve negotiated transfers atomically`.

### Task 5: Mini-program action states and navigation

**Files:** Modify `apps/miniprogram/miniprogram/pages/team-assets/{index.ts,index.wxml,index.wxss,team-assets.viewmodel.ts,*.spec.ts}`, `services/economy.ts`; create `services/player-requests.ts` and focused tests; modify `packages/contracts/src/action-center.ts`, `apps/api/src/action-center/{action-center.service.ts,action-center.service.spec.ts}`, and `apps/miniprogram/miniprogram/pages/action-center/` for new request status cards.

**Interfaces:** Owner player card gets `申请标记消失` and `发起转会`; public player card gets `协商转会` and `发起强报` when server action allows. Request statuses map to visible pending/approved/rejected cards.

- [ ] **Step 1: Write failing tests.** Visitor never sees owner-only controls; a visitor without an active own team sees no transfer/strong-offer submit action; market navigation uses the visitor's team ID, not the viewed team's ID; pending disappearance stays in active tab; non-window transfer explains why disabled; stale version errors refresh without duplicate submit; request status shows in action center.
- [ ] **Step 2: Run red.** Targeted team-assets, services and action-center Vitest.
- [ ] **Step 3: Implement.** Use separate owner/public DTOs from Task B; route forced action to existing player-market detail; use confirmation form for disappearance reason and transfer team/amount, retaining inputs after errors.
- [ ] **Step 4: Run green.** Targeted tests, mini typecheck, WeChat developer tools layout check.
- [ ] **Step 5: Commit** Task 5 files with `feat: expose player lifecycle actions`.

### Task 6: Accurate forced-offer group text

**Files:** Modify `packages/contracts/src/player-market.ts`, `apps/api/src/player-market/player-market-query.service.ts` and spec to expose nullable English player name; modify `apps/miniprogram/miniprogram/pages/player-market-detail/{index.ts,index.wxml,index.wxss,player-market-detail.viewmodel.ts,*.spec.ts}`; create `apps/miniprogram/miniprogram/pages/player-market-detail/forced-offer-copy.ts` and spec.

**Interfaces:** `forcedOfferCopy(application: PlayerAcquisitionApplication, playerEnglishName: string|null): string`; generated only after successful `FORCED_TRANSFER` submission/refresh. Uses returned `application.id`, `amountMinor`, applicant/source team number/name/alias and player display names.

- [ ] **Step 1: Write failing tests.** Copy contains applicant/source team identities, player and actual returned bid amount/ID; it says “强报报价”, never “新标价”; missing English name degrades cleanly; no copy action before a real application exists.
- [ ] **Step 2: Run red.** Targeted player-market-detail Vitest.
- [ ] **Step 3: Implement.** Render a text preview and “复制强报文案”; call `wx.setClipboardData` on click, show copy success/failure, never claim message was sent. Do not mutate valuation.
- [ ] **Step 4: Run green.** Targeted tests, mini typecheck and existing player-market tests.
- [ ] **Step 5: Commit** Task 6 files with `feat: copy forced-offer notice`.

## Final verification

- [ ] Run focused contract/API/admin/mini suites, `pnpm typecheck`, and `pnpm build`; run full suites when practical and report any stall.
- [ ] Exercise owner, counterparty, unrelated participant and admin roles; inspect the copied text and request status in WeChat developer tools.
