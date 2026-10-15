# 小程序球员市场、强报与下放 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在联赛上下文中交付小程序球员市场、公开购买申请、按时间排队的强报、球队资产下放和管理员审核闭环。

**Architecture:** 新建独立 `player-market` 领域模块，申请与事件使用新表，最终成交继续写现有 `LeaguePlayerOwnership`、`RosterTransaction` 和 `FinanceLedgerEntry`。共享 Zod 契约作为 API、管理后台和小程序的唯一接口定义；小程序新增市场列表与详情页，现有“球队资产”只增加下放能力，管理后台新增审核队列。

**Tech Stack:** TypeScript 5.9、NestJS 12、Prisma 7/MariaDB、Zod 4、React 19 + Ant Design 6、原生微信小程序、Jest/Vitest。

**Spec:** `docs/superpowers/specs/2026-10-14-miniprogram-player-market-design.zh-CN.md`

## Global Constraints

- 球员市场正式入口必须是“联赛 → 我参加的联赛 → 联赛详情 → 球员市场”，不新增底部 Tab。
- 下放入口只加入现有“球队资产”，不得新增“我的阵容”或修改模块名称。
- 普通购买只适用于自由球员；管理员可选择任意有效申请，最高价不保证获批。
- 强报无需原球队同意，按首次有效提交时间审核，成交金额不得低于当前官方身价。
- 阵容达到 25 人时必须先真实下放；提交和审批两个阶段都要校验。
- 财务只记账、不限制余额；强报买方支出与卖方收入必须等额。
- 强报不更换当前球员卡、自动加点总评、工资或工资规则版本。
- “强报”标签只在取得赛季显示，同一球员同赛季允许再次强报。
- 所有用户与管理员写请求必须幂等、带版本校验，并产生申请事件与审计记录。
- 微信群机器人不参与任何业务判断、申请或成交。

## Review Focus

- 金额边界：零、负数、小数和超过无符号整数上限必须被契约拒绝；对应测试放在 Task 1。
- 窗口边界：`at >= endsAt` 时提交、修改和审核都必须过期而不是成交；对应测试放在 Task 3 和 Task 5。
- 竞争写入：同一申请改价/撤回、同一球员普通成交/强报/下放并发时只能有一个胜者；对应测试放在 Task 3、Task 4 和 Task 5。
- 身价与归属漂移：排队期间身价上涨或归属版本改变必须转入明确状态，不能沿用旧条件成交；对应测试放在 Task 4 和 Task 5。
- 隐私与越权：公开接口只能返回球队公开身份，跨联赛用户、非负责人和已退出球队不能操作；对应测试放在 Task 2、Task 3 和 Task 6。

---

