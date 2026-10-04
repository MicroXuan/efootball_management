# 分级联赛实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有联赛赛季、比赛、比分和积分榜能力上，交付首赛季冠军组、常规赛季超级组/冠军组、管理员确认分组、分组单循环赛程及小程序多组积分榜。

**Architecture:** 保留旧个人赛事的 `Competition` 数据和接口，以可空赛季引用与 `OPEN_EVENT` 类型兼容；新分级联赛以一个 `DIVISION_LEAGUE` Competition 容纳多个 Stage。系统建议与管理员决定分表保存，确认后才写入 `StageParticipant`；比赛与积分榜都按 Stage 隔离，现有比分版本和确认流程继续复用。

**Tech Stack:** TypeScript、NestJS、Prisma/MySQL、Zod、React/Ant Design、原生微信小程序、Jest/Vitest。

**Spec:** `docs/superpowers/specs/2026-09-26-league-season-pyramid-design.zh-CN.md`

## Global Constraints

- 使用 Node `>=24 <25`；本机执行命令使用 `/opt/homebrew/opt/node@24/bin`。
- 旧 Competition、报名、比赛、正式比分与 Competition 级积分榜必须继续可读，不做破坏性回填。
- 首赛季永远不创建超级组；冠军组超过容量后均分，组间人数差不超过 1。
- 系统建议不得直接改变正式分组；只有管理员确认事务写入正式阶段成员。
- 发布赛程后禁止换组；关键写操作使用幂等键、乐观版本和审计记录。
- 所有用户界面与业务错误使用中文；小程序保持暗色原生风格，后台保持浅色数据工作区。
- 分级联赛只接纳当前赛季 `APPROVED` 的 `SeasonEntry`，未报名用户不能访问联赛私有工作台。

## Review Focus

- 同一管理员请求重放或两个管理员并发确认时，只产生一套正式分组、一个分级联赛和一条审计结果；Task 4 覆盖。
- 19、25、36、37 人以及容量小于现有超级组保留人数时，建议不丢队、不重复且冠军组人数差不超过 1；Task 2 覆盖。
- 奇数分组、23 人超级组与单人组不会生成重复/自对阵，轮空次数差不超过 1；Task 5 覆盖。
- 一个组的正式比分变化只重算该 Stage 的积分榜，不污染同赛季其他组；Task 6 覆盖。
- 旧个人赛事没有 `seasonId`、`competitionType`、`stageParticipant` 或 Stage 级快照时，原 API、比赛数量和积分榜行为保持不变；Tasks 1、5、6、10 覆盖。

---

### Task 1: 兼容型分级联赛数据结构与合同

**Files:**
- Create: `apps/api/prisma/migrations/20261003_tiered_league_foundation/migration.sql`
- Modify: `apps/api/prisma/schema.prisma`
- Modify: `packages/contracts/src/competition.ts`
- Modify: `packages/contracts/src/league.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`
- Modify: `apps/api/src/database/prisma.service.spec.ts`

**Interfaces:**
- Produces: `CompetitionType = OPEN_EVENT | DIVISION_LEAGUE | GROUP_KNOCKOUT_CUP | KNOCKOUT_CUP`，旧记录默认 `OPEN_EVENT`。
- Produces: `Competition.seasonId?: string`；`CompetitionParticipant.registrationId` 改为可空，并新增唯一可空 `seasonEntryId`。
- Produces: `CompetitionStage.stageCode`, `displayName`, `capacity`；新增 `StageParticipant(stageId, participantId, seed)`。
- Produces: `SeasonAllocationProposal`、`SeasonAllocationProposalRow`、`SeasonAllocationDecision`，以及分组建议/确认 Zod 合同。
- Produces: `StandingsSnapshot.stageId?: string`，旧 Competition 级快照保持兼容。

- [ ] **Step 1: 写失败的合同与 Prisma 元数据测试**

断言新枚举、Stage 摘要、建议行、覆盖决定、分组积分榜响应能够解析；拒绝重复球队决定、空覆盖原因、非正整数 seed 和未知 stageCode。数据库测试断言旧 Competition 仍允许空 `seasonId`，新分级 Competition 可关联赛季。

