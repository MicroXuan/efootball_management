# CELL 赛季身价基准与奢侈税试算实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按赛季固定现役球员正式身价，提供 10000 以上部分 2% 的奢侈税建议，并接入现有后台结算展示。

**Architecture:** 新建赛季球队身价基准及明细，预览和确认共用一套纯计算函数。确认事务锁定赛季与球队并复核预览指纹，财务页只读取建议，账本仍由现有结算流程写入。

**Tech Stack:** NestJS、Prisma/MySQL、Zod contracts、React/Ant Design、Jest、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-24-cell-season-valuation-tax.zh-CN.md`

## 全局约束

- 所有代码修改在 `dev`；不另建功能分支。
- 测试命令显式指定本机隔离 `DATABASE_URL`，库名包含 `test` 或 `verify`；不得向共享库造数。
- 涉及数据库结构时，目标环境先核对 `pnpm db:status`，迁移先于新代码部署。
- 不自动执行线下收付款、处罚或人工比分操作。

## 审核重点

- 身价缺失时不能给出貌似确定的 0 元税额；Task 2 校验。
- 队壳价值不能混入球员身价总额；Task 1 校验。
- 预览后转会或改价不能确认旧结果；Task 2 校验。
- 重试确认不能产生第二份基准或财务账目；Task 2、Task 3 校验。
- 已退出或非参赛球队不能被误确认；Task 2 校验。

---

### Task 1：计算规则与契约

**Files:**
- Create: `apps/api/src/league-economy/season-valuation-tax.calculator.ts`
- Test: `apps/api/src/league-economy/season-valuation-tax.calculator.spec.ts`
- Modify: `packages/contracts/src/league-economy.ts`

**Interfaces:** `calculateSeasonValuationTax(values: readonly number[]): { playerValueMinor: number; excessMinor: number; suggestedTaxMinor: number }`；预览响应包含 `seasonId`、逐队汇总、缺失球员数、是否可确认及 `previewHash`。

- [ ] 先写 9999/10000/10001、税额向上取整和不计队壳的失败测试。
- [ ] 运行计算器测试，确认先失败。
- [ ] 实现整数计算及 Zod 契约，运行测试至通过。
- [ ] 运行 contracts 类型检查与契约测试。

### Task 2：赛季基准预览与确认

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_season_valuation_baseline/migration.sql`
- Create: `apps/api/src/league-economy/season-valuation-baseline.service.ts`
- Create: `apps/api/src/league-economy/season-valuation-baseline.service.spec.ts`
- Create: `apps/api/src/league-economy/admin-season-valuation.controller.ts`
- Modify: `apps/api/src/league-economy/league-economy.module.ts`

**Interfaces:** `preview(adminId, leagueId, seasonId)` 只读；`confirm(adminId, leagueId, seasonId, expectedPreviewHash, idempotencyKey)` 在事务中重新计算并保存每队、每球员基准。每支球队每赛季唯一，明细按球员唯一。

- [ ] 写缺失身价、退出球队、跨赛季、并发改价和转会、重复确认的失败测试。
- [ ] 在本机隔离库运行，确认测试先失败。
- [ ] 实现模型、受控迁移、服务与管理员路由；只读取正式身价并仅计算现役归属。
- [ ] 在隔离库运行服务和 API 测试，确认原子回滚与幂等。

### Task 3：后台预览与结算建议

**Files:**
- Create: `apps/admin-web/src/rosters/season-valuation-tax-card.tsx`
- Create: `apps/admin-web/src/rosters/season-valuation-tax-card.spec.tsx`
- Modify: `apps/admin-web/src/rosters/ledger-page.tsx`
- Test: `apps/admin-web/src/rosters/ledger-page.spec.tsx`
- Modify: `apps/api/src/league-economy/team-finance.service.ts`

**Interfaces:** 后台先展示逐队基准预览及问题，再允许确认；财务结算读取已确认建议与现有 `LUXURY_TAX` 账目，显示差额，不自行调用结算写接口。

- [ ] 写预览不完整、确认前数据变化、已确认金额与账目不同的页面测试。
- [ ] 实现后台卡片和财务建议读取；确认后刷新基准，不自动写账。
- [ ] 运行后台测试并核对错误文案与金额格式。

### Task 4：回归与交付

**Files:**
- Test: `apps/api/test/league-economy.e2e-spec.ts`
- Test: `apps/admin-web/src/leagues/teams-page.spec.tsx`
- Test: `apps/admin-web/src/leagues/team-detail-page.spec.tsx`
- Test: `apps/miniprogram/miniprogram/pages/leagues/leagues.viewmodel.spec.ts`
- Test: `apps/miniprogram/miniprogram/pages/team-assets/team-assets.viewmodel.spec.ts`

- [ ] 补 API 端到端测试：预览、确认、实时改价后基准保持、财务建议与账本分离。
- [ ] 使用显式本机验证库运行 API 单测及端到端测试，确认自动清理并复查残留。
- [ ] 运行后台、小程序回归，`pnpm lint`、`pnpm typecheck`、`pnpm build`。
- [ ] 部署前核对目标环境迁移状态；无目标环境权限时明确标记未验收范围。