### Task 1: 数据库模型与共享契约

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261014120000_player_market/migration.sql`
- Create: `packages/contracts/src/player-market.ts`
- Modify: `packages/contracts/src/league-roster.ts`
- Modify: `packages/contracts/src/league-economy.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`

**Interfaces:**
- Consumes: 现有 `ResourceIdSchema`、`ExpectedVersionSchema`、`MoneyMinorSchema`、球队公开摘要和球员卡摘要。
- Produces: `PlayerApplicationType`、`PlayerApplicationStatus`、市场查询/详情/申请/事件/公告契约、提交/改价/撤回/审核/下放请求契约；Prisma 模型 `PlayerAcquisitionApplication`、`PlayerAcquisitionApplicationEvent`、`PlayerReleaseRestriction`；交易类型 `FORCED_TRANSFER` 和归属取得来源字段。

- [ ] **Step 1: 写失败的契约测试**

在 `contracts.spec.ts` 增加覆盖：

- 普通购买与强报申请可解析。
- 强报必须带 `sourceLeagueTeamId`、`ownershipId` 和 `ownershipVersionSnapshot`。
- `amountMinor` 拒绝 `0`、负数、小数和 `4_294_967_296`。
- 状态集合包含 `REQUOTE_REQUIRED`、`OWNERSHIP_CHANGED`、`INELIGIBLE`。
- 下放请求必须包含 `seasonId`、`transferWindowId`、`ownershipId`、`expectedVersion` 和非空原因。

- [ ] **Step 2: 运行契约测试并确认失败**

Run: `pnpm --filter @efm/contracts test`

Expected: FAIL，提示 `player-market` 契约或导出不存在。

- [ ] **Step 3: 添加 Prisma 枚举、模型和迁移**

在 `schema.prisma` 定义：

- `PlayerApplicationType = NORMAL_PURCHASE | FORCED_TRANSFER`
- `PlayerApplicationStatus = PENDING | APPROVED | NOT_SELECTED | REJECTED | WITHDRAWN | EXPIRED | INELIGIBLE | REQUOTE_REQUIRED | OWNERSHIP_CHANGED`
- `PlayerApplicationEventType = SUBMITTED | AMOUNT_CHANGED | WITHDRAWN | APPROVED | REJECTED | NOT_SELECTED | EXPIRED | REQUOTE_REQUIRED | OWNERSHIP_CHANGED | INELIGIBLE`
- `OwnershipAcquisitionType = NORMAL | FORCED_TRANSFER`
- `PlayerAcquisitionApplication` 包含设计文档列出的范围、金额、快照、审核、版本和时间字段。
- `PlayerAcquisitionApplicationEvent` 保存前后状态、前后金额、用户/管理员操作者、原因和时间。
- `PlayerReleaseRestriction` 对 `(transferWindowId, leagueTeamId, footballPlayerId)` 唯一。
- `LeaguePlayerOwnership` 增加 `acquisitionType` 与可空 `acquisitionSeasonId`。
- `RosterTransactionType` 增加 `FORCED_TRANSFER`，`RosterTransaction` 增加可空 `playerApplicationId`。

迁移必须补齐外键和以下索引：市场分页、球队有效申请、球员待审队列、强报时间顺序、事件时间线。终态允许重新申请；“同一球队/球员/类型仅一笔有效申请”由事务锁和服务查询保证，不使用会阻止历史尝试的永久唯一键。

- [ ] **Step 4: 实现并导出共享 Zod 契约**

在 `player-market.ts` 定义精确类型：

```ts
PlayerMarketQuerySchema
PlayerMarketListResponseSchema
PlayerMarketPlayerDetailSchema
PlayerAcquisitionApplicationSchema
PlayerApplicationEventSchema
PlayerApplicationListResponseSchema
PlayerMarketAnnouncementListResponseSchema
SubmitPlayerApplicationRequestSchema
AmendPlayerApplicationRequestSchema
WithdrawPlayerApplicationRequestSchema
ReviewPlayerApplicationRequestSchema
ReleaseOwnedPlayerRequestSchema
```

市场球员摘要必须包含当前归属球队的 `teamId/teamNumber/name/logoUrl/ownerAlias` 可空对象、官方身价与版本、推荐卡或当前卡、工资、AT、`action: APPLY | FORCE_SIGN | OWNED_BY_ME | DISABLED` 和明确禁用原因。更新 `league-roster.ts` 与 `league-economy.ts` 以返回强报标签和下放需要的 ownership ID/version。

- [ ] **Step 5: 生成 Prisma 客户端并验证**

Run: `pnpm db:generate && pnpm --filter @efm/contracts test && pnpm --filter @efm/contracts typecheck`

Expected: 全部 PASS。

- [ ] **Step 6: 提交**

```bash
git add apps/api/prisma packages/contracts/src
git commit -m "feat: define player market data contracts"
```

### Task 2: 市场只读查询与操作资格

**Files:**
- Create: `apps/api/src/player-market/player-market.errors.ts`
- Create: `apps/api/src/player-market/player-market-access.service.ts`
- Create: `apps/api/src/player-market/player-market-query.service.ts`
- Create: `apps/api/src/player-market/player-market-query.service.spec.ts`
- Create: `apps/api/src/player-market/player-market.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: Task 1 的市场响应类型、现有 `LeagueVisibilityService`、赛季报名、转会窗口、归属、身价和球员卡数据。
- Produces: `PlayerMarketAccessService.requireParticipant(userId, leagueId, seasonId)`、`requireOwnedTeam(...)`；`PlayerMarketQueryService.listMarket(...)`、`detail(...)`、`listApplications(...)`、`listAnnouncements(...)`。

- [ ] **Step 1: 写失败的查询与权限测试**

测试固定以下结果：