- [ ] **Step 2: 运行 RED**

Run: `pnpm --filter @efm/contracts test -- contracts.spec.ts && pnpm --filter @efm/api test -- prisma.service.spec.ts --runInBand`

Expected: FAIL，新结构和合同尚不存在。

- [ ] **Step 3: 实现增量迁移、Prisma 关系与合同**

迁移只新增列、索引和表；不更新或删除旧赛事数据。`CompetitionParticipant` 必须满足 `registrationId` 与 `seasonEntryId` 至少一个非空，由服务层和测试保证。

- [ ] **Step 4: 运行 GREEN 与迁移状态检查**

Run: `pnpm db:migrate && pnpm db:status && pnpm --filter @efm/contracts test -- contracts.spec.ts && pnpm --filter @efm/api test -- prisma.service.spec.ts --runInBand`

Expected: PASS，数据库 schema 最新。

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma packages/contracts apps/api/src/database/prisma.service.spec.ts
git commit -m "feat(db): add tiered league competition models"
```

### Task 2: 首赛季与常规赛季分组算法

**Files:**
- Create: `apps/api/src/league-allocation/domain/allocation.ts`
- Create: `apps/api/src/league-allocation/domain/allocation.spec.ts`

**Interfaces:**
- Consumes: approved season-entry summaries、上一赛季组别/名次、`superCapacity`、`championCapacity`、`promotionCount`、确定性 `randomSeed`。
- Produces: `buildFirstSeasonAllocation(input): AllocationSuggestion[]`。
- Produces: `buildRegularSeasonAllocation(input): AllocationSuggestion[]`。
- Produces: `rankCrossGroupCandidates(rows): CrossGroupRank[]`，完全同值返回 `tiePending: true`。

- [ ] **Step 1: 写失败的纯领域测试**

覆盖 1、18、19、25、36、37 人；首赛季无 SUPER；常规赛保留/升级/降级/缺员补位；冠军组蛇形分配；新球队按 seed 可复现地均布；重复输入 ID 和容量小于 1 被拒绝。

- [ ] **Step 2: 运行 RED**

Run: `pnpm --filter @efm/api test -- allocation.spec.ts --runInBand`

Expected: FAIL，算法模块尚不存在。

- [ ] **Step 3: 实现纯函数**

不读取数据库、不使用全局随机数。冠军组数为 `ceil(候选人数 / championCapacity)`，再按商和余数均分；历史球队蛇形放置，新球队用 seed 洗牌后逐组补齐。

- [ ] **Step 4: 运行 GREEN**

Run: `pnpm --filter @efm/api test -- allocation.spec.ts --runInBand`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/league-allocation/domain
git commit -m "feat(api): calculate tiered league allocations"
```

### Task 3: 生成并读取版本化分组建议

**Files:**
- Create: `apps/api/src/league-allocation/league-allocation.errors.ts`
- Create: `apps/api/src/league-allocation/league-allocation.service.ts`
- Create: `apps/api/src/league-allocation/league-allocation.service.spec.ts`
- Create: `apps/api/src/league-allocation/admin-league-allocation.controller.ts`
- Create: `apps/api/src/league-allocation/league-allocation.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces: `POST /v1/admin/leagues/:leagueId/seasons/:seasonId/allocation-proposals`，幂等生成新建议版本。
- Produces: `GET /v1/admin/leagues/:leagueId/seasons/:seasonId/allocation-proposals/latest`，返回建议、依据指标和是否需要人工裁决。
- Consumes: Task 2 算法与已批准 SeasonEntry；常规赛读取上一赛季最终 Stage 积分榜。

- [ ] **Step 1: 写失败的服务测试**

断言只读取 `APPROVED` 资格；非 `ALLOCATION_REVIEW` 赛季拒绝生成；相同幂等键返回原建议；重新生成创建递增版本且不覆盖旧建议；首赛季无 SUPER；常规赛缺少上一赛季最终榜时返回中文业务错误。

- [ ] **Step 2: 运行 RED**

Run: `pnpm --filter @efm/api test -- league-allocation.service.spec.ts --runInBand`

Expected: FAIL，服务尚不存在。

- [ ] **Step 3: 实现建议服务、路由、作用域鉴权和审计**

控制器保留 `leagueId` 路由参数供 `AdminScopeGuard` 校验，并验证 season 确实属于该联赛。事务锁定 season 行；保存算法版本、randomSeed、完整输入摘要和每行建议原因。生成建议不创建 Competition、StageParticipant 或赛程。

- [ ] **Step 4: 运行 GREEN**

Run: `pnpm --filter @efm/api test -- league-allocation --runInBand && pnpm --filter @efm/api typecheck`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/league-allocation apps/api/src/app.module.ts
git commit -m "feat(api): generate versioned league allocations"
```

