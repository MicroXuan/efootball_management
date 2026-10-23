# Player Pack Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让球员包筛选读取发布时维护的准确摘要，不再在每次打开筛选框时统计全部球员卡历史版本。

**Architecture:** 每次发布仅为本批受影响的旧包和新包写一个版本化摘要；包列表在固定发布序号下读取各包最近摘要。迁移期使用投影进度和原动态查询回退，保证旧实例发布或回填未完成时仍返回正确结果。

**Tech Stack:** NestJS、Prisma 7、MySQL 8、React/Ant Design、原生微信小程序、Jest、Vitest。

**Spec:** [球员包筛选摘要设计](../specs/2026-10-23-player-pack-summary-design.zh-CN.md)

## Global Constraints

- 保留 `/v1/card-packs` 的字段、排序、分页游标与 `releaseSequence`；摘要中的 `cardCount` 等于该发布快照下最新版为 `ACTIVE` 且仍属于此包的卡数。
- 空包写零计数墓碑；同名不同 ID 的包分别保留；历史版本不重复计数。
- 发布和摘要同一事务提交；发布序号与投影计算串行化。投影进度落后时调用现有动态 SQL，不能返回部分摘要。
- 测试与基准的每条 API 命令显式指定本机 `test/verify` 数据库；不得把项目 `.env` 的 CloudBase 数据库当测试库。
- 目标环境先只读 `pnpm db:status`，迁移与回填在放行新读路径前完成；复测后台球队入口、小程序“我的联赛”和球员库。

## Review Focus

1. 卡片从包 A 移到包 B：A 减一或变空，B 加一；Task 2 的发布集成测试覆盖。
2. 旧 `ACTIVE` 版之后发布 `INACTIVE`：不能回退计数；Task 2 测试覆盖。
3. 发布时回滚、重试或两个管理员同时发布：摘要与卡片一致，进度不跳过未投影的发布；Task 2 测试覆盖。
4. 回填历史游标：指定旧发布序号时包数、代表版本和排序与原查询一致；Task 3 测试覆盖。
5. 超过 100 个包及翻页中有新发布：两个筛选框都获得完整且不混合的包选项；Task 4 测试覆盖。

---

