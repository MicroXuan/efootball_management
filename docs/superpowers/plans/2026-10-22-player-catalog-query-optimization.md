# Player Catalog Query Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 50,000 张以上球员卡的公开查询只读取目标页及必要关联，并按来源日期与评分大致贴近 PESDATA 官网顺序。

**Architecture:** `PlayerCatalogService` 保持接口映射；新增 `PlayerCatalogReadRepository` 执行参数化 SQL，在固定发布序号下选每张卡的最新版本，再筛选、排序、分页。发布时分别物化五个搜索字段，旧版本分块回填。详情及球员包也改为定向 SQL。

**Tech Stack:** NestJS、TypeScript、Prisma 7、MySQL、Jest、小程序 TypeScript。

**Spec:** [球员库查询优化设计](../specs/2026-10-22-player-catalog-query-optimization-design.zh-CN.md)

## Global Constraints

- 不改变小程序现有每页 20 张、滚动加载、响应字段及 `INVALID_CURSOR` 错误；游标仍为不透明字符串，内部需携带新排序键并处理切换期旧游标。
- 卡片身份为 `playerCardId`；游标固定发布序号；最新版 `INACTIVE` 不出现在公开列表。
- 公开卡片列表排序语义固定为 `packReleaseDate DESC`（空值排末尾）、`overallRating DESC`、`publishedAt DESC`、`playerCardId ASC`；MySQL 日期降序本身使空值排末尾，可直接利用顺序索引。搜索继续使用 `normalizeSearchText` 的包含匹配。PESDATA 同日期内不承诺逐张同序。
- `DATABASE_URL` 必须在每条 API 单测、端到端测试和本机迁移命令上显式指定为 `127.0.0.1:3307` 的隔离 `efootball_catalog_verify` 库。执行写入前核对主机和库名；不得使用 `.env` 所指共享库。
- 目标环境先 `pnpm db:status`，先迁移和回填、再放行新 API；目标环境只读核对接口、索引与执行计划。

## Review Focus

1. 发布夹在两页之间：旧游标只能看到旧发布快照；排序切换期间已有旧格式游标不能造成重复或漏卡。Task 2 的集成测试覆盖。
2. 新版已 `INACTIVE`：不能回退展示旧 `ACTIVE` 版。Task 2 和 Task 3 覆盖。
3. Unicode、空格及大小写包含搜索：新 SQL 与旧 `normalizeSearchText` 一致。Task 1 和 Task 2 覆盖。
4. 同一球员多张卡、球员包同名或跨版本换包：详情与包计数正确。Task 3 覆盖。
5. 深页游标和大量历史版本：响应项、数据库返回行数及延迟在 50,000 张隔离数据下可测。Task 4 覆盖。

## 执行顺序与数据流

```mermaid
flowchart LR
  A[发布新版本] --> B[分别规范化搜索字段]
  B --> C[(player_card_versions)]
  D[公开 API + 游标] --> E[ReadRepository SQL]
  C --> E
  E --> F[至多 limit+1 行]
  F --> G[Service 映射]
  G --> H[小程序 20 张/页]
```

### Task 1: 物化搜索文本与安全迁移

**Files:**
- Modify: `apps/api/prisma/schema.prisma` 的 `PlayerCardVersion`
- Create: `apps/api/prisma/migrations/<执行时生成时间戳>_player_card_version_search_fields/migration.sql`
- Create: `apps/api/src/player-catalog/player-card-search-fields.ts`
- Create: `apps/api/src/player-catalog/player-card-search-fields.spec.ts`
- Modify: `apps/api/src/player-import/player-import-publication.types.ts`
- Modify: `apps/api/src/player-import/player-import-publication-plan.ts`
- Create: `apps/api/src/player-catalog/backfill-player-card-search-fields.cli.ts`

**Interfaces:**
- Produces `buildPlayerCardSearchFields(input: { cardName: string; packNameZh: string | null; packNameEn: string | null }): { normalizedCardName: string; normalizedPackNameZh: string | null; normalizedPackNameEn: string | null }`，对三个字段分别调用 `normalizeSearchText`；球员中英文名继续使用已有 `normalizedNameZh/En`。
- `PublicationVersionRow` 增加上述三个属性；发布计划的 `versionRow()` 写入它们；Prisma 列分别映射到 `normalized_card_name`、`normalized_pack_name_zh`、`normalized_pack_name_en`，长度与原字段及 NFKC 扩展核对。
- 回填 CLI 必须支持 `--dry-run`、`--chunk-size`、`--after-id`，只更新新增字段仍为空的精确 ID 范围；输出处理数、剩余数和校验样本。查询切换前确保历史版本全部回填。

