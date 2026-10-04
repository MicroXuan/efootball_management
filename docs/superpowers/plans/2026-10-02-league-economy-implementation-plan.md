# 联赛经营闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付中文审计日志、球员身价申报与审核、球队资产、交易记录和赛季财务五个互相连通的联赛经营模块。

**Architecture:** 复用现有 `LeaguePlayerOwnership`、`RosterTransaction` 和 `FinanceLedgerEntry`，新增独立的身价窗口、规则版本、阵容快照、申报批次、当前身价投影与不可变历史。管理后台负责窗口、审核、交易和财务维护；小程序只允许球队拥有者申报本队身价，并为已报名用户提供资产、交易和财务只读视图。所有写操作通过事务、乐观锁、幂等键和审计日志保护。

**Tech Stack:** Node.js 24、TypeScript、NestJS 12、Prisma 7、MySQL、Zod、React 19、Ant Design 6、微信小程序 Native、Jest、Vitest

**Spec:** `docs/superpowers/specs/2026-10-02-player-valuation-design.zh-CN.md`；`docs/superpowers/specs/2026-10-02-efootball-requirements-roadmap.zh-CN.md` 中 R1、R6、R7、R8、R9

## Global Constraints

- 所有面向用户的文案使用中文；技术代码和完整 UUID 只进入详情视图。
- 金额为非负整数，界面以“元”展示；手续费使用向上取整并应用最低金额。
- 身价、工资、成交金额是三个独立概念，不互相覆盖。
- 正式身价按联赛独立，历史不可修改或删除。
- 小程序写入权限仅属于球队拥有者；未报名用户不能读取联赛经营数据。
- 管理员权限必须在 API 层按平台管理员或联赛授权校验。
- 不引入新的运行时依赖；页面继续按路由懒加载。
- 每个任务先观察测试失败，再写最小实现，最后独立提交。

## Review Focus

- 窗口规则在开放期间更新时，旧申报仍引用旧版本，新提交使用新版本；Task 4 覆盖。
- 球员在窗口快照后转会时不会出现在两支球队的申报中，正式身价仍随球员保留；Task 5 覆盖。
- 批次发布与管理员审核并发时只能产生一次身价历史和一次审计记录；Task 6 覆盖。
- 球员无正式身价时交易自动手续费被阻止，不能默认为零；Task 9 覆盖。
- 资产与财务查询中的空数据、历史无赛季流水和不完整身价必须明确标识而不是错误合计；Task 8 与 Task 10 覆盖。

---

### Task 1: 经营领域数据库基础

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261002_player_valuation_economy/migration.sql`
- Modify: `apps/api/src/database/prisma.service.spec.ts`

**Interfaces:**
- Produces: Prisma models `ValuationWindow`、`ValuationWindowRuleVersion`、`ValuationRosterSnapshot`、`ValuationSubmission`、`ValuationSubmissionItem`、`LeaguePlayerValuation`、`PlayerValuationHistory`、`LeagueTransactionFeeRuleVersion`。
- Produces: `LeagueTeam.shellValueMinor`，`RosterEntryStatus.DISAPPEARED | RETIRED`，`FinanceLedgerEntry.seasonId`，交易手续费快照字段。

- [ ] **Step 1: 写失败的 Prisma 委托与枚举测试**

在 `prisma.service.spec.ts` 断言八个新 delegate 可用，并断言生成客户端接受 `DISAPPEARED`、`RETIRED`。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm --filter @efm/api prisma:generate && pnpm --filter @efm/api test -- prisma.service.spec.ts`
Expected: FAIL，新模型 delegate 尚不存在。

- [ ] **Step 3: 增加 schema 与迁移**

窗口状态由 `startsAt`、`endsAt` 和 `closedAt` 按服务器时间计算，不持久化会过期的 `OPEN` 状态；规则和历史使用不可变版本。当前身价投影使用 `(leagueId, footballPlayerId)` 唯一键，所有提交项使用 `(submissionId, snapshotId)` 唯一键。

- [ ] **Step 4: 生成客户端并确认 GREEN**

