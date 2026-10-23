# PESDATA Daily Player Catalog Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 每日可信扫描 PESDATA 卡片编号，形成新增、更新、确认下架的差异报告，并由管理员一键发布有效变更。

**Architecture:** 新增独立 `RECONCILE` 任务类型，保留现有 `SAMPLE/FULL/INCREMENTAL` 流程。两遍列表扫描分块写暂存表，并在数据库内验证完整性和集合一致；详情复核与本地正式卡做差异；待确认与失败项不发布。沿用导入批次、版本发布与同步任务租约，后台展示报告和发布结果。

**Tech Stack:** NestJS、TypeScript、Prisma 7、MySQL、Jest、React 管理后台。

**Spec:** [PESDATA 球员库每日对账与受控发布设计](../specs/2026-10-23-daily-player-catalog-reconciliation-design.zh-CN.md)

## Global Constraints

- 卡片身份是 `sourceId + PESDATA playerId`；`base_pes_id` 只用于现实球员关联。重复卡不创建新卡或新版本；重新出现的旧卡沿用原 `player_cards.id`。
- `REMOVAL_CANDIDATE`、`FAILED` 绝不进入一键发布；双遍完整可信扫描后，明确 `is_del=1` 或连续两个相邻业务日期可信扫描都缺失，才可 `REMOVAL_CONFIRMED`。同日手动重跑不计第二天；详情仍可正常读到的卡不得下架。
- 下架只发布 `INACTIVE` 新版本，不物理删除卡、历史版本、持有、收藏及交易记录。
- 管理员看差异报告后一键发布有效变更；不自动发布；任务完成、待发布、部分生效与完全生效状态必须区分。
- 偏移分页双遍扫描不构成来源原子快照；用户确认每日核对新增与下架，现有卡资料与图片分批复核。界面不能宣称“实时绝对一致”。
- 每日调度时间和时区由平台管理员在后台设置，默认关闭；业务日期由计划开始时间在管理员设置的时区确定，跨午夜扫描仍计入该日期。
- 全部 API 单测/e2e/模拟造数必须在命令上显式指定本机隔离 `DATABASE_URL`，库名含 `test` 或 `verify`；共享/正式库不运行测试、seed、开发态迁移或清理。
- 目标环境先 `pnpm db:status`，先迁移再部署 API/后台；复测联赛球队既有入口、小程序“我的联赛”及持有、收藏、交易历史。

## Review Focus

1. 扫描中途新增、删除、重排或重复 ID：报告不可信且不产生确认下架。Task 1、2 覆盖。
2. 404、空详情、超时、协议变更：首日只能待确认；相邻两日均有可信完整双遍扫描且仍缺失才可下架。Task 3 覆盖。
3. 二次发布、部分批次失败、任务恢复：不重复创建卡或版本，报告准确显示未生效数。Task 4、5 覆盖。
4. 图片 URL 不变但图片内容变化、摘要不变但详情改变：定期详情复核及界面“最近复核时间”准确。Task 3、5 覆盖。
5. 50,000 张卡、扫描跨午夜和跨日暂存增长：分块扫描、以计划开始日归属、数据库集合比较及受控保留策略内存有界。Task 2、3、6 覆盖。

## 运行与发布流程

```mermaid
flowchart TD
  A[每日/手动创建任务] --> B[列表扫描第 1 遍]
  B --> C[列表扫描第 2 遍]
  C --> D{总数、唯一 ID、集合一致?}
  D -- 否 --> E[标记不可信；不判下架]
  D -- 是 --> F[新增/更新详情 + 滚动复核]
  F --> G[缺失卡单独确认]
  G --> H[差异报告]
  H --> I[管理员一键发布有效项]
  I --> J[分批发布版本]
  J --> K[只读核对公开卡片集合]
```

### Task 1: 双遍扫描的持久化模型与完整性判定

**Files:**
- Modify: `apps/api/prisma/schema.prisma` 的 `ExternalSyncRun`、`PlayerCard`；新增扫描页、扫描编号、差异项和调度设置模型
- Create: `apps/api/prisma/migrations/<执行时生成时间戳>_pesdata_player_scan/migration.sql`
- Create: `apps/api/src/pesdata-sync/pesdata-player-scan.repository.ts`
- Create: `apps/api/src/pesdata-sync/pesdata-player-scan.repository.spec.ts`