- 参赛成员能看到自由球员和已归属球员。
- 已归属摘要只包含球队编号、队徽、队名和联赛称呼，不包含 owner user ID 或微信字段。
- 本队、其他队、自由球员分别得到 `OWNED_BY_ME`、`FORCE_SIGN`、`APPLY` 操作状态。
- 25/25、窗口关闭、工资帽不合规和原队本窗口下放限制返回明确禁用码。
- 非联赛成员、跨联赛 seasonId 和 `ARCHIVED` 球队被拒绝。
- 关键字首尾空白被清理，分页游标在同时间戳数据下仍稳定。

- [ ] **Step 2: 运行查询测试并确认失败**

Run: `pnpm --filter @efm/api test -- player-market-query.service.spec.ts --runInBand`

Expected: FAIL，模块尚不存在。

- [ ] **Step 3: 实现访问边界**

实现：

```ts
requireParticipant(userId: string, leagueId: string, seasonId: string): Promise<ParticipantScope>
requireOwnedTeam(userId: string, leagueTeamId: string, seasonId: string): Promise<OwnedTeamScope>
```

`ParticipantScope` 返回当前用户的批准赛季报名和联赛球队；所有命令从该对象取得球队 ID，禁止信任请求体中的操作者球队。

- [ ] **Step 4: 实现市场聚合查询**

实现：

```ts
listMarket(userId: string, leagueId: string, query: PlayerMarketQuery): Promise<PlayerMarketListResponse>
detail(userId: string, leagueId: string, playerId: string, seasonId: string): Promise<PlayerMarketPlayerDetail>
listApplications(userId: string, leagueId: string, query: PlayerApplicationListQuery): Promise<PlayerApplicationListResponse>
listAnnouncements(userId: string, leagueId: string, query: AnnouncementQuery): Promise<PlayerMarketAnnouncementListResponse>
```

使用批量查询拼装身价、归属、当前/推荐卡、公开球队身份和我的申请，避免逐球 N+1；操作资格由一个纯映射函数统一生成。

- [ ] **Step 5: 运行测试并提交**

Run: `pnpm --filter @efm/api test -- player-market-query.service.spec.ts --runInBand`

Expected: PASS。

```bash
git add apps/api/src/player-market apps/api/src/app.module.ts
git commit -m "feat: add player market queries"
```

### Task 3: 普通购买申请、改价与撤回

**Files:**
- Create: `apps/api/src/player-market/player-application.service.ts`
- Create: `apps/api/src/player-market/player-application.service.spec.ts`
- Create: `apps/api/src/player-market/player-market-lock.repository.ts`
- Modify: `apps/api/src/player-market/player-market.module.ts`

**Interfaces:**
- Consumes: Task 1 请求/响应契约、Task 2 权限服务、`MutationReceiptService`、转会窗口和 Prisma 事务。
- Produces: `submit(userId, leagueId, input, key)`、`amend(userId, applicationId, input, key)`、`withdraw(userId, applicationId, input, key)`；后续审核使用的应用事件写入和锁方法。

- [ ] **Step 1: 写失败的普通申请服务测试**

覆盖：

- 自由球员允许多队各提交一笔待审申请。
- 同队同球员同类型已有有效申请时返回 `ACTIVE_APPLICATION_EXISTS`。
- 改价更新版本并追加公开事件，不覆盖首次提交时间。
- 撤回写终态与事件，之后允许新建一次申请尝试。
- 非负责人不能改价或撤回其他队申请。
- 25 人、已退出球队、已归属球员、工资帽不合规和下放回购限制不能提交。
- `at === endsAt` 时提交/改价返回 `TRANSFER_WINDOW_CLOSED`。
- 两个并发提交只有一个成为该队有效申请；同版本并发改价/撤回只有一个成功。
- 相同幂等键不重复创建申请或事件。

- [ ] **Step 2: 运行服务测试并确认失败**

Run: `pnpm --filter @efm/api test -- player-application.service.spec.ts --runInBand`

Expected: FAIL，服务尚不存在。

- [ ] **Step 3: 实现申请锁与事件写入**

`PlayerMarketLockRepository` 提供：

```ts
lockPlayer(tx, leagueId: string, footballPlayerId: string): Promise<void>
lockTeam(tx, leagueTeamId: string): Promise<void>
lockApplication(tx, applicationId: string): Promise<void>
```

每次状态或金额变化都通过同一私有 `appendEvent(...)` 写事件；事件与当前行更新在同一事务中。

