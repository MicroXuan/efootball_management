# 轻量待办中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 增加跨联赛轻量待办中心，并把交易、强报、拍卖状态接入“我的”、联赛工作台及底部角标。

**Architecture:** API 从现有球队、申请、拍卖数据实时投影统一待办，不新增持久化表。小程序通过单一服务加载待办，在本地保存已读版本；待办页面只汇总和深链，所有操作仍在球员市场或拍卖大厅完成。

**Tech Stack:** NestJS、Prisma、Zod contracts、原生微信小程序 TypeScript/WXML/WXSS、Jest/Vitest。

**Spec:** `docs/superpowers/specs/2026-10-15-action-center.md`

## Global Constraints

- 保持 `球员 / 联赛 / 我的` 三个底部 Tab，不新增第四项。
- 不新增数据库表，不复制现有业务操作表单。
- 待办只做状态投影、角标与深链跳转。
- 本地已读不改变服务端业务状态；需处理事项始终计入角标。
- 不创建 PR。

## Review Focus

- 用户没有有效联赛球队时，API 返回空列表且页面不报错。
- 同一用户跨多个联赛时，待办必须携带正确联赛、赛季、球队路由参数。
- 用户既是强报发起方又是被强报球队时，不得生成重复待办。
- 已读状态只能隐藏状态更新角标，不能隐藏仍需处理事项。
- API 或部分数据为空时，底部 Tab、个人页和联赛详情不能被待办加载拖垮。

---

### Task 1: 统一待办契约与 API 投影

**Files:**
- Create: `packages/contracts/src/action-center.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`
- Create: `apps/api/src/action-center/action-center.service.ts`
- Create: `apps/api/src/action-center/action-center.service.spec.ts`
- Create: `apps/api/src/action-center/action-center.controller.ts`
- Create: `apps/api/src/action-center/action-center.controller.spec.ts`
- Create: `apps/api/src/action-center/action-center.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Produces: `ActionCenterResponse`, `GET /me/action-center`。

- [ ] **Step 1: Write failing contract and service/controller tests**
- [ ] **Step 2: Run focused tests and verify failures are caused by missing action-center code**
- [ ] **Step 3: Implement schemas, service projection, authenticated controller and module wiring**
- [ ] **Step 4: Run focused tests and typecheck until green**
- [ ] **Step 5: Commit `feat: add action center api`**

### Task 2: 小程序待办服务、已读模型与页面

**Files:**
- Create: `apps/miniprogram/miniprogram/services/action-center.ts`
- Create: `apps/miniprogram/miniprogram/services/action-center.spec.ts`
- Create: `apps/miniprogram/miniprogram/pages/action-center/action-center.viewmodel.ts`
- Create: `apps/miniprogram/miniprogram/pages/action-center/action-center.viewmodel.spec.ts`
- Create: `apps/miniprogram/miniprogram/pages/action-center/index.ts`
- Create: `apps/miniprogram/miniprogram/pages/action-center/index.wxml`
- Create: `apps/miniprogram/miniprogram/pages/action-center/index.wxss`
- Create: `apps/miniprogram/miniprogram/pages/action-center/index.json`
- Create: `apps/miniprogram/miniprogram/pages/action-center/action-center.template.spec.ts`
- Modify: `apps/miniprogram/miniprogram/app.json`
- Modify: `apps/miniprogram/miniprogram/pages/player-market/index.ts`

**Interfaces:**
- Consumes: `ActionCenterResponse`, `GET /me/action-center`。
- Produces: `loadActionCenter`, `actionCenterView`, 本地已读版本和 `/pages/action-center/index`。

- [ ] **Step 1: Write failing service, view-model and template tests**
- [ ] **Step 2: Run focused tests and verify RED**
- [ ] **Step 3: Implement fetch, read-state projection, grouped page and deep links**
- [ ] **Step 4: Run focused tests and miniprogram typecheck until green**
- [ ] **Step 5: Commit `feat: add miniprogram action center`**

### Task 3: 个人页、联赛工作台与底部角标接入

**Files:**
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/profile/profile.page.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/profile/profile.template.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/league-detail.template.spec.ts`
- Modify: `apps/miniprogram/miniprogram/custom-tab-bar/index.ts`
- Modify: `apps/miniprogram/miniprogram/custom-tab-bar/index.wxml`
- Modify: `apps/miniprogram/miniprogram/custom-tab-bar/index.wxss`
- Modify: `apps/miniprogram/miniprogram/custom-tab-bar/tabbar.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/custom-tab-bar/tabbar.viewmodel.spec.ts`

**Interfaces:**
- Consumes: `loadActionCenter`, 本地已读状态及 `/pages/action-center/index`。
- Produces: 个人页汇总入口、当前联赛角标、底部“我的”角标。

- [ ] **Step 1: Write failing profile, league and tab-bar behavior tests**
- [ ] **Step 2: Run focused tests and verify RED**
- [ ] **Step 3: Implement resilient badge loading and action-center navigation**
- [ ] **Step 4: Run miniprogram tests and typecheck until green**
- [ ] **Step 5: Commit `feat: surface action center badges`**

### Task 4: 全量验证与审查

**Files:**
- Modify only if a verified defect is found.

**Interfaces:**
- Consumes: Tasks 1-3 implementation.
- Produces: verified branch state without PR creation.

- [ ] **Step 1: Run relevant package suites, root typecheck, lint and build**
- [ ] **Step 2: Review the full diff against the spec and Review Focus cases**
- [ ] **Step 3: Fix any Critical/Important finding through RED→GREEN**
- [ ] **Step 4: Record final verification evidence; do not create a PR**