**Interfaces:**
- 新增 `PlayerCatalogScanEntry(runId, pass, externalId, summaryChecksum)`，唯一键 `(runId, pass, externalId)`；新增每遍页报告表 `PlayerCatalogScanPage(runId, pass, offset, reportedTotal, returnedCount, idChecksum)`，唯一键 `(runId, pass, offset)`。`PlayerCatalogReconciliationItem` 保存变更分类、证据、规范化详情及发布状态。`PlayerCatalogSyncSchedule` 保存后台设置。`PlayerCard` 增加已发布来源摘要及最近详情复核时间。
- `PesdataPlayerScanRepository.recordPage(runId, pass, offset, reportedTotal, summaries)` 事务写入页报告与唯一 ID；若页偏移重复、页内/跨页 ID 重复或总数跳变，返回不可信原因而非跳过重复。
- `verifyPass(runId, pass)` 核对页连续、实际行数、唯一 ID 数与来源总数；`comparePasses(runId)` 在 MySQL 内核对 pass 1 和 2 的双向集合差及总数，返回 `{ trusted: boolean; reason?: string; sourceTotal: number }`。

- [ ] 写失败测试：正常 50/20/末页分页、重复 ID、漏页、空白中间页、总数变化、两遍集合不同但数量相同。
- [ ] 在显式本机 verify `DATABASE_URL` 下跑测试，确认失败；核对迁移只指向本机 verify 库。
- [ ] 实现模型、迁移、分块事务写入及数据库集合比较；失败运行保留原因，绝不生成确认下架项。
- [ ] 跑扫描仓库测试与 Prisma generate/typecheck，确认通过；提交本任务文件。

### Task 2: 同步状态机改为先扫后取详情

**Files:**
- Create: `apps/api/src/pesdata-sync/pesdata-player-reconciliation.processor.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata-sync.service.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata-sync.types.ts`
- Create: `apps/api/src/pesdata-sync/pesdata-player-reconciliation.processor.spec.ts`
- Modify: `apps/api/src/platform-data-sync/platform-data-sync.runner.spec.ts`

**Interfaces:**
- `ExternalSyncRun.currentPhase` 对 `RECONCILE` 采用 `SCAN_PASS_1`、`SCAN_PASS_2`、`DIFF`、`FETCH_DETAILS`、`VERIFY_REMOVALS`、`READY`；`currentOffset` 仅表示当前遍的页偏移，切换遍时在持有租约的事务内归零。
- `PesdataPlayerReconciliationProcessor.processNextChunk(runId)` 保持现有租约/心跳/暂停/继续语义；每个扫描块只写一页及进度，不在第一遍时创建待发布批次。仅 `comparePasses().trusted === true` 时进入差异阶段。现有 processor 继续处理其余三种模式。

- [ ] 写失败测试：第一页、跨遍切换、掉线恢复、租约丢失、暂停继续、来源在两遍之间重排及 ID 集合变化。
- [ ] 显式 verify `DATABASE_URL` 跑目标测试，确认失败。
- [ ] 实现独立 `RECONCILE` 阶段转换，保留 `SAMPLE/FULL/INCREMENTAL` 原行为；首次全量未验收前不启用每日入口。
- [ ] 跑 processor、service、runner 测试和 typecheck，确认无重扫死循环及重复批次；提交本任务文件。

### Task 3: 详情差异、滚动复核和下架证据

**Files:**
- Create: `apps/api/src/pesdata-sync/pesdata-player-reconciliation.service.ts`
- Create: `apps/api/src/pesdata-sync/pesdata-player-reconciliation.service.spec.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata-client.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata-client.spec.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata-player-chunk.processor.ts`
- Modify: `apps/api/prisma/schema.prisma` 与 Task 1 迁移或后续独立迁移（增加差异分类、复核时间、下架证据）

**Interfaces:**
- `reconcile(runId, { detailBudget, auditBudget })` 分块对比可信来源清单与 `player_cards` 正式卡，只取新增、摘要变化、失败重试与最久未复核的旧卡详情；持久化 `ADDED | UPDATED | UNCHANGED | REMOVAL_CANDIDATE | REMOVAL_CONFIRMED | FAILED` 及规范化业务字段 checksum。
- `PesdataClient.getPlayerDetailEvidence(externalId)` 返回 `{ kind: 'FOUND'; detail } | { kind: 'CONFIRMED_ABSENT'; evidence } | { kind: 'UNKNOWN'; reason }`。只把明确 `is_del=1` 归为 `CONFIRMED_ABSENT`；HTTP 404、空数组、超时或协议异常归 `UNKNOWN`，不猜测来源语义。
- `REMOVAL_CONFIRMED` 必须有本日可信双遍扫描，且单卡详情明确失效，或上一个相邻业务日期也有独立可信双遍扫描并缺失。详情正常的卡不得下架；中间一天无可信扫描则中断连续缺失。