Run: `pnpm --filter @efm/api prisma:generate && pnpm --filter @efm/api test -- prisma.service.spec.ts && pnpm --filter @efm/api typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

Run: `git add apps/api/prisma apps/api/src/database/prisma.service.spec.ts && git commit -m "feat(db): add league valuation economy models"`

### Task 2: 跨端经营契约

**Files:**
- Create: `packages/contracts/src/player-valuation.ts`
- Create: `packages/contracts/src/league-economy.ts`
- Modify: `packages/contracts/src/league-roster.ts`
- Modify: `packages/contracts/src/admin.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`

**Interfaces:**
- Produces: `ValuationWindowSchema`、`ValuationWorkspaceSchema`、`SaveValuationDraftRequestSchema`、`PublishValuationSubmissionRequestSchema`、`ReviewValuationSubmissionRequestSchema`。
- Produces: `TeamAssetOverviewSchema`、`LeagueTransactionListResponseSchema`、`TeamFinanceSummarySchema`、`CreateManualFinanceEntryRequestSchema`。
- Produces: 审计展示字段 `actorDisplayName`、`leagueName`、`subjectDisplayName`。

- [ ] **Step 1: 写失败的契约解析测试**

覆盖窗口百分比边界、整数金额、完整草稿、待审核批次、身价不完整资产、历史无赛季流水、中文审计展示字段和未知枚举拒绝。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm --filter @efm/contracts test`
Expected: FAIL，新 schema 尚未导出。

- [ ] **Step 3: 实现 Zod schema 与类型导出**

百分比统一使用基点整数 `0..10000`；金额使用现有 `MoneyMinorSchema` 命名约定但界面仍显示整数元，不改变已有 API 的金额单位。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `pnpm --filter @efm/contracts test && pnpm --filter @efm/contracts typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

Run: `git add packages/contracts && git commit -m "feat(contracts): define league economy interfaces"`

### Task 3: 中文业务审计日志

**Files:**
- Create: `apps/api/src/admin/audit-log.service.spec.ts`
- Modify: `apps/api/src/admin/audit-log.service.ts`
- Create: `apps/admin-web/src/platform/audit-presentation.ts`
- Create: `apps/admin-web/src/platform/audit-presentation.spec.ts`
- Modify: `apps/admin-web/src/platform/audit-page.tsx`
- Modify: `apps/admin-web/src/platform/audit-page.spec.tsx`
- Modify: `apps/admin-web/src/styles.css`

**Interfaces:**
- Consumes: Task 2 的 `AuditLog` 展示字段。
- Produces: `presentAuditLog(log: AuditLog)` 与六列只读审计页面。

- [ ] **Step 1: 写失败的 API 与页面测试**

断言服务返回操作人、联赛和目标赛季名称；页面显示“时间、操作人、具体操作、影响对象、结果、查看详情”，示例摘要为“平台管理员‘小宣’将 CELL 联赛的当前赛季设置为‘S2’”。未知动作显示“其他后台操作”，详情保留动作码、ID、参数和版本。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm --filter @efm/api test -- audit-log.service.spec.ts && pnpm --filter @efm/admin-web test -- audit-page.spec.tsx audit-presentation.spec.ts`
Expected: FAIL，现有页面仍直接显示英文动作码。

- [ ] **Step 3: 实现查询增强、纯映射与详情抽屉**

API 只补充展示上下文，不修改历史 metadata；前端覆盖现有动作和本计划新增的身价、财务动作。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `pnpm --filter @efm/api test -- audit-log.service.spec.ts && pnpm --filter @efm/admin-web test -- audit-page.spec.tsx audit-presentation.spec.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

Run: `git add apps/api/src/admin/audit-log.service* apps/admin-web/src/platform apps/admin-web/src/styles.css && git commit -m "feat(admin): present audit logs as Chinese business events"`

### Task 4: 身价窗口与规则版本 API

**Files:**
- Create: `apps/api/src/player-valuations/valuation-windows.service.ts`
- Create: `apps/api/src/player-valuations/valuation-windows.service.spec.ts`
- Create: `apps/api/src/player-valuations/admin-valuation-windows.controller.ts`
- Create: `apps/api/src/player-valuations/player-valuations.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces: `ValuationWindowsService.create`、`update`、`listForSeason`、`getEffectiveRule`。
- Produces: `/v1/admin/seasons/:seasonId/valuation-windows` 和 `/v1/admin/valuation-windows/:windowId`。

