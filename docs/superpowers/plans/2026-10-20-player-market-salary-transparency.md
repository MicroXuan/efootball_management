# 球员市场工资透明化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在联赛内球员市场列表与详情展示可追溯的实际或预计工资，并在申请前预览本队工资帽占用；联赛外球员卡不展示工资。

**Architecture:** API 按请求的联赛选择生效工资规则，使用与成交审核共用的档位匹配函数。市场列表返回金额及来源，详情追加本队工资帽影响；小程序只格式化服务端结果。已归属球员继续使用阵容快照作为实际工资，强报沿用该快照。

**Tech Stack:** TypeScript、NestJS、Prisma、Zod、原生微信小程序、Jest、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-20-player-market-salary-transparency-design.zh-CN.md`

## Global Constraints

- 工资是工资帽占用；官方身价与购买或强报金额是独立金额，不新增现金工资扣款。
- 不新增 Prisma 模型或迁移；不批量重算历史工资、归属或财务记录。
- 联赛外 `pages/player-card-detail`、球员库及通用 `player-card` 不请求或展示联赛工资。
- API 单元、端到端测试必须在命令上显式指定 `DATABASE_URL`，主机仅可为 `127.0.0.1` 或 `localhost`，库名包含 `test` 或 `verify`；不得继承 `.env` 的连接。
- 数据库写入前核对目标主机和库名。测试产生的持久化数据结束前清理并复查。目标环境 API 和小程序解析无法验收时明确报告，不声称已上线可用。
- 交付前复测后台球队列表“现役球队 / 已退出”、球队详情及小程序“我的联赛”；小程序在窄屏与常见手机宽度检查卡片和操作入口边界。
- 当前工作区有大量其他功能的未提交改动，包括本计划将编辑的文件。执行前检查目标文件差异；对已有改动的文件用交互式分块暂存并复查 staged diff，只提交本任务的代码块，不重置或覆盖其他改动。

## Review Focus

1. 同一球员在两个档位不同的联赛：列表与详情分别返回各自工资，不借用另一联赛规则。Task 3 测试。
2. 已归属球员保存工资与当前档位不同：主金额与强报预计占用仍为快照，现行档位价仅作比较。Task 3 测试。
3. 自由球员缺少持久化自动加点结果，虽然有初始总评或临时推导总评：返回不可报价，不显示零元。Task 3 测试。
4. 球队工资帽为空或报价后超帽：保留空值并正确计算差额，不将空值视作 0；申请资格仍由审核决定。Task 3 和 Task 4 测试。
5. 详情读取后规则、卡片或归属改变：页面文案写明以审核时为准，审核仍在事务内重新报价。Task 2 和 Task 4 测试。

---

### Task 1: 共享市场工资契约

**Files:**
- Modify: `packages/contracts/src/player-market.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`

**Interfaces:**
- Produce `PlayerMarketSalaryDisplaySchema` and `PlayerMarketSalaryDisplay`，作为 `PlayerMarketPlayerSummarySchema.salary` 的必填字段。结构使用 `kind: 'ACTUAL' | 'PROJECTED' | 'UNAVAILABLE'`，`salaryMinor: number | null`、`basisOverall: number | null`、`salaryRuleVersionId: string | null`、`currentTier: { salaryMinor; minOverall; maxOverall; salaryRuleVersionId; version; effectiveAt } | null`、`unavailableReason: 'AUTO_BUILD_MISSING' | 'SALARY_RULE_NOT_CONFIGURED' | 'SALARY_TIER_NOT_CONFIGURED' | null`。已归属球员的 `currentTier` 无法计算时也通过 `unavailableReason` 说明原因，但 `kind` 仍为 `ACTUAL`。
- Produce `PlayerMarketSalaryImpactSchema` and `PlayerMarketSalaryImpact`，作为 `PlayerMarketPlayerDetailSchema.salaryImpact` 的必填字段：`currentSalaryMinor`、`salaryCapMinor: number | null`、`projectedSalaryMinor: number | null`、`overCapMinor: number | null`。本队球员和无法报价时 `projectedSalaryMinor` 为 `null`；可以比较且未超帽时 `overCapMinor` 为 `0`。
- Preserve `card.salaryMinor` as a compatibility field; list and detail must agree with `salary.salaryMinor`.

- [ ] **Step 1: Write failing contract tests.** Add fixtures for free `PROJECTED` 500, owned `ACTUAL` 400 with `currentTier.salaryMinor` 600, owned `ACTUAL` with null current tier and a reason, `UNAVAILABLE` with null salary, and nullable cap impact. Assert schema parsing and reject contradictory combinations such as `UNAVAILABLE` with a numeric salary.
- [ ] **Step 2: Run red.** `pnpm --filter @efm/contracts test`；新增断言应失败。
- [ ] **Step 3: Add schemas and exported types** in `player-market.ts`; extend summary and detail with the exact names above. Use a discriminated union or refinement to enforce amount and reason consistency.
- [ ] **Step 4: Run green.** `pnpm --filter @efm/contracts test` and `pnpm --filter @efm/contracts typecheck`；两者通过。
- [ ] **Step 5: Commit only Task 1 hunks.** 对预存改动的文件使用 `git add -p`，复查 `git diff --cached` 后提交。

### Task 2: 共用生效规则选择与档位匹配

**Files:**
- Create: `apps/api/src/league-rosters/salary-quote.ts`
- Create: `apps/api/src/league-rosters/salary-quote.spec.ts`
- Modify: `apps/api/src/league-rosters/salary-rules.service.ts`

**Interfaces:**
- Produce `findActiveSalaryRule(client: PrismaService | Prisma.TransactionClient, leagueId: string, at: Date)`：仅返回该联赛 `ACTIVE` 且 `effectiveAt <= at` 的最近规则，按 `effectiveAt desc, version desc` 排序，包含档位。
- Produce `matchSalaryTier(tiers: readonly { minOverall: number; maxOverall: number; salaryMinor: number }[], overall: number)`：返回唯一命中档位或 `null`。
- Existing `SalaryRulesService.quoteWithClient` and `quoteVersionWithClient` keep their current response and error codes, but call the shared matcher; active quote uses the shared rule selector.

- [ ] **Step 1: Write failing tests** for overall boundary 92/93, no tier, no active rule, future rule, and same-time version tie; assert `quoteWithClient` still rejects missing rule or tier with existing error codes.
- [ ] **Step 2: Run red with explicit local test DB URL.** Before the first API test, use the local Docker MySQL to create and migrate `efootball_verify`; verify the URL host is `127.0.0.1` and the database name contains `verify`. Then run `DATABASE_URL='mysql://efm:efm_local@127.0.0.1:3307/efootball_verify' pnpm --filter @efm/api test --runInBand src/league-rosters/salary-quote.spec.ts`；新增断言应失败。
- [ ] **Step 3: Implement the selector and matcher** in `salary-quote.ts`; adapt `salary-rules.service.ts` without changing public quote behavior.
- [ ] **Step 4: Run green** for new tests and existing `salary-rules.service.spec.ts` using the explicit isolated `efootball_verify` URL；两组测试通过，结束后复查测试数据清理。
- [ ] **Step 5: Commit only Task 2 files.**

### Task 3: 市场列表、详情及工资帽影响

**Files:**
- Modify: `apps/api/src/player-market/player-market-query.service.ts`
- Modify: `apps/api/src/player-market/player-market-query.service.spec.ts`

**Interfaces:**
- Consume `findActiveSalaryRule` and `matchSalaryTier` from Task 2 and `PlayerMarketSalaryDisplay` / `PlayerMarketSalaryImpact` from Task 1.
- `listMarket` returns `item.salary` for each player. `detail` returns the same salary plus `salaryImpact`. `card.salaryMinor` equals the primary amount for compatibility.
- For free players, only the selected card's persisted complete auto-build (`allocationJson`, `maxOverall`, `algorithmVersion`) is quoteable. For owned players, use `LeaguePlayerOwnership.salaryMinor`, `maxOverallSnapshot`, and `salaryRuleVersionId`; current-tier comparison uses the same snapshot overall.

- [ ] **Step 1: Write failing query tests** for free/owned/unavailable salary states, two leagues with different tiers, snapshot versus current tier, fallback card with no stored auto-build, and list/detail salary equality. Assert existing paging, filters, owner privacy and actions remain intact.
- [ ] **Step 2: Write failing detail impact tests** for free purchase, forced transfer, own player, null team cap and over-cap delta. Assert one aggregate query for the current team and no per-player rule fetch on a list page.
- [ ] **Step 3: Run red** with explicit local URL: `DATABASE_URL='mysql://efm:efm_local@127.0.0.1:3307/efootball_verify' pnpm --filter @efm/api test --runInBand src/player-market/player-market-query.service.spec.ts`.
- [ ] **Step 4: Implement market mapping and detail impact** in `player-market-query.service.ts`. Keep existing market actions and approval flow unchanged. If no reliable quote, return a reason rather than inferred overall or 0. For owned player without active rule, keep actual salary and `currentTier: null`.
- [ ] **Step 5: Run green** for query tests and `pnpm --filter @efm/api typecheck`, each API test command with explicit local test `DATABASE_URL`.
- [ ] **Step 6: Commit only Task 3 files.**

### Task 4: 小程序联赛内工资展示

**Files:**
- Modify: `apps/miniprogram/miniprogram/pages/player-market/player-market.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/player-market/player-market.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/player-market/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/player-market/player-market.template.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/player-market-detail/player-market-detail.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/player-market-detail/player-market-detail.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/player-market-detail/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/player-market-detail/index.wxss`

**Interfaces:**
- Consume `item.salary` and `detail.salaryImpact` from Tasks 1–3. View models return `salaryLabel`, `salaryValue`, optional `currentTierLabel`, and `salaryImpact` presentation strings. They never compute a salary from total rating or rule tiers.
- Preserve current amount input, application submission and force-sign behavior. A projected over-cap amount adds a warning and does not itself disable submission.

- [ ] **Step 1: Write failing Vitest cases** for free “预计签入工资”, owned “实际工资”, different current tier, unavailable reason, null cap, over-cap delta, and a label that distinguishes purchase/forced price from salary. Assert generic `player-card-detail` remains free of salary labels.
- [ ] **Step 2: Run red.** `pnpm --filter @efm/miniprogram test -- player-market.viewmodel.spec.ts player-market-detail.viewmodel.spec.ts player-market.template.spec.ts`；新增断言应失败。
- [ ] **Step 3: Implement view models and WXML/WXSS** with responsive wrapping. Show current salary and projected total in detail and composer; note “以审核时结果为准”. Keep salary out of external player cards.
- [ ] **Step 4: Run green.** Re-run focused Vitest plus `pnpm --filter @efm/miniprogram typecheck`. In微信开发者工具预览窄屏和常见手机宽度，检查列表和详情中的金额、外框、正常态及禁用态按钮；记录无法执行的设备验收。
- [ ] **Step 5: Commit only Task 4 files.**

### Task 5: 回归、环境验收与交付

**Files:**
- Modify only tests or implementation that fail because of this feature; do not add unrelated changes.

**Interfaces:**
- No new public interface. This task verifies contract/API/client agreement and the required existing entrances.

- [ ] **Step 1: Reinspect the local isolated database** `efootball_verify` on Docker MySQL at `127.0.0.1:3307`; verify host and database before further test commands. Use `DATABASE_URL='mysql://efm:efm_local@127.0.0.1:3307/efootball_verify'` explicitly on every API test command. Never use the shared `.env` URL.
- [ ] **Step 2: Run scoped regressions.** Run `pnpm --filter @efm/contracts test`; with explicit local test `DATABASE_URL`, run API salary quote, `player-market-query.service.spec.ts`, and `player-market-review.service.spec.ts`; run `pnpm --filter @efm/admin-web test -- teams-page.spec.tsx team-detail-page.spec.tsx player-market-review-page.spec.tsx`; run `pnpm --filter @efm/miniprogram test -- player-market.viewmodel.spec.ts player-market-detail.viewmodel.spec.ts player-market.template.spec.ts team-assets.viewmodel.spec.ts leagues.page.spec.ts`. Investigate and fix failures introduced by this change. Check test-created records are gone in the isolated DB.
- [ ] **Step 3: Run repo typecheck/build** and report any unrelated baseline failures from concurrent work separately. No production migration is expected because the Prisma schema is unchanged.
- [ ] **Step 4: On the target environment, read-only check** `pnpm db:status`, current rule, market list and detail API responses, and mini client parsing for one league; compare against a second league with different tiers if available. Do not seed or mutate shared data. State any target checks that could not be performed.
- [ ] **Step 5: Review the final diff, commit only feature fixes, and summarize** changed files, exact test results, device preview coverage and remaining target-environment limitations.