### Task 4: 管理员确认分组并建立正式 Stage 成员

**Files:**
- Modify: `apps/api/src/league-allocation/league-allocation.service.ts`
- Modify: `apps/api/src/league-allocation/league-allocation.service.spec.ts`
- Modify: `apps/api/src/league-allocation/admin-league-allocation.controller.ts`
- Modify: `apps/api/src/leagues/seasons.service.ts`
- Modify: `apps/api/src/leagues/seasons.service.spec.ts`

**Interfaces:**
- Produces: `POST /v1/admin/leagues/:leagueId/seasons/:seasonId/allocation-decisions`，输入 `proposalId`、`expectedSeasonVersion`、覆盖行与原因。
- Produces: 一个 `DIVISION_LEAGUE` Competition、SUPER/CHAMPION_* Stages、TEAM participants、StageParticipants，并把赛季推进到 `READY`。
- Produces: `POST /v1/admin/leagues/:leagueId/seasons/:seasonId/reopen-allocation`，仅在未发布任何 Stage 赛程时回到 `ALLOCATION_REVIEW`。

- [ ] **Step 1: 写失败的确认事务测试**

覆盖无原因覆盖拒绝、球队遗漏/重复拒绝、非批准球队拒绝、过期 proposal/version 返回 409、并发确认只成功一次、幂等重放、确认后正式成员完整、赛程发布后禁止重开。

- [ ] **Step 2: 运行 RED**

Run: `pnpm --filter @efm/api test -- league-allocation seasons.service.spec.ts --runInBand`

Expected: FAIL，确认流程尚不存在。

- [ ] **Step 3: 实现原子确认与赛季状态流**

所有 Competition/participant/stage/member/decision/audit 写入同一事务。TEAM participant 的 `seasonEntryId` 必填，`displayNameSnapshot` 来自 SeasonEntry 快照；覆盖只保存与建议不同的决定。

- [ ] **Step 4: 运行 GREEN**

Run: `pnpm --filter @efm/api test -- league-allocation seasons.service.spec.ts --runInBand`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/league-allocation apps/api/src/leagues
git commit -m "feat(api): confirm official league divisions"
```

### Task 5: 按 Stage 生成和发布单循环赛程

**Files:**
- Modify: `apps/api/src/competitions/domain/round-robin.ts`
- Modify: `apps/api/src/competitions/domain/round-robin.spec.ts`
- Modify: `apps/api/src/competitions/schedules.service.ts`
- Modify: `apps/api/src/competitions/schedules.service.spec.ts`
- Modify: `apps/api/src/competitions/schedules.controller.ts`
- Modify: `packages/contracts/src/competition.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`

**Interfaces:**
- Produces: `POST /v1/admin/leagues/:leagueId/competition-stages/:stageId/schedule/generate|publish` 与 `GET /v1/competition-stages/:stageId/schedule`。
- Preserves: 旧 `competitionId` 赛程路由继续使用 Competition 的默认 Stage 和 CompetitionParticipant。
- Consumes: Task 4 `StageParticipant`；赛程只允许同 Stage 成员对阵。

- [ ] **Step 1: 写失败的赛程测试**

断言 1、2、3、18、23 人比赛数和轮数；23 人为 23 轮/每队 22 场；无自对阵/重复对阵；奇数轮空公平；相邻 Stage 不串队；发布后重复生成或改变成员被拒绝；旧赛事行为不变。

- [ ] **Step 2: 运行 RED**

Run: `pnpm --filter @efm/api test -- round-robin schedules.service.spec.ts --runInBand`

Expected: FAIL，Stage 路由和成员读取尚不存在。

- [ ] **Step 3: 扩展轮转算法与赛程服务**

管理写路由保留 `leagueId` 并验证 Stage 经 Competition/Season 归属该联赛。0/1 人组返回空赛程；2 人及以上使用确定性 circle method。发布第一个 Stage 赛程时把赛季从 `READY` 推进到 `IN_PROGRESS`，并遵守同联赛仅一个进行中赛季约束。

- [ ] **Step 4: 运行 GREEN**

Run: `pnpm --filter @efm/contracts test && pnpm --filter @efm/api test -- round-robin schedules.service.spec.ts --runInBand`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/contracts apps/api/src/competitions
git commit -m "feat(api): schedule tiered league stages"
```

