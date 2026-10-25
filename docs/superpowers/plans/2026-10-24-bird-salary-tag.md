# Bird Salary Tag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在工资优惠实际生效的现役球员上显示“伯德”标签。

**Architecture:** 归属记录保存入队总评和优惠状态；统一工资报价函数处理低一档；所有变更归属、换卡和工资重算入口更新这两个字段。资产接口返回标签，小程序映射中文。

**Tech Stack:** Prisma、NestJS、Zod、微信小程序、Jest。

**Spec:** `docs/superpowers/specs/2026-10-24-bird-salary-tag-design.zh-CN.md`

## Global Constraints

- 只在 `dev` 修改代码；API 测试显式使用本机库名含 `verify` 的 `DATABASE_URL`。
- 目标环境先迁移后部署；不得对共享库写入测试数据。

## Review Focus

- 最低工资档或相邻档金额相等：不显示伯德标签。
- 强报时新球队工资上限按恢复后的正常工资判断。
- 归属发生转移或下放重购：旧球队优惠不可继承。
- 工资版本更新：重算与预览保持伯德折扣一致。
- 固B与伯德可同时显示；非现役不显示伯德。

---

### Task 1: 归属工资基准与报价

**Files:** `apps/api/prisma/schema.prisma`、新迁移、`apps/api/src/league-rosters/salary-quote.ts`、`salary-rules.service.ts`、对应测试。

**Interfaces:** `quoteWithClient(..., at, birdBaselineOverall?)` 与 `quoteVersionWithClient(..., overall, birdBaselineOverall?)` 返回 `birdDiscountApplied`。

- [ ] 写前一档、最低档、等价档报价测试并确认失败。
- [ ] 添加字段、迁移和报价实现；本地隔离库迁移后验证测试通过。

### Task 2: 交易与工资重算

**Files:** `roster-transactions.service.ts`、`salary-recalculation.service.ts`、`player-market-review.service.ts`、对应测试。

**Interfaces:** 入队和跨队设置基准为当前总评；同队换卡保持基准；工资重算保留基准并重算优惠。

- [ ] 写上涨、降级、转会、强报、重购、重算回归测试并确认失败。
- [ ] 更新所有工资和归属写入口，验证用例通过。

### Task 3: 资产标签与回归

**Files:** `packages/contracts/src/league-economy.ts`、`apps/api/src/league-economy/team-assets.service.ts`、`apps/miniprogram/miniprogram/pages/team-assets/team-assets.viewmodel.ts`、对应测试。

**Interfaces:** `tags` 增加 `BIRD`，小程序显示“伯德”。

- [ ] 写本人、公开、双标签、非现役测试并确认失败。
- [ ] 实现展示，执行受影响入口与构建验证。
