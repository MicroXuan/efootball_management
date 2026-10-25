# CELL Preseason Readiness and Rating Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在开赛前阻止不合规阵容，并让最新自动加点数值通过预览和确认更新工资及伯德标签。

**Architecture:** 独立只读阵容校验服务供后台和赛程发布事务调用；工资预览与确认共享最新自动加点总评和伯德报价规则，确认沿用现有幂等事务。

**Tech Stack:** NestJS、Prisma、Zod、React、Jest、Vitest。

**Spec:** `docs/superpowers/specs/2026-10-24-cell-preseason-readiness-and-rating-refresh.zh-CN.md`

## Global Constraints

- `dev` 分支，不新建功能分支；已有未提交改动保留。
- API 测试显式指定本机隔离 `DATABASE_URL`，库名包含 `verify`；共享库不写入测试数据。
- 不覆盖已经配置的 CELL 七档工资；不自动处理线下管理员操作。

## Review Focus

- 仅已批准且现役球队进入开赛检查；非现役球员不能满足 16 人或 GK 要求。
- 后台预览和赛程发布事务使用同一规则；并发变更时发布事务复查。
- 首次发布失败后赛季、组别、参赛阵容快照都保持原样。
- 最新自动加点缺失时不使用卡片标称总评推算工资。
- 伯德基准随归属保留，数值下降取消折扣；跨队交易已有的重置规则继续有效。

---

### Task 1: 开赛阵容校验

**Files:** 新 `apps/api/src/competitions/season-roster-readiness.service.ts`、`schedules.service.ts`、`schedules.controller.ts`、模块、契约、后台赛程页和测试。

**Interfaces:** `SeasonRosterReadinessService.evaluate(client, seasonId)` 返回逐队结果及 `ready`；`assertReady(client, seasonId)` 在赛程发布事务中调用。

- [ ] 写人数、GK、工资帽和发布拦截测试，确认失败。
- [ ] 实现只读接口、事务内复查和后台展示，运行测试。

### Task 2: 数值变化预览与确认

**Files:** `salary-recalculation.service.ts`、`salary-rules.service.ts`、`admin-rosters.controller.ts`、工资规则后台页、契约及测试。

**Interfaces:** 新只读预览返回球员旧新总评与工资、伯德优惠及球队合计；现有重算请求在事务内读取最新自动加点并更新归属快照。

- [ ] 写上涨、下降、缺失自动加点、伯德和工资帽预览测试，确认失败。
- [ ] 实现预览、确认及后台入口，运行测试和受影响回归。

### Task 3: 验证与交付

- [ ] 本机隔离库执行 API 测试；复测后台现役/已退出球队、详情和小程序“我的联赛”。
- [ ] 类型检查、构建、差异检查；核对本机测试数据清理。
- [ ] 记录目标环境迁移和接口验收状态，不把本地通过视为线上通过。