- [ ] **Step 4: 实现普通申请命令**

使用 `MutationReceiptService.execute` 包裹用户命令。提交时解析当前卡、官方身价、人数、工资帽、窗口和回购限制；修改只允许 `PENDING`；撤回允许 `PENDING` 与 `REQUOTE_REQUIRED`。版本冲突统一返回 `VERSION_CONFLICT`。

- [ ] **Step 5: 运行测试并提交**

Run: `pnpm --filter @efm/api test -- player-application.service.spec.ts --runInBand`

Expected: PASS。

```bash
git add apps/api/src/player-market
git commit -m "feat: add public player applications"
```

### Task 4: 强报队列、身价漂移与再次强报

**Files:**
- Modify: `apps/api/src/player-market/player-application.service.ts`
- Modify: `apps/api/src/player-market/player-application.service.spec.ts`
- Create: `apps/api/src/player-market/forced-transfer-policy.ts`
- Create: `apps/api/src/player-market/forced-transfer-policy.spec.ts`

**Interfaces:**
- Consumes: Task 3 的申请命令、锁与事件接口，当前归属版本和 `LeaguePlayerValuation.version`。
- Produces: `forcedTransferPosition(...)`、`reconcileForcedApplication(...)`；强报提交、补价、撤回和稳定排序行为。

- [ ] **Step 1: 写失败的强报策略测试**

覆盖：

- 金额低于当前官方身价不能提交。
- 强报只能针对其他球队的 `ACTIVE` 归属，且申请保存来源球队、ownership ID/version 和身价版本。
- 队列按 `firstValidSubmittedAt`、再按 application ID 排序。
- 身价上涨后金额不足变为 `REQUOTE_REQUIRED`；补足后恢复 `PENDING` 且保留原排队时间。
- 身价下降不降低报价。
- 归属版本变化变为 `OWNERSHIP_CHANGED`。
- 同一球员同一赛季被强报成交后可以针对新归属再次提交。
- 并发补价与撤回只有一个成功。

- [ ] **Step 2: 运行策略测试并确认失败**

Run: `pnpm --filter @efm/api test -- forced-transfer-policy.spec.ts player-application.service.spec.ts --runInBand`

Expected: FAIL，强报策略尚不存在。

- [ ] **Step 3: 实现纯策略函数**

在 `forced-transfer-policy.ts` 导出：

```ts
reconcileForcedApplication(input: ForcedApplicationSnapshot): ForcedApplicationDecision
sortForcedQueue(items: readonly ForcedQueueItem[]): ForcedQueueItem[]
```

纯函数只决定 `PENDING | REQUOTE_REQUIRED | OWNERSHIP_CHANGED | EXPIRED` 和原因；不读数据库，便于边界测试。

- [ ] **Step 4: 接入强报提交与补价**

扩展 `submit` 与 `amend`：强报卡片固定为当前 ownership 的卡片；补价不得低于最新身价，也不得低于当前提交金额；合法补价只更新 `lastSubmittedAt`，不改 `firstValidSubmittedAt`。

- [ ] **Step 5: 运行测试并提交**

Run: `pnpm --filter @efm/api test -- forced-transfer-policy.spec.ts player-application.service.spec.ts --runInBand`

Expected: PASS。

```bash
git add apps/api/src/player-market
git commit -m "feat: add forced transfer queue policy"
```

### Task 5: 管理员审核与原子成交