- [ ] 写失败测试：摘要相同但详情变化、业务字段不变、网络超时、429/5xx、未知 404、明确 `is_del`、首日缺失、相邻两日缺失、漏扫一天、同日手动重跑、缺失后重现、多张卡共用 `base_pes_id`。
- [ ] 显式 verify `DATABASE_URL` 跑测试，确认失败。
- [ ] 实现分块差异与复核；保留原始详情 checksum 供诊断，业务 checksum 决定 `UPDATED`；记录最后复核时间和确认依据。
- [ ] 跑 client、mapper、reconciliation 与 processor 测试；提交本任务文件。

### Task 4: 可发布差异和安全下架版本

**Files:**
- Modify: `apps/api/src/player-import/player-import.service.ts`
- Modify: `apps/api/src/player-import/player-import.publisher.ts`
- Modify: `apps/api/src/player-import/player-import-publication-plan.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata-player-reconciliation.service.ts`
- Modify: `apps/api/src/player-import/player-import.publisher.spec.ts`
- Modify: `apps/api/test/player-catalog.e2e-spec.ts`

**Interfaces:**
- `preparePublishableBatches(runId)` 只把 `ADDED`、`UPDATED`、`REMOVAL_CONFIRMED` 变成导入批次；对缺失详情但已确认下架的卡，从其已发布规范化数据构造 `status='INACTIVE'` 更新记录，确保 `sourceId + externalId` 及既有 `player_cards.id` 不变。候选证据存最近两次可信扫描运行 ID 与业务日期。
- 版本发布沿用 `PlayerImportPublisher` 的事务和幂等机制；相同业务 checksum 的 `UNCHANGED` 不生成新版本；重新出现的卡发布 `ACTIVE` 版本。

- [ ] 写失败测试：新增、字段更新、未变化、确认下架、未确认缺失、下架后恢复、重复准备和重复发布。
- [ ] 显式 verify `DATABASE_URL` 跑测试，确认失败。
- [ ] 实现批次准备与下架记录映射，不物理删除关联数据；单批失败后可重试且不会标全量生效。
- [ ] 跑发布器及球员库端到端测试，核对公开列表隐藏 `INACTIVE`、历史详情仍可读；提交本任务文件。

### Task 5: 后台差异报告与一键发布

**Files:**
- Modify: `apps/api/src/platform-data-sync/platform-data-sync.service.ts`
- Modify: `apps/api/src/platform-data-sync/platform-data-sync.controller.ts`
- Modify: `apps/api/src/platform-data-sync/platform-data-sync.service.spec.ts`
- Modify: `apps/admin-web/src/platform/data-sync/player-sync-panel.tsx`
- Modify: `apps/admin-web/src/platform/data-sync/player-sync-panel.spec.tsx`
- Modify: `packages/contracts/src/platform-data-sync.ts`（执行前定位实际契约文件）

**Interfaces:**
- `GET /platform/data-sync/player-runs/:runId/reconciliation` 返回来源总数、本地公开数、六类差异计数、分页可读项、最近详情复核时间和可信状态。
- `POST /platform/data-sync/player-runs/:runId/publish-valid` 由管理员触发；服务端在事务/锁内验证运行 `READY`、扫描可信、候选未过期、批次状态可发布，跳过 `FAILED` 与 `REMOVAL_CANDIDATE`，返回发布/跳过/失败计数与批次明细。
- `GET/PUT /platform/data-sync/players/schedule` 读取或保存启用状态、IANA 时区和 `HH:mm` 开始时间；只允许平台管理员操作，并写审计日志。后台同时显示最近可信扫描和下次计划启动时间。
- 现有后台“全量发布”能力应接此校验入口，不让前端遍历历史记录自行发布；状态区分扫描完成、待发布、部分生效、完全生效。

- [ ] 写失败测试：可读名称与变化字段、两类跳过计数、过期报告、双击发布、部分失败、权限拒绝、时区/时间校验、后台状态文案。
- [ ] 显式 verify `DATABASE_URL` 跑 API 测试；跑 admin-web 目标测试，确认失败。
- [ ] 实现报告 API、发布 API、审计日志和后台页面；发布前重新核对版本/运行状态。
- [ ] 跑相关 API、后台测试、typecheck 和 build；提交本任务文件。

### Task 6: 每日调度、50,000 张压测与受控上线