- [ ] **Step 1: 写失败的窗口服务测试**

覆盖多窗口、开始结束时间、最低高于最高拒绝、基点范围、联赛权限、规则修改生成新版本、旧提交引用旧版本和关闭后禁止重新开放。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm --filter @efm/api test -- valuation-windows.service.spec.ts`
Expected: FAIL，服务尚不存在。

- [ ] **Step 3: 实现服务、控制器与模块注册**

所有写请求要求 `Idempotency-Key` 和 `expectedVersion`；动作写入 `AuditLogService`。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `pnpm --filter @efm/api test -- valuation-windows.service.spec.ts && pnpm --filter @efm/api typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

Run: `git add apps/api/src/player-valuations apps/api/src/app.module.ts && git commit -m "feat(api): manage valuation windows and rule versions"`

### Task 5: 阵容快照与球队身价工作区

**Files:**
- Create: `apps/api/src/player-valuations/valuation-snapshots.service.ts`
- Create: `apps/api/src/player-valuations/valuation-snapshots.service.spec.ts`
- Create: `apps/api/src/player-valuations/my-valuations.controller.ts`
- Modify: `apps/api/src/player-valuations/player-valuations.module.ts`

**Interfaces:**
- Consumes: `ValuationWindowsService.getEffectiveRule`。
- Produces: `ValuationSnapshotsService.ensureWindowSnapshot(windowId)`。
- Produces: `GET /v1/me/league-teams/:teamId/valuations/workspace`。

- [ ] **Step 1: 写失败的快照与权限测试**

断言开放窗口首次访问一次性锁定 ACTIVE 阵容；重复访问幂等；后续转入转出不改变快照；非球队拥有者和未报名用户返回 403；转入球员当前身价仍按联赛投影保留。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm --filter @efm/api test -- valuation-snapshots.service.spec.ts`
Expected: FAIL，快照服务尚不存在。

- [ ] **Step 3: 实现懒创建快照与工作区查询**

没有后台调度器；窗口首次被授权访问时在事务内 `ensureWindowSnapshot`，唯一索引处理并发初始化。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `pnpm --filter @efm/api test -- valuation-snapshots.service.spec.ts && pnpm --filter @efm/api typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

Run: `git add apps/api/src/player-valuations && git commit -m "feat(api): snapshot valuation rosters and expose owner workspace"`

### Task 6: 草稿、原子发布与审核

**Files:**
- Create: `apps/api/src/player-valuations/valuation-calculator.ts`
- Create: `apps/api/src/player-valuations/valuation-calculator.spec.ts`
- Create: `apps/api/src/player-valuations/valuation-submissions.service.ts`
- Create: `apps/api/src/player-valuations/valuation-submissions.service.spec.ts`
- Create: `apps/api/src/player-valuations/admin-valuation-reviews.controller.ts`
- Modify: `apps/api/src/player-valuations/my-valuations.controller.ts`
- Modify: `apps/api/src/player-valuations/player-valuations.module.ts`

**Interfaces:**
- Produces: `valuationRange(baseValue, rule)`、`saveDraft`、`publish`、`approve`、`reject`。
- Produces: `PATCH /v1/me/league-teams/:teamId/valuations/draft`、`POST /v1/me/league-teams/:teamId/valuations/publish`。
- Produces: `GET /v1/admin/leagues/:leagueId/valuation-submissions`、`POST /v1/admin/valuation-submissions/:submissionId/approve`、`POST /v1/admin/valuation-submissions/:submissionId/reject`。

- [ ] **Step 1: 写失败的计算与状态机测试**