### Task 6: Stage 级积分榜与球队比分权限

**Files:**
- Modify: `apps/api/src/competitions/results.service.ts`
- Modify: `apps/api/src/competitions/results.service.spec.ts`
- Modify: `apps/api/src/competitions/standings.service.ts`
- Modify: `apps/api/src/competitions/standings.service.spec.ts`
- Modify: `apps/api/src/competitions/public-competitions.controller.ts`
- Modify: `packages/contracts/src/competition.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`

**Interfaces:**
- Produces: TEAM participant 的球队拥有者可提交、确认和拒绝本队比赛比分。
- Produces: `GET /v1/me/leagues/:leagueId/seasons/:seasonId/division-standings`，仅允许该赛季 `APPROVED` 参赛者读取，返回 Stage 标签与各自最新榜单。
- Preserves: `GET /v1/competitions/:competitionId/standings` 对旧赛事继续返回 Competition 级快照。

- [ ] **Step 1: 写失败的比分和榜单隔离测试**

覆盖球队拥有者双方权限、非拥有者 403、管理员修正；A 组正式比分只生成 A Stage 新快照，B 组版本和排名不变；排名字段包含场次、胜平负、进失球、净胜球、积分；无比赛组返回全零初始榜；旧赛事回归。

- [ ] **Step 2: 运行 RED**

Run: `pnpm --filter @efm/api test -- results.service.spec.ts standings.service.spec.ts --runInBand`

Expected: FAIL，TEAM 所有权和 Stage 快照尚未接入。

- [ ] **Step 3: 实现 TEAM 权限解析与 Stage 重算**

结果服务通过 participant 的 `seasonEntry.ownerUserId` 判定主客方；积分榜使用该 Stage 的正式比赛全集重算，并保留触发比分版本。聚合接口使用 `JwtAuthGuard` 校验当前用户的正式赛季资格，并按 stage.sequence 稳定排序。

- [ ] **Step 4: 运行 GREEN**

Run: `pnpm --filter @efm/contracts test && pnpm --filter @efm/api test -- results.service.spec.ts standings.service.spec.ts --runInBand`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/contracts apps/api/src/competitions
git commit -m "feat(api): publish stage-scoped league standings"
```

### Task 7: 后台分组确认与赛程发布工作台

**Files:**
- Create: `apps/admin-web/src/leagues/allocation-page.tsx`
- Create: `apps/admin-web/src/leagues/allocation-page.spec.tsx`
- Modify: `apps/admin-web/src/leagues/league-shell.tsx`
- Modify: `apps/admin-web/src/leagues/league-shell.spec.tsx`
- Modify: `apps/admin-web/src/app.tsx`
- Modify: `apps/admin-web/src/styles.css`

**Interfaces:**
- Consumes: Tasks 3-5 建议、确认、重开和 Stage 赛程 API。
- Produces: 中文“分组与赛程”页面，支持赛季选择、生成建议、拖动前的选择式组别调整、原因填写、确认、各组赛程预览与发布。

- [ ] **Step 1: 写失败的后台组件测试**

覆盖首赛季不显示超级组、建议与最终决定差异、覆盖必须填原因、版本冲突自动刷新、确认后展示各组人数、无成员/无建议空态、赛程发布后编辑控件禁用。

- [ ] **Step 2: 运行 RED**

Run: `pnpm --filter @efm/admin-web test -- allocation-page.spec.tsx league-shell.spec.tsx`

Expected: FAIL，页面和路由尚不存在。

- [ ] **Step 3: 实现轻量管理工作台**

复用现有浅色卡片、表格、Tag、Select 和确认弹窗，不引入拖拽库。只有与系统建议不同的球队显示“人工调整”标记，提交原因与覆盖一起发送。

- [ ] **Step 4: 运行 GREEN**

Run: `pnpm --filter @efm/admin-web test -- allocation-page.spec.tsx league-shell.spec.tsx && pnpm --filter @efm/admin-web typecheck`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src
git commit -m "feat(admin): manage league divisions and schedules"
```