**Files:**
- Create: `apps/api/src/pesdata-sync/pesdata-player-reconciliation.scheduler.ts`
- Create: `apps/api/src/pesdata-sync/pesdata-player-reconciliation.scheduler.spec.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata-sync.module.ts`
- Create: `apps/api/scripts/benchmark-pesdata-reconciliation.ts`
- Create: `docs/performance/2026-10-22-pesdata-reconciliation-50k.md`
- Test: `apps/api/test/league-teams.e2e-spec.ts` 与小程序“我的联赛”、持有、收藏、交易历史现有测试

**Interfaces:**
- 管理员设置表保存每日运行时间、时区、开关、详情复核预算和请求预算；默认关闭。后台可读取和更新，且写审计。唯一日运行键与已有 `activeLeaseKey` 保证多实例不重复创建。
- 基准脚本只接受显式本机 verify/test `DATABASE_URL`；生成 50,000 张来源卡、跨页变更、重复、丢页和长期暂存样本，并记录内存、耗时及暂存表增长。
- 暂存数据只按已终结的精确 `runId` 执行带预览、备份和事务的归档/清理；不按日期或模糊名称批量删除。不得删除差异报告和审计记录。

- [ ] 写失败测试：多实例同一天只创建一次、任务关闭不创建、时区和夏令时变更、跨午夜归属、预算耗尽不误判、50,000 张扫描内存有界、暂存保留范围精确。
- [ ] 在本机 verify 库运行基准与回归；记录多遍扫描、详情预算、下架候选、发布批次、公开集合核对结果。
- [ ] 跑 API/admin-web 全套受影响测试、lint、typecheck、build；回归后台联赛球队现役/已退出、球队详情、小程序“我的联赛”、持有、收藏和交易历史。
- [ ] 清理自己在 verify 库创建的精确测试数据并复查；写性能与限制报告；提交本任务文件。
- [ ] 目标环境只读 `pnpm db:status`，受控迁移后再部署 API/后台。初始保持调度关闭，手动运行一次并核对报告、前端解析、发布和公开集合；完成验收后再启用日调度。

## 执行准备与命令

查询优化已经在 `dev`，本计划新增对账与发布能力。先确认本机 MySQL host/库名。所有 API/e2e 命令显式设置连接，例如：

```bash
DATABASE_URL='mysql://efm:efm_local@127.0.0.1:3307/efootball_catalog_verify' pnpm --filter @efm/api test pesdata
DATABASE_URL='mysql://efm:efm_local@127.0.0.1:3307/efootball_catalog_verify' WECHAT_GATEWAY_MODE=fake STORAGE_PROVIDER=local pnpm --filter @efm/api test:e2e player-catalog.e2e-spec.ts
```

示例账号密码必须与本机 Docker Compose 核对。执行时按项目数据安全约束处理任何持久化测试数据；现有未提交工作不得混入本功能提交。

## 实施记录（2026-10-23）

- 已实现独立 `RECONCILE` 状态机、两遍扫描持久化与可信性校验、每日/手动触发、差异报告和管理员分批一键发布。发布每次 HTTP 请求只处理一个批次，由后台在一次点击后继续请求，避免首轮数百批次的单次请求超时。
- 已实现明确失效或相邻两日可信缺失的下架条件、详情仍可读取时阻止下架、异常缺失比例保护、复核预算、重试批次隔离及已发布批次中断后的状态修复。详情证据逻辑直接包含在独立 processor，未另拆计划中命名的 service/client API。
- 本机 verify 库已应用 3 个迁移，`db:status` 显示已更新。最终 API 单测 169 个文件/1042 个测试通过；球员库与联赛球队 e2e 2 个文件/8 个测试通过；后台 54 个文件/245 个测试、小程序 100 个文件/469 个测试通过；API/后台构建和类型检查、API lint 通过。详见 [5 万卡基准](../../performance/2026-10-23-pesdata-reconciliation-50k.md)。
- 审查后增加了公开卡片编号集合核对、未发布旧卡重新发布、对账批次原子创建；逐批发布期间仍可能有短暂中间状态，见上线说明。若业务要求所有卡在单一时间点同时切换，需要单独设计全库版本可见性门闩。
- 目标环境 `db:status`、受控迁移、真实 PESDATA 首轮扫描、实际接口和小程序展示尚未执行；按 [上线与使用说明](../../operations/player-catalog-daily-reconciliation.md) 验收。扫描证据当前保留，长期归档与精确任务清理为后续运维工作。