覆盖首次身价、最低最高值、涨跌边界取整、未修改项、缺失首次身价、全合规自动生效、任一超限整批待审、关闭后禁止发布但允许审核、驳回后重提、审核原因必填。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm --filter @efm/api test -- valuation-calculator.spec.ts valuation-submissions.service.spec.ts`
Expected: FAIL，计算器和提交服务尚不存在。

- [ ] **Step 3: 实现事务状态机**

发布/审核同时锁定批次与当前身价投影；历史插入、投影更新和审计写入同一事务。版本冲突返回 409，重复幂等键返回原结果。

- [ ] **Step 4: 运行并发与幂等测试**

Run: `pnpm --filter @efm/api test -- valuation-calculator.spec.ts valuation-submissions.service.spec.ts`
Expected: PASS，重复发布/审核只产生一组历史和审计记录。

- [ ] **Step 5: 提交**

Run: `git add apps/api/src/player-valuations && git commit -m "feat(api): publish and review valuation submissions atomically"`

### Task 7: 球员状态与队壳价值维护

**Files:**
- Modify: `packages/contracts/src/league-team.ts`
- Modify: `packages/contracts/src/league-roster.ts`
- Modify: `apps/api/src/league-teams/league-teams.service.ts`
- Modify: `apps/api/src/league-teams/league-teams.service.spec.ts`
- Modify: `apps/api/src/league-rosters/roster-transactions.service.ts`
- Modify: `apps/api/src/league-rosters/roster-transactions.service.spec.ts`
- Modify: `apps/admin-web/src/leagues/team-detail-page.tsx`
- Modify: `apps/admin-web/src/leagues/team-detail-page.spec.tsx`
- Modify: `apps/admin-web/src/rosters/roster-page.tsx`
- Modify: `apps/admin-web/src/rosters/roster-page.spec.tsx`

**Interfaces:**
- Produces: 管理员更新 `shellValueMinor`、`ACTIVE | DISAPPEARED | RETIRED` 的请求。
- Consumes: Task 1 新字段和枚举。

- [ ] **Step 1: 写失败的服务与页面测试**

断言队壳价值可由授权管理员更新；球员可标记消失/退役和恢复一线；状态变更不删除身价历史；页面全部显示中文状态。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm --filter @efm/api test -- league-teams.service.spec.ts roster-transactions.service.spec.ts && pnpm --filter @efm/admin-web test -- team-detail-page.spec.tsx roster-page.spec.tsx`
Expected: FAIL，新字段和动作尚不可用。

- [ ] **Step 3: 实现 API、审计与后台控件**

状态更新要求原因、版本号和幂等键；已转会/已解约记录不能直接改为一线。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `pnpm --filter @efm/api test -- league-teams.service.spec.ts roster-transactions.service.spec.ts && pnpm --filter @efm/admin-web test -- team-detail-page.spec.tsx roster-page.spec.tsx`
Expected: PASS。

- [ ] **Step 5: 提交**

Run: `git add packages/contracts apps/api/src/league-teams apps/api/src/league-rosters apps/admin-web/src/leagues apps/admin-web/src/rosters && git commit -m "feat: manage shell value and roster lifecycle states"`

### Task 8: 球队资产查询

**Files:**
- Create: `apps/api/src/league-economy/team-assets.service.ts`
- Create: `apps/api/src/league-economy/team-assets.service.spec.ts`
- Create: `apps/api/src/league-economy/my-team-assets.controller.ts`
- Create: `apps/api/src/league-economy/league-economy.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: 当前身价投影、阵容状态、队壳价值、工资和赛季报名。
- Produces: `GET /v1/me/league-teams/:teamId/assets` 返回球队身份、分组、一线/消失/退役球员、工资、身价完整度和总资产。
- Produces: `GET /v1/me/leagues/:leagueId/player-valuations/:playerId/history` 返回参赛用户可见的生效时间与身价趋势。

- [ ] **Step 1: 写失败的资产聚合测试**

覆盖一线人数、三状态分组、工资合计、仅 ACTIVE 计身价、未申报数量、数据不完整、队壳与球员身价独立、非拥有者禁止读取。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm --filter @efm/api test -- team-assets.service.spec.ts`
Expected: FAIL，资产服务尚不存在。

- [ ] **Step 3: 实现聚合查询与控制器**