**Files:**
- Create: `apps/api/src/player-market/player-market-review.service.ts`
- Create: `apps/api/src/player-market/player-market-review.service.spec.ts`
- Modify: `apps/api/src/player-market/player-market.module.ts`
- Modify: `apps/api/src/league-rosters/roster-lock.repository.ts`
- Modify: `apps/api/src/league-rosters/roster-transactions.service.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–4 的申请、事件、锁和策略，现有 `SalaryRulesService`、`TransferWindowsService`、`RosterLockRepository`、`AuditLogService`、`AdminMutationReceiptService`。
- Produces: `approve(adminId, applicationId, input, key, at)`、`reject(...)`；普通买入和强报的唯一成交事务。

- [ ] **Step 1: 写失败的审核与成交测试**

普通购买覆盖：管理员可任选有效申请；通过后创建 `BUY` 交易、归属和买方 `PLAYER_PURCHASE/DEBIT`，其他申请变为 `NOT_SELECTED`。

强报覆盖：

- 只能审核当前最早有效申请，跳号返回 `FORCED_QUEUE_ORDER_VIOLATION`。
- 成交写 `FORCED_TRANSFER`，保留卡片、AT、工资和工资规则版本。
- 买方 `PLAYER_TRANSFER/DEBIT` 与卖方 `PLAYER_TRANSFER/CREDIT` 金额相等；负净额不阻塞。
- 更新归属的 `acquisitionType/acquisitionSeasonId/acquiredAt/version`。
- 针对旧归属版本的其他申请变为 `OWNERSHIP_CHANGED`。
- 再次强报以新来源球队和新版本成交。

共同覆盖：管理员权限、非空原因、25 人、工资帽、`at === endsAt`、官方身价上涨、重复幂等键、并发批准和中途异常整体回滚。

- [ ] **Step 2: 运行审核测试并确认失败**

Run: `pnpm --filter @efm/api test -- player-market-review.service.spec.ts --runInBand`

Expected: FAIL，审核服务尚不存在。

- [ ] **Step 3: 实现审批前复核**

在事务内按固定顺序锁定申请、球员归属、来源球队、目标球队；重新读取窗口、人数、工资帽、身价和归属版本。身价不足写 `REQUOTE_REQUIRED` 事件并终止成交；归属漂移写 `OWNERSHIP_CHANGED`；其他资格失败写 `INELIGIBLE` 与明确原因。

- [ ] **Step 4: 实现普通购买与强报成交**

普通购买复用现有买入语义，但由申请数据驱动。强报在同一事务内更新 ownership、创建交易、创建两笔账本、更新竞争申请、写申请事件和管理员审计。不得调用会开启嵌套事务的公共方法；抽取或复用接收 `Prisma.TransactionClient` 的内部原语。

- [ ] **Step 5: 实现驳回**

`reject` 只接受 `PENDING` 或 `REQUOTE_REQUIRED`，要求 `expectedVersion` 和非空原因；写 `REJECTED`、事件及审计，不修改归属或账本。

- [ ] **Step 6: 运行测试并提交**

Run: `pnpm --filter @efm/api test -- player-market-review.service.spec.ts roster-transactions.service.spec.ts --runInBand`

Expected: PASS。

```bash
git add apps/api/src/player-market apps/api/src/league-rosters
git commit -m "feat: settle reviewed player applications"
```

### Task 6: 球队负责人下放与 HTTP API

**Files:**
- Create: `apps/api/src/player-market/team-player-release.service.ts`
- Create: `apps/api/src/player-market/team-player-release.service.spec.ts`
- Create: `apps/api/src/player-market/my-player-market.controller.ts`
- Create: `apps/api/src/player-market/admin-player-market.controller.ts`
- Create: `apps/api/src/player-market/player-market.controller.spec.ts`
- Modify: `apps/api/src/player-market/player-market.module.ts`
- Modify: `apps/api/src/league-economy/team-assets.service.ts`
- Modify: `apps/api/src/league-economy/team-assets.service.spec.ts`
- Modify: `apps/api/test/league-rosters.e2e-spec.ts`

**Interfaces:**
- Consumes: Tasks 1–5 的命令和查询；现有 `JwtAuthGuard`、`AdminAuthGuard`、审计、用户幂等回执与球队资产响应。
- Produces: 下列完整 API：
  - `GET /v1/me/leagues/:leagueId/player-market`
  - `GET /v1/me/leagues/:leagueId/player-market/:playerId`
  - `GET /v1/me/leagues/:leagueId/player-market-applications`
  - `GET /v1/me/leagues/:leagueId/player-market-announcements`
  - `POST /v1/me/leagues/:leagueId/player-market-applications`
  - `PATCH /v1/me/player-market-applications/:applicationId`
  - `POST /v1/me/player-market-applications/:applicationId/withdraw`
  - `POST /v1/me/league-teams/:teamId/roster/:ownershipId/release`
  - `GET /v1/admin/leagues/:leagueId/player-market-applications`
  - `POST /v1/admin/player-market-applications/:applicationId/approve`
  - `POST /v1/admin/player-market-applications/:applicationId/reject`

- [ ] **Step 1: 写失败的下放服务测试**

覆盖：负责人确认后立即把 ownership 置为 `RELEASED`、写 `RELEASE` 交易、释放人数与工资、写 `PlayerReleaseRestriction` 和用户审计；不写财务流水。非负责人、已退出球队、错误 ownership 版本、非现役球员、窗口不允许 SELL、重复幂等键和下放/强报并发都必须有唯一结果。

- [ ] **Step 2: 写失败的控制器与 E2E 测试**

验证所有端点的鉴权、Zod 校验、`Idempotency-Key`、公开分页、我的申请、管理员审核、明确错误码和隐私字段缺失。加入端到端闭环：自由球员多队申请→管理员选择；25 人下放→再申请；两队强报→首笔成交→旧归属申请失效。

- [ ] **Step 3: 运行测试并确认失败**

Run: `pnpm --filter @efm/api test -- team-player-release.service.spec.ts player-market.controller.spec.ts --runInBand`

Expected: FAIL，服务和控制器尚不存在。

- [ ] **Step 4: 实现下放服务和球队资产字段**

实现：

```ts
release(userId: string, leagueTeamId: string, input: ReleaseOwnedPlayerRequest, key: string, at?: Date): Promise<RosterMutationResponse>
```

球队资产 player 项增加 `ownershipId`、`ownershipVersion`、`canRelease`、`releaseDisabledReason` 和当季 `forcedTransferBadge`。下放限制与交易在一个用户幂等事务中完成。

- [ ] **Step 5: 实现 HTTP 控制器**

控制器只处理身份、参数、请求头和 Zod 校验；业务判断全部委托服务。管理员列表支持 `type/status/playerId/cursor`，强报结果按不可跳过顺序返回。

- [ ] **Step 6: 运行单测与 E2E 并提交**

Run: `pnpm --filter @efm/api test -- team-player-release.service.spec.ts player-market.controller.spec.ts team-assets.service.spec.ts --runInBand && pnpm --filter @efm/api test:e2e -- league-rosters.e2e-spec.ts --runInBand`

Expected: PASS。

```bash
git add apps/api/src/player-market apps/api/src/league-economy apps/api/test/league-rosters.e2e-spec.ts
git commit -m "feat: expose player market workflows"
```

### Task 7: 管理后台审核队列

**Files:**
- Create: `apps/admin-web/src/player-market/player-market-review-page.tsx`
- Create: `apps/admin-web/src/player-market/player-market-review-page.spec.tsx`
- Create: `apps/admin-web/src/player-market/player-market-review.model.ts`
- Create: `apps/admin-web/src/player-market/player-market-review.model.spec.ts`
- Modify: `apps/admin-web/src/app.tsx`
- Modify: `apps/admin-web/src/leagues/league-shell.tsx`
- Modify: `apps/admin-web/src/design-system/icons.tsx`
- Modify: `apps/admin-web/src/styles.css`

**Interfaces:**
- Consumes: Task 1 管理员列表/审核契约和 Task 6 HTTP API。
- Produces: 联赛工作区“球员申请”导航、普通购买与强报审核队列、复核和原因对话框。

- [ ] **Step 1: 写失败的展示模型测试**

覆盖：普通申请按球员聚合；强报按 `firstValidSubmittedAt/id` 排序；只有首笔显示“可审核”；身价不足、归属变化、25 人和窗口关闭显示对应状态与原因。

- [ ] **Step 2: 写失败的页面测试**

覆盖：切换普通/强报、筛选状态、查看公开改价时间线、普通申请任选、强报后续按钮禁用、审批原因必填、提交携带版本和幂等键、成功后刷新队列。

- [ ] **Step 3: 运行后台测试并确认失败**

Run: `pnpm --filter @efm/admin-web test -- player-market-review.model.spec.ts player-market-review-page.spec.tsx`

Expected: FAIL，页面和模型尚不存在。

- [ ] **Step 4: 实现展示模型与审核页**

页面加载 `/v1/admin/leagues/:leagueId/player-market/applications`；通过/驳回调用 `/v1/admin/player-market/applications/:id/approve|reject`。审批抽屉显示球员卡、所属队、申请队、人数、工资、官方身价、报价和实时复核提示。

- [ ] **Step 5: 接入路由、导航和样式**

新增 `/leagues/:leagueId/player-market` 路由和“球员申请”导航项；更新 active key 判定。保持现有管理后台主题和响应式卡片规范，不复用旧管理员直接购买抽屉作为审核入口。

- [ ] **Step 6: 运行测试并提交**

Run: `pnpm --filter @efm/admin-web test && pnpm --filter @efm/admin-web typecheck`

Expected: PASS。

```bash
git add apps/admin-web/src
git commit -m "feat: add player application review queue"
```

### Task 8: 小程序球员市场与公开进度

**Files:**
- Create: `apps/miniprogram/miniprogram/services/player-market.ts`
- Create: `apps/miniprogram/miniprogram/services/player-market.spec.ts`
- Create: `apps/miniprogram/miniprogram/pages/player-market/index.json`
- Create: `apps/miniprogram/miniprogram/pages/player-market/index.ts`
- Create: `apps/miniprogram/miniprogram/pages/player-market/index.wxml`
- Create: `apps/miniprogram/miniprogram/pages/player-market/index.wxss`
- Create: `apps/miniprogram/miniprogram/pages/player-market/player-market.viewmodel.ts`
- Create: `apps/miniprogram/miniprogram/pages/player-market/player-market.viewmodel.spec.ts`
- Create: `apps/miniprogram/miniprogram/pages/player-market/player-market.template.spec.ts`
- Create: `apps/miniprogram/miniprogram/pages/player-market-detail/index.json`
- Create: `apps/miniprogram/miniprogram/pages/player-market-detail/index.ts`
- Create: `apps/miniprogram/miniprogram/pages/player-market-detail/index.wxml`
- Create: `apps/miniprogram/miniprogram/pages/player-market-detail/index.wxss`
- Create: `apps/miniprogram/miniprogram/pages/player-market-detail/player-market-detail.viewmodel.ts`
- Create: `apps/miniprogram/miniprogram/pages/player-market-detail/player-market-detail.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/app.json`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/detail.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/detail.viewmodel.spec.ts`