### Task 8: 小程序赛季积分榜与报名访问控制

**Files:**
- Create: `apps/miniprogram/miniprogram/pages/season-standings/index.ts`
- Create: `apps/miniprogram/miniprogram/pages/season-standings/index.wxml`
- Create: `apps/miniprogram/miniprogram/pages/season-standings/index.wxss`
- Create: `apps/miniprogram/miniprogram/pages/season-standings/index.json`
- Create: `apps/miniprogram/miniprogram/pages/season-standings/standings.viewmodel.ts`
- Create: `apps/miniprogram/miniprogram/pages/season-standings/standings.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/detail.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/detail.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/services/leagues.ts`
- Modify: `apps/miniprogram/miniprogram/app.json`
- Modify: `apps/miniprogram/miniprogram/design-system/registered-pages-visual-contract.spec.ts`

**Interfaces:**
- Consumes: Task 6 多组积分榜 API 与现有 `myEntry`。
- Produces: 已报名用户可见“积分榜”入口；未报名用户看到“报名后开放”且不能进入私有页。
- Produces: 暗色 Native 多组榜单，显示排名、球队、场次、胜/平/负、进/失/净胜球、积分。

- [ ] **Step 1: 写失败的 ViewModel 和页面契约测试**

覆盖 SUPER/冠军 A/B 标签、首赛季仅冠军组、空榜、并列待定标记、自己的球队高亮、未报名入口禁用、网络失败中文重试、页面注册。

- [ ] **Step 2: 运行 RED**

Run: `pnpm --filter @efm/miniprogram test -- standings.viewmodel.spec.ts detail.viewmodel.spec.ts registered-pages-visual-contract.spec.ts`

Expected: FAIL，积分榜页面尚不存在。

- [ ] **Step 3: 实现入口、服务和榜单页面**

横向数据使用紧凑可滚动表格；默认选中用户所在组，否则选第一组。接口 403 时返回联赛详情并显示报名提示，不泄露私有榜单。

- [ ] **Step 4: 运行 GREEN**

Run: `pnpm --filter @efm/miniprogram test -- standings.viewmodel.spec.ts detail.viewmodel.spec.ts registered-pages-visual-contract.spec.ts && pnpm --filter @efm/miniprogram typecheck`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/miniprogram/miniprogram
git commit -m "feat(miniprogram): show grouped league standings"
```

### Task 9: 联赛首页私有工作台摘要

**Files:**
- Create: `apps/api/src/league-workspace/league-workspace.service.ts`
- Create: `apps/api/src/league-workspace/league-workspace.service.spec.ts`
- Create: `apps/api/src/league-workspace/my-league-workspace.controller.ts`
- Create: `apps/api/src/league-workspace/league-workspace.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `packages/contracts/src/league.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/detail.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/detail.viewmodel.spec.ts`

**Interfaces:**
- Produces: `GET /v1/me/leagues/:leagueId/workspace?seasonId=`，仅返回当前用户已批准资格对应的球队、组别、当前排名、下一场与模块能力。
- Produces: 联赛详情中的“我的球队 / 当前组别 / 当前排名 / 下一场”摘要和按资格显示的积分榜、资产、财务、身价入口。