### Task 1: 摘要表与查询计算器

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_catalog_pack_summary/migration.sql`
- Create: `apps/api/src/player-catalog/catalog-pack-summary.repository.ts`
- Create: `apps/api/src/player-catalog/catalog-pack-summary.repository.spec.ts`

**Interfaces:**
- `CatalogPackSummaryVersion`: `(cardPackId, releaseSequence)` 主键；`cardCount` 非负整数；`newestVersionId` 可空。对 `CardPack` 和 `CatalogRelease` 使用级联删除，代表版本 ID 不设外键，以兼容现有测试清理顺序。
- `CatalogPackSummaryProjectionState`: `id = 1` 单行，`projectedThroughSequence`、`updatedAt`。迁移插入序号 0 初始行。
- `recomputeAffectedPacks(tx: Prisma.TransactionClient, releaseSequence: number, packIds: readonly string[]): Promise<void>`：批量查询这些包的最新有效卡及代表版本，给全部 `packIds` upsert 摘要；查不到卡写零计数。

- [ ] 写失败测试：同卡两版本只计一次、最新 `INACTIVE` 不计、同名不同 ID 包分开、空包零计数、代表版本按现有 `publishedAt DESC / overallRating DESC / playerCardId ASC` 选取。
- [ ] 用显式隔离 `DATABASE_URL` 跑目标测试，确认失败。
- [ ] 新增模型、迁移和计算器；在隔离库先 `pnpm db:status` 再 `pnpm db:migrate`，测试通过后提交。

### Task 2: 发布事务维护受影响包

**Files:**
- Modify: `apps/api/src/player-import/player-import-publication.types.ts`
- Modify: `apps/api/src/player-import/player-import-publication-plan.ts`
- Modify: `apps/api/src/player-import/player-import-publication.repository.ts`
- Modify: `apps/api/src/player-import/player-import.publisher.ts`
- Modify: `apps/api/src/player-import/player-import.publisher.spec.ts`

**Interfaces:**
- `PlayerImportPublicationPlan.affectedPackIds: string[]`：本批每张变化卡的发布前旧包 ID 与发布后新包 ID 去重集合；由计划生成器使用加载到的旧卡状态产生。
- `executePlayerImportPublication()` 在批次锁后、首次普通读取前，对投影进度单行执行 `SELECT ... FOR UPDATE`；版本写入后调用 Task 1 的 `recomputeAffectedPacks()`；确认进度与已提交发布之间无未投影间隔后，在同一事务推进进度。重复发布不重复写摘要。

- [ ] 写失败集成测试：新增、更新、换包、下架、空包、连续批次、并发发布、事务故障回滚及幂等重试，逐次比较摘要与原动态查询结果。
- [ ] 显式本机 verify `DATABASE_URL` 跑目标测试，确认失败。
- [ ] 接入发布计划和事务；测试通过并检查单批发布耗时没有接近现有 60 秒超时，再提交。

### Task 3: 历史回填与进度核对

**Files:**
- Create: `apps/api/src/player-catalog/backfill-catalog-pack-summaries.cli.ts`
- Modify: `apps/api/package.json`
- Create: `apps/api/src/player-catalog/backfill-catalog-pack-summaries.spec.ts`

**Interfaces:**
- CLI 支持 `--dry-run`、`--after-sequence` 和每次处理发布数限制；按发布序号升序，从当次变更卡的新包和之前最近版本的旧包找出受影响包，调用 Task 1 计算器；可中断续跑、重复执行不改变结果。
- 每个发布序号写入后，对其全部非空包的数量、代表卡和排序与原动态查询做核对；全部通过才推进 `projectedThroughSequence`。输出已处理、未处理和差异数量。

- [ ] 写失败测试：旧发布中的换包、下架、没有受影响包的发布、续跑与幂等回填。
- [ ] 显式本机 verify `DATABASE_URL` 跑测试，确认失败；只对该隔离库跑回填 dry run、实际回填并复查。
- [ ] 提交回填工具及结果说明；生产回填须在发布暂停、目标确认之后按受控流程执行。

### Task 4: 包列表读取摘要、两个筛选框完整翻页

**Files:**
- Modify: `apps/api/src/player-catalog/player-catalog-read.repository.ts`
- Modify: `apps/api/src/player-catalog/player-catalog.service.ts`
- Modify: `apps/api/src/player-catalog/player-catalog.service.spec.ts`
- Modify: `apps/api/test/player-catalog.e2e-spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/players/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/players/players.page.spec.ts`
- Modify: `apps/admin-web/src/rosters/acquire-player-drawer.tsx`
- Modify: `apps/admin-web/src/rosters/acquire-player-drawer.spec.tsx`

**Interfaces:**
- `listPacksAtRelease()`：若请求发布序号 `<= projectedThroughSequence`，从 `card_packs` 出发按 `(card_pack_id, release_sequence)` 定位最近摘要，过滤零计数，关联 `newestVersionId` 排序及分页；否则调用保留的 `listPacksLegacyAtRelease()`。两条路径返回相同结构。
- 两个客户端按 `nextCursor` 读取全部包选项，保持首次返回的固定发布序号；请求失败维持现有错误提示与重试行为。

- [ ] 写失败测试：新旧读取路径结果一致；固定游标跨发布不漏/重包；旧格式包游标仍可用；客户端超过 100 个包也展示完整选项且小程序显示准确 `N 张`。
- [ ] 显式 verify `DATABASE_URL` 跑 API 目标测试，运行两个客户端测试，确认失败。
- [ ] 实现读路径与选项翻页；API、后台和小程序测试通过后提交。

### Task 5: 5 万卡基准与受控上线验收

**Files:**
- Modify: `apps/api/scripts/benchmark-player-catalog.ts`
- Create: `docs/performance/2026-10-23-player-pack-summary-50k.md`

**Interfaces:**
- 基准在至少 50,000 张卡、100,000 条版本、500 个包和多次发布下比较原动态包查询与摘要查询；每项预热后至少测 100 次，记录 p50/p95、`EXPLAIN`、返回包数和发布额外耗时。脚本只接受显式本机 `test/verify` 库，结束后按精确 ID 清理并复查。

- [ ] 在隔离库跑基准；本机包列表 p95 目标低于 100 毫秒，若不达标先定位索引和 SQL 再交付。
- [ ] 跑 API 单测、球员库/联赛球队 e2e、后台球队入口与购买弹窗、小程序球员库与“我的联赛”，以及 lint/typecheck/build；修复回归。
- [ ] 目标环境只读核对 `pnpm db:status`。暂停发布，迁移、回填、部署全部写摘要的 API 实例，再启用摘要读取；核对真实接口和前端解析。若无部署权限，明确记录未验收范围，不声称线上已生效。