**Interfaces:**
- Consumes: Task 1 小程序契约和 Task 6 用户 API。
- Produces: 联赛详情“球员市场”入口、市场/公开申请/公告/我的申请四个视图、球员详情申请/强报/改价/撤回操作。

- [ ] **Step 1: 写失败的 API 与视图模型测试**

覆盖：

- API 路径编码、筛选分页、幂等请求头和版本字段。
- 自由/其他队/本队/25 人/窗口关闭/需补足/归属变化的按钮与文案。
- 所属球队展示编号、队徽、队名和联赛称呼。
- 普通申请显示“最高报价不代表必然获批”。
- 公开时间线包含首次提交、每次改价、撤回和审核原因。
- 强报当季标签显示、下一赛季不显示。
- 长队名和缺失队徽不破坏数据映射。

- [ ] **Step 2: 运行小程序测试并确认失败**

Run: `pnpm --filter @efm/miniprogram test -- player-market.spec.ts player-market.viewmodel.spec.ts player-market-detail.viewmodel.spec.ts`

Expected: FAIL，服务和页面尚不存在。

- [ ] **Step 3: 实现市场服务与页面状态机**

`playerMarketApi` 实现 list/detail/applications/announcements/submit/amend/withdraw。页面状态只使用 `loading | loaded | empty | error`；写操作增加局部 `submitting`，防止重复点击，成功后重新读取详情与列表。

