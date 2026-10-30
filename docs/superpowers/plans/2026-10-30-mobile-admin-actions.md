# Mobile Admin Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 手机工作台办理转会、裁定晋级并完成窄屏优化。
**Architecture:** 复用现有转会 API 与晋级领域服务，新增聚焦的手机操作组件；既有比分和审核保持可用。
**Tech Stack:** React, Ant Design, Zod, NestJS, Vitest, Jest, Playwright.
**Spec:** docs/superpowers/specs/2026-10-30-mobile-admin-actions-design.md

## Global Constraints
- dev 分支，保留现存未提交修改，不自动提交其他工作。
- API 单元测试显式 DATABASE_URL=mysql://root@127.0.0.1:3306/efm_test；模拟测试不运行真实数据库清理钩子。
- 不写共享数据库，无新增数据库模型。
- 320/375/390px 验证，保留正常态、禁用态及弹窗检查。

## Review Focus
- 联赛/赛季/球队切换的迟到响应不能污染提交。
- 双击、网络不确定重试保持同一幂等键，编辑后换键。
- 晋级应算已处理结果，只有淘汰赛有入口。
- 空阵容、关闭转会窗口、加载失败和超长名字有清晰状态。
- 底部导航/键盘/弹窗不挡操作，等宽选项与按钮不越界。

### Task 1: 晋级 API 和结果识别
Files: contracts competition.ts; API results.controller.ts/results.service.ts; mobile-data.ts.
Interfaces: POST admin/leagues/:leagueId/competitions/:id/matches/:matchId/advancement, input winnerParticipantId/reason/expectedVersion, response winnerParticipantId/winnerName.
- [x] 写失败测试：权限、可见性、事务锁/幂等及已晋级过滤。
- [x] 运行失败测试，再实现受保护接口并复用 applyAdministratorAdvancement。
- [x] 运行单元测试和类型检查。

### Task 2: 手机转会和晋级编辑器
Files: mobile-transfer.tsx/mobile-advancement.tsx/mobile-workbench.tsx and specs.
Interfaces: 编辑器接收联赛、赛季或比赛快照；onSaved 触发刷新。
- [x] 写失败测试：先核对再提交，错误重试、双击、状态切换。
- [x] 实现球队/阵容分页加载，必填原因，窗口提示，金额与权限校验；接入转会和比赛卡片。
- [x] 跑手机组件测试，复测比分、转会审核。

### Task 3: 响应式和验收
Files: mobile.css; scripts/mobile-browser-check.mjs; docs/development/mobile-admin-workbench.zh-CN.md.
- [x] 改善表单、操作卡、底部导航及移动弹窗布局。
- [x] 在浏览器用 mock API 验收 320/375/390/768px，并检查正常/禁用态、长文案与边界。
- [x] 跑后台受影响回归、小程序我的联赛/球队详情、类型与构建。
- [x] 最后独立审查并修复发现的问题，记录目标环境未验收范围。

## Ledger
Ruling: 用户已明确要求直接实施，计划不再重复请求批准；遵守 dev 分支约束，不另建 worktree。

Task 1: complete — 受保护晋级接口及赛果过滤，失败测试先验证，再通过相关 API 测试。
Task 2: complete — 转会/晋级编辑器、重试/锁定/窗口/金额/切换回归通过。
Task 3: complete — 手机浏览器 4 宽度验收、后台源码 276、小程序 11、API 15 项及类型/构建通过。
Review: 独立审查无阻断项；P3 比分专属错误提示已改成通用比赛结果提示。
Ruling: 顶层 Vitest 捕获其他工作的 Node 发布脚本，因此限定 src 跑完所有后台源码测试，保留原脚本不动。
Target acceptance: 未部署；真实 API 和真实手机键盘未验收。没有数据库测试记录需要清理。

Regression fix: 768px 宽度缩短到 420px 高度时默认 Modal 顶距遮挡提交按钮；统一手机工作台弹窗顶距，4 宽度短视口重新验收通过。