查询同时返回球员姓名、入队时间、位置、国籍、俱乐部、年龄、身高、惯用脚、AT、工资和身价；缺失字段返回 `null`，不伪造文案。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `pnpm --filter @efm/api test -- team-assets.service.spec.ts && pnpm --filter @efm/api typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

Run: `git add apps/api/src/league-economy apps/api/src/app.module.ts && git commit -m "feat(api): expose complete team asset overview"`

### Task 9: 交易身价快照与自动手续费

**Files:**
- Create: `apps/api/src/league-economy/transaction-fees.service.ts`
- Create: `apps/api/src/league-economy/transaction-fees.service.spec.ts`
- Create: `apps/api/src/league-economy/admin-transaction-fees.controller.ts`
- Create: `apps/api/src/league-economy/my-league-transactions.controller.ts`
- Modify: `apps/api/src/league-rosters/roster-transactions.service.ts`
- Modify: `apps/api/src/league-rosters/roster-transactions.service.spec.ts`
- Modify: `apps/api/src/league-rosters/admin-roster-queries.service.ts`
- Modify: `apps/api/src/league-rosters/admin-rosters.controller.ts`
- Modify: `apps/api/src/league-economy/league-economy.module.ts`
- Modify: `apps/api/src/league-rosters/league-rosters.module.ts`

**Interfaces:**
- Produces: `TransactionFeesService.quote(leagueId, playerId, at)`。
- Produces: `TransactionFeesService.createRuleVersion(adminId, leagueId, input)`。
- Produces: `GET /v1/me/leagues/:leagueId/transactions`、`GET /v1/admin/leagues/:leagueId/transactions`。
- Produces: `GET|POST /v1/admin/leagues/:leagueId/transaction-fee-rules`。

- [ ] **Step 1: 写失败的手续费与交易测试**

断言 `max(ceil(valuation * rate), minimumFee)`；交易保存身价、费率规则版本和手续费快照；后续规则/身价变化不影响历史；无身价阻止自动手续费；转会后身价投影仍属于同一联赛球员。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm --filter @efm/api test -- transaction-fees.service.spec.ts roster-transactions.service.spec.ts`
Expected: FAIL，交易尚未读取正式身价。

- [ ] **Step 3: 实现规则版本、交易集成和列表查询**

手续费支出与现有成交金额流水分开记录，均关联同一 `RosterTransaction`；人工手续费绕过只允许平台管理员并要求原因。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `pnpm --filter @efm/api test -- transaction-fees.service.spec.ts roster-transactions.service.spec.ts && pnpm --filter @efm/api typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

Run: `git add apps/api/src/league-economy apps/api/src/league-rosters && git commit -m "feat(api): snapshot valuation fees in roster transactions"`

### Task 10: 财务人工项目与赛季汇总

**Files:**
- Create: `apps/api/src/league-economy/team-finance.service.ts`
- Create: `apps/api/src/league-economy/team-finance.service.spec.ts`
- Create: `apps/api/src/league-economy/admin-finance.controller.ts`
- Modify: `apps/api/src/league-economy/my-team-assets.controller.ts`
- Modify: `apps/api/src/league-economy/league-economy.module.ts`
- Modify: `apps/admin-web/src/rosters/ledger-page.tsx`
- Modify: `apps/admin-web/src/rosters/ledger-page.spec.tsx`

**Interfaces:**
- Produces: `TeamFinanceService.createManualEntry`、`getSeasonSummary`。
- Produces: 奢侈税、休赛费用、未完赛处罚、拍卖、新秀、分期和其他调整类型。
- Produces: `POST /v1/admin/leagues/:leagueId/finance-entries`、`GET /v1/me/league-teams/:teamId/finance?seasonId=:seasonId`。

- [ ] **Step 1: 写失败的财务测试**

断言管理员按球队/赛季新增收入或支出；所有项目汇总为实时总额和逐项明细；历史 `seasonId=null` 流水进入“历史未归档”分组；写入后不能修改删除；越权管理员被拒绝。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm --filter @efm/api test -- team-finance.service.spec.ts && pnpm --filter @efm/admin-web test -- ledger-page.spec.tsx`
Expected: FAIL，现有页面只支持技术流水查看。

- [ ] **Step 3: 实现财务服务、控制器和后台录入抽屉**

页面用中文分类和“实时数据，非最终结算”提示，并提供 Task 9 手续费规则版本配置；新增操作要求原因和幂等键。

- [ ] **Step 4: 运行测试并确认 GREEN**