- [ ] 写失败测试：中文/英文名、卡名和球员包名任一字段可命中；大小写、组合音符、空格的结果与 `normalizeSearchText` 一致；跨字段拼接不能误命中。
- [ ] 显式设置本机隔离 `DATABASE_URL` 跑测试，确认新测试失败。
- [ ] 新增列、发布写入和分块回填；在隔离库执行 `pnpm db:migrate` 与回填 dry run，再实际回填并验证剩余空值为 0。
- [ ] 跑相关发布计划和发布仓库测试，确认新旧版本的五个字段都可搜索；提交本任务涉及的文件。

### Task 2: 列表查询下推及游标快照

**Files:**
- Create: `apps/api/src/player-catalog/player-catalog-read.repository.ts`
- Create: `apps/api/src/player-catalog/player-catalog-read.repository.spec.ts`
- Modify: `apps/api/src/player-catalog/player-catalog.service.ts` 的 `search()`
- Create: `apps/api/src/player-catalog/player-search-cursor.ts`（只服务球员卡列表；球员包继续使用现有 `catalog-cursor.ts`）
- Modify: `apps/api/src/player-catalog/player-catalog.module.ts`
- Modify: `apps/api/test/player-catalog.e2e-spec.ts`

**Interfaces:**
- Produces `PlayerCatalogReadRepository.search(input: { releaseSequence: number; keyword: string | null; position?: PlayerPosition; minOverall?: number; maxOverall?: number; cardType?: PlayerCardType; cardPackId?: string; after?: CatalogCursor; limit: number }): Promise<PlayerCardVersion[]>`；返回最多 `limit + 1` 条。
- 查询必须以 `v.release_sequence <= releaseSequence` 且 `NOT EXISTS` 同卡更高 `release_sequence <= releaseSequence` 选择最新版，然后应用 `status='ACTIVE'` 和筛选；游标谓词与四字段排序完全相同，日期空值排末尾。`PlayerSearchCursor` 包含固定 `releaseSequence`、可空 `packReleaseDate`、`overallRating`、`publishedAt`、`id` 和格式版本；对旧版游标使用原 `publishedAt DESC, overallRating DESC, playerCardId ASC` 的兼容 SQL 分支，直至该次翻页结束。五列 `LIKE` 必须转义用户输入中的 `%`、`_`、`\\`，并使用与 JS 规范化结果一致的二进制比较规则。SQL 使用 Prisma 参数绑定，不拼接用户值。

- [ ] 写失败集成测试：50 张多版本卡按日期/评分分页、空日期排末尾、跨页发布、旧游标切换、下架不回退、全部筛选组合、无效游标、Unicode 包含搜索，以及搜索词中 `%`、`_`、`\\`、重音字符的字面匹配。
- [ ] 在本机 verify 库显式设置 `DATABASE_URL` 跑目标测试，确认失败点是当前全量查询或缺少新仓库。
- [ ] 实现仓库与 `search()` 接线；保留 `PlayerCatalogService` 的响应形状及不透明游标契约；不要在 Node.js 再取全量版本。
- [ ] 跑仓库测试、`player-catalog.e2e-spec.ts` 与 API typecheck，确认第一页、深页及错误结构；提交本任务文件。

### Task 3: 详情与球员包定向读取

**Files:**
- Modify: `apps/api/src/player-catalog/player-catalog-read.repository.ts`
- Modify: `apps/api/src/player-catalog/player-catalog.service.ts` 的 `getPlayer()`、`getCard()`、`listPacks()`、`getPack()`
- Modify: `apps/api/src/player-catalog/player-catalog.service.spec.ts`
- Modify: `apps/api/test/player-catalog.e2e-spec.ts`
- Modify: `packages/contracts/src/player-catalog.ts`（仅当现有契约禁止 `INACTIVE` 卡详情时；先定位实际定义）