- [ ] **Step 4: 实现市场列表和四个视图**

顶部提供关键字、位置和归属筛选；主体使用页面内分段按钮切换“找球员 / 公开申请 / 成交公告 / 我的申请”，不增加底部 Tab。卡片优先呈现球员、归属、身价和操作资格。

- [ ] **Step 5: 实现球员详情操作**

普通申请和强报使用明确的金额输入与确认层；强报确认必须展示原球队、官方身价和“原球队无需同意”。错误码映射到设计文档中的行动文案；25/25 的按钮跳转 `/pages/team-assets/index?teamId=...&returnTo=player-market`。

- [ ] **Step 6: 接入联赛工作台和页面注册**

在 `WorkspaceModuleKey` 增加 `playerMarket`，放入“交易”组，路由传 `leagueId/seasonId/teamId`。在 `app.json` 注册两个页面；不修改现有底部导航。

- [ ] **Step 7: 运行测试并提交**

Run: `pnpm --filter @efm/miniprogram test && pnpm --filter @efm/miniprogram typecheck`

Expected: PASS。

```bash
git add apps/miniprogram/miniprogram
git commit -m "feat: add miniprogram player market"
```

### Task 9: 球队资产下放交互与市场返回

**Files:**
- Modify: `apps/miniprogram/miniprogram/services/economy.ts`
- Modify: `apps/miniprogram/miniprogram/pages/team-assets/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/team-assets/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/team-assets/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/team-assets/team-assets.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/team-assets/team-assets.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/team-assets/team-assets.template.spec.ts`