Run: `pnpm --filter @efm/api test -- team-finance.service.spec.ts && pnpm --filter @efm/admin-web test -- ledger-page.spec.tsx`
Expected: PASS。

- [ ] **Step 5: 提交**

Run: `git add apps/api/src/league-economy apps/admin-web/src/rosters/ledger-page* && git commit -m "feat: manage season finance adjustments and summaries"`

### Task 11: 管理后台身价窗口与审核台

**Files:**
- Create: `apps/admin-web/src/valuations/valuation-windows-page.tsx`
- Create: `apps/admin-web/src/valuations/valuation-windows-page.spec.tsx`
- Create: `apps/admin-web/src/valuations/valuation-reviews-page.tsx`
- Create: `apps/admin-web/src/valuations/valuation-reviews-page.spec.tsx`
- Modify: `apps/admin-web/src/leagues/league-shell.tsx`
- Modify: `apps/admin-web/src/app.tsx`
- Modify: `apps/admin-web/src/design-system/icons.tsx`
- Modify: `apps/admin-web/src/styles.css`

**Interfaces:**
- Consumes: Task 4 与 Task 6 的后台 endpoints。
- Produces: `/leagues/:leagueId/valuation-windows` 与 `/leagues/:leagueId/valuation-reviews` 懒加载页面。

- [ ] **Step 1: 写失败的页面测试**

窗口页覆盖创建、动态修改、规则版本和中文状态；审核页覆盖联赛/窗口/球队/状态筛选、逐球员差异、整批通过/驳回和原因必填；不存在逐球员编辑入口。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm --filter @efm/admin-web test -- valuation-windows-page.spec.tsx valuation-reviews-page.spec.tsx`
Expected: FAIL，页面尚不存在。

- [ ] **Step 3: 实现页面、路由与响应式样式**

沿用浅色数据工作区、圆角卡片和明确边界；表格在窄屏使用横向滚动，不缩小到不可读字号。

- [ ] **Step 4: 运行测试与构建**

Run: `pnpm --filter @efm/admin-web test && pnpm --filter @efm/admin-web typecheck && pnpm --filter @efm/admin-web build`
Expected: PASS。

- [ ] **Step 5: 提交**

Run: `git add apps/admin-web/src && git commit -m "feat(admin): add valuation windows and review desk"`

### Task 12: 小程序身价申报

**Files:**
- Create: `apps/miniprogram/miniprogram/pages/valuation-manage/index.ts`
- Create: `apps/miniprogram/miniprogram/pages/valuation-manage/index.wxml`
- Create: `apps/miniprogram/miniprogram/pages/valuation-manage/index.wxss`
- Create: `apps/miniprogram/miniprogram/pages/valuation-manage/index.json`
- Create: `apps/miniprogram/miniprogram/pages/valuation-manage/valuation.viewmodel.ts`
- Create: `apps/miniprogram/miniprogram/pages/valuation-manage/valuation.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/app.json`
- Modify: `apps/miniprogram/miniprogram/pages/league-team-detail/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/league-team-detail/index.ts`

**Interfaces:**
- Consumes: Task 5 与 Task 6 的球队拥有者 endpoints。
- Produces: 暗色原生身价管理页面。

- [ ] **Step 1: 写失败的 viewmodel 与页面测试**

覆盖倒计时文案、当前/允许/草稿身价、首次必填、修改/沿用/超限数量、数据不完整、待审核、驳回后重提和关闭只读状态。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm --filter @efm/miniprogram test -- valuation.viewmodel.spec.ts`
Expected: FAIL，页面和 viewmodel 尚不存在。

- [ ] **Step 3: 实现草稿、确认摘要与发布交互**

输入使用整数数字键盘；先本地校验全局最小/最大值，最终规则仍由 API 判定；所有提交按钮具备 loading 防重复状态。

- [ ] **Step 4: 运行测试与类型检查**

Run: `pnpm --filter @efm/miniprogram test && pnpm --filter @efm/miniprogram typecheck`
Expected: PASS。

- [ ] **Step 5: 提交**

Run: `git add apps/miniprogram/miniprogram && git commit -m "feat(miniprogram): add roster valuation submission"`

### Task 13: 小程序资产、交易与财务视图