- [ ] **Step 1: 写失败的服务和 ViewModel 测试**

覆盖已报名摘要、未报名 403、历史赛季按快照读取、无比赛/无榜单空态、下一场按 plannedAt/轮次稳定选择、模块入口不对未报名用户开放。

- [ ] **Step 2: 运行 RED**

Run: `pnpm --filter @efm/api test -- league-workspace --runInBand && pnpm --filter @efm/miniprogram test -- detail.viewmodel.spec.ts`

Expected: FAIL，聚合接口和摘要尚不存在。

- [ ] **Step 3: 实现一次聚合查询与暗色摘要卡**

避免小程序逐模块 N+1 请求；模块能力由已有数据与访问资格计算，不在本批新增通用功能开关表。收藏仍是用户个人入口，不受联赛资格限制。

- [ ] **Step 4: 运行 GREEN**

Run: `pnpm --filter @efm/contracts test && pnpm --filter @efm/api test -- league-workspace --runInBand && pnpm --filter @efm/miniprogram test -- detail.viewmodel.spec.ts && pnpm --filter @efm/miniprogram typecheck`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/contracts apps/api/src/league-workspace apps/api/src/app.module.ts apps/miniprogram/miniprogram/pages/league-detail
git commit -m "feat: add enrolled league workspace summary"
```

### Task 10: 端到端回归、种子与交付验证

**Files:**
- Create: `apps/api/test/tiered-league.e2e-spec.ts`
- Modify: `apps/api/prisma/seed.ts`
- Modify: `docs/development/local-development.md`
- Modify: `docs/development/competition-loop.md`

**Interfaces:**
- Consumes: Tasks 1-9 全部接口与页面。
- Produces: 可重复的首赛季分组、赛程、比分和多组榜单验收数据；保留旧个人赛事回归样本。

- [ ] **Step 1: 写失败的 E2E 场景**

场景包含：创建首赛季批准 19 队、生成两个冠军组、管理员调整并确认、分别发布赛程、球队拥有者提交/确认比分、只更新对应组积分榜、未报名用户 403；另断言旧个人赛事的比赛数、正式结果和积分榜接口仍可用。

- [ ] **Step 2: 运行 RED**

Run: `pnpm --filter @efm/api test:e2e -- tiered-league.e2e-spec.ts`

Expected: FAIL，完整流程尚未接通。

- [ ] **Step 3: 补齐种子、中文验收文档与必要接线**

种子使用固定 ID/seed，重复执行不产生重复分组或比赛。文档写明管理员入口、小程序入口、Node 24、迁移、种子与验证命令。

- [ ] **Step 4: 运行完整验证**

Run: `pnpm db:status && pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build && git diff --check`

Expected: 全部 PASS；仅允许记录已知非失败构建提示。

- [ ] **Step 5: 迁移兼容性核对**

对迁移前已有个人赛事记录执行只读统计，确认 Competition、Match、official result 数量与 ID 不变；`OPEN_EVENT` 回填完整；新外键不存在孤儿记录。

- [ ] **Step 6: Commit**

```bash
git add apps/api/test apps/api/prisma/seed.ts docs/development
git commit -m "test: verify tiered league workflow"
```

### Task 11: 全分支评审与完成状态

**Files:**
- Review: `git diff b8b4a07..HEAD`

- [ ] **Step 1: 对照规格与 Review Focus 自查全分支**

确认十项任务全部覆盖，重点检查旧赛事兼容、并发确认、Stage 数据隔离、权限、空状态和中文错误。

- [ ] **Step 2: 修复所有 Critical 与 Important 问题**

每个修复先补可复现测试，再实现并运行相关测试。

- [ ] **Step 3: 重新运行完整验证**

Run: `pnpm db:status && pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build && git diff --check`

Expected: 全部 PASS。

- [ ] **Step 4: 保持分支，不推送、不合并**

按用户选择保留 `codex/native-football-ui-iteration` 和当前 worktree，报告提交范围与下一批（杯赛中心）依赖。