**Interfaces:**
- 仓库新增 `findCardAtRelease(cardId, releaseSequence)`、`listPlayerCardsAtRelease(playerId, releaseSequence)`、`listPackCardsAtRelease(packId, releaseSequence)`、`listPacksAtRelease({ releaseSequence, after, limit })`；详情保留现有字段，`getCard()` 对已发布的 `INACTIVE` 卡返回状态，对从未发布的卡仍返回 `PLAYER_CARD_NOT_FOUND`。
- 包列表的 `cardCount` 和包详情卡片均只统计该卡在发布快照内的最新版且为 `ACTIVE`，同名不同 `cardPackId` 不合并。

- [ ] 写失败测试：已下架卡直达详情、未发布卡 404、一个球员有多张卡、跨版本换包、同名包、空包、包分页不漏项。
- [ ] 用本机 verify `DATABASE_URL` 跑测试，确认失败。
- [ ] 实现四个定向查询并替换所有 `latestVersions()` 调用；只有该球员或该包的卡会返回给 Node.js。
- [ ] 跑 API 单测及 `player-catalog.e2e-spec.ts`，确认响应契约；提交本任务文件。

### Task 4: 索引、50,000 张卡基准和回归

**Files:**
- Modify: `apps/api/prisma/schema.prisma` 与对应迁移（仅加入经实测有效的组合索引）
- Create: `apps/api/scripts/benchmark-player-catalog.ts`（只能连接显式本机 verify 库）
- Create: `docs/performance/2026-10-22-player-catalog-50k.md`
- Test: `apps/api/test/player-catalog.e2e-spec.ts`、`apps/api/test/league-teams.e2e-spec.ts`
- Test: `apps/miniprogram/miniprogram/pages/players/players.page.spec.ts`、`apps/miniprogram/miniprogram/pages/players/players.viewmodel.spec.ts`、`apps/miniprogram/miniprogram/pages/my-league-teams/my-league-teams.viewmodel.spec.ts`

**Interfaces:**
- 基准脚本提供 `--count 50000 --versions-per-card 2 --seed <整数>`，拒绝非本机及库名不含 `verify`/`test` 的连接；仅在隔离库生成可清理的精确 ID 清单。
- 性能报告列出普通页、筛选、搜索、深页、详情和包列表的 p50/p95、`EXPLAIN` 实际扫描行数、索引、返回行数及生成数据量。上线阈值在基准完成后用数据决定；不得凭小库结果宣称达标。

- [ ] 写失败测试：基准脚本拒绝共享库连接；50,000 张数据中深页及多版本结果与新排序规则的金样本一致，旧版游标与原排序金样本一致。
- [ ] 在本机 verify 库跑基准，记录原始执行计划与延迟；按 `EXPLAIN` 加最少必要索引，再重复测量。包含搜索若超目标，另立倒排索引任务，不偷偷改为前缀匹配。
- [ ] 用显式 verify `DATABASE_URL` 跑 API 单测和受影响 e2e；跑 admin-web 与 miniprogram 相关测试、lint、typecheck、build；修复回归。
- [ ] 文档记录结果、精确清理本机基准数据并复查、提交本任务文件。

### Task 5: 目标环境受控验收

**Files:**
- Modify: `docs/performance/2026-10-22-player-catalog-50k.md`，加入目标环境只读验收记录。

**Interfaces:** 无新代码接口。

- [ ] 核对目标主机、库名和 `pnpm db:status`；先应用待部署迁移，回填后只读核对三个新增规范化字段的完成情况与索引；新 API 才承接流量。
- [ ] 目标环境只读核对公开 API 的首页、下一页、搜索、卡详情、球员包；比对前端实际解析。
- [ ] 复测后台联赛球队“现役球队 / 已退出”、球队详情、小程序“我的联赛”及球员库；记录无法验收范围，不把未核对的功能称为通过。

## 执行准备与命令

先验证本机 MySQL 容器和 `efootball_catalog_verify` 库确实隔离。测试命令统一在**同一条命令**上设置连接，例如：

```bash
DATABASE_URL='mysql://efm:efm_local@127.0.0.1:3307/efootball_catalog_verify' pnpm --filter @efm/api test --runInBand player-catalog
DATABASE_URL='mysql://efm:efm_local@127.0.0.1:3307/efootball_catalog_verify' pnpm --filter @efm/api test:e2e --runInBand player-catalog.e2e-spec.ts
```

执行前重新核对本机账号密码和 Docker Compose 配置；此处示例不能代替核对。当前工作区其他改动不得混入此计划的提交。若使用独立 worktree，先确认工作区文件与计划文档已带入隔离目录。