**Files:**
- Create: `apps/miniprogram/miniprogram/pages/team-assets/*`
- Create: `apps/miniprogram/miniprogram/pages/league-transactions/*`
- Create: `apps/miniprogram/miniprogram/pages/team-finance/*`
- Modify: `apps/miniprogram/miniprogram/app.json`
- Modify: `apps/miniprogram/miniprogram/pages/league-team-detail/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/league-team-detail/index.wxss`

**Interfaces:**
- Consumes: Task 8、Task 9、Task 10 的小程序只读 endpoints。
- Produces: 联赛球队工作台中的资产表、交易记录和财务入口。

- [ ] **Step 1: 写失败的三个 viewmodel 测试**

资产覆盖编号-球队名-微信名、头像、分组、一线人数、队壳、工资、身价完整度和三状态球员；交易覆盖买卖双方、原/新价值、手续费和备注；财务覆盖八类金额、实时总额、非最终提示和结算明细。

- [ ] **Step 2: 运行测试并确认 RED**

Run: `pnpm --filter @efm/miniprogram test -- team-assets league-transactions team-finance`
Expected: FAIL，新页面尚不存在。

- [ ] **Step 3: 实现三个原生暗色页面与工作台入口**

大列表使用分页/增量加载；趋势仅显示正式身价的时间和值，不暴露审核信息；网络失败提供中文重试入口。

- [ ] **Step 4: 运行小程序完整验证**

Run: `pnpm --filter @efm/miniprogram test && pnpm --filter @efm/miniprogram typecheck && pnpm --filter @efm/miniprogram build`
Expected: PASS。

- [ ] **Step 5: 提交**

Run: `git add apps/miniprogram/miniprogram && git commit -m "feat(miniprogram): add league asset transaction and finance views"`

### Task 14: 端到端权限与经营闭环

**Files:**
- Create: `apps/api/test/player-valuations.e2e-spec.ts`
- Create: `apps/api/test/league-economy.e2e-spec.ts`
- Modify: `apps/api/prisma/seed.ts`
- Modify: `docs/development/local-development.md`

**Interfaces:**
- Consumes: Tasks 1–13 的公开接口。
- Produces: 可重复的本地演示数据和端到端验收证据。

- [ ] **Step 1: 写失败的端到端场景**

场景包含管理员开窗、球队拥有者保存草稿、合规自动生效、超限待审、管理员通过、资产更新、转会保留身价、手续费入账、人工财务项目、参赛者只读和未报名用户 403。

- [ ] **Step 2: 运行端到端测试并确认 RED**

Run: `DATABASE_URL=mysql://efm:efm_local@127.0.0.1:3307/efootball_management pnpm --filter @efm/api test:e2e -- player-valuations.e2e-spec.ts league-economy.e2e-spec.ts`
Expected: FAIL，种子和闭环尚未完整连接。

- [ ] **Step 3: 补齐种子与开发说明**

种子创建一个开放窗口、完整身价球队、含超限草稿球队、手续费规则和财务明细；文档说明启动、迁移、种子和入口账号。

- [ ] **Step 4: 运行全量验证**

Run: `DATABASE_URL=mysql://efm:efm_local@127.0.0.1:3307/efootball_management pnpm verify`
Expected: lint、typecheck、unit、e2e、build 全部 PASS。

- [ ] **Step 5: 提交**

Run: `git add apps/api/test apps/api/prisma/seed.ts docs/development/local-development.md && git commit -m "test: verify league economy end to end"`

## Self-review

- R1 由 Task 3 覆盖；R6 由 Tasks 7、8、13 覆盖；R7 由 Tasks 9、13 覆盖；R8 由 Tasks 10、13 覆盖；R9 全部规则由 Tasks 1、2、4–6、9、11、12、14 覆盖。
- 数据依赖顺序固定为数据库 → 契约 → 领域 API → 后台/小程序 → E2E；所有跨任务接口名称一致。
- 身价事实历史与当前投影分离；财务流水继续不可变；现有工资和转会流程只做定向扩展。
- 五项 Review Focus 都在所属任务列出明确测试。
- 计划不包含杯赛、收藏、积分榜或球员目录筛选，这些独立子系统保留在总路线图后续批次。