**Interfaces:**
- Consumes: Task 1 球队资产/下放契约、Task 6 下放 API、Task 8 `returnTo=player-market` 约定。
- Produces: 现有“球队资产”的下放按钮、不可逆确认和成功返回市场流程。

- [ ] **Step 1: 写失败的球队资产测试**

覆盖：只有 `ACTIVE && canRelease` 球员显示可用“下放”；强报当季球员显示标签；确认文案包含“立即生效、没有收入、不能自动撤销、后续申请失败也不会返回”；提交包含 ownership version、window ID、season ID 和幂等键；失败保留页面，成功刷新人数/工资并按 `returnTo` 返回市场。

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm --filter @efm/miniprogram test -- team-assets.viewmodel.spec.ts team-assets.template.spec.ts`

Expected: FAIL，下放交互尚不存在。

- [ ] **Step 3: 实现 API、视图模型与确认交互**

在 `economyApi` 增加 `releasePlayer(teamId, ownershipId, input, key)`。页面用 `wx.showModal` 二次确认并为当前球员设置 submitting 状态；服务端错误码映射为窗口关闭、版本变化、非现役和权限错误。

- [ ] **Step 4: 实现返回市场与刷新**

下放成功后先刷新球队资产，确保人数和工资已经变化；存在 `returnTo=player-market` 时返回上一页并由市场 `onShow` 刷新，否则停留并提示“下放成功”。

- [ ] **Step 5: 运行测试并提交**

Run: `pnpm --filter @efm/miniprogram test && pnpm --filter @efm/miniprogram typecheck`

Expected: PASS。

```bash
git add apps/miniprogram/miniprogram/services/economy.ts apps/miniprogram/miniprogram/pages/team-assets
git commit -m "feat: add roster release to team assets"
```

### Task 10: 全链路回归、迁移和交付验证

**Files:**
- Verify only: Tasks 1–9 中列出的实现与测试文件

**Interfaces:**
- Consumes: Tasks 1–9 的完整实现。
- Produces: 可迁移、可构建、可在管理后台审核并在小程序操作的交付分支。

- [ ] **Step 1: 验证迁移和生成产物**

Run: `pnpm db:generate && pnpm --filter @efm/api exec prisma migrate status`

Expected: Prisma schema 有效；本地已配置数据库时迁移状态可读。若数据库未启动，只记录环境限制，不伪造迁移成功。

- [ ] **Step 2: 运行领域定向测试**

Run: `pnpm --filter @efm/contracts test && pnpm --filter @efm/api test -- player-market team-player-release team-assets roster-transactions --runInBand && pnpm --filter @efm/admin-web test -- player-market && pnpm --filter @efm/miniprogram test -- player-market team-assets`

Expected: 全部 PASS。

- [ ] **Step 3: 运行整仓验证**

Run: `pnpm verify`

Expected: lint、typecheck、unit、E2E 和 build 全部 PASS。

- [ ] **Step 4: 检查数据库与 UI 验收清单**

手工验证以下闭环并保存结果：

1. 两队申请自由球员，管理员任选一队，另一队“未入选”。
2. 25 人球队先下放，再成功申请；下放球员不会自动返回。
3. 两队强报同一球员，先到者成交，旧归属申请失效，买卖双方账本等额。
4. 官方身价上涨后补价保留顺序；归属变化后必须重新申请。
5. 同赛季再次强报成功，强报标签按当前取得赛季显示。
6. 非负责人、跨联赛用户和窗口关闭场景均显示明确原因。

- [ ] **Step 5: 最终提交**

仅在验证修复产生改动时提交：

```bash
git add <验证修复涉及的明确文件>
git commit -m "test: verify player market workflow"
```
