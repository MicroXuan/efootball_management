# 微信小程序 UI 风格迭代实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将微信原生小程序统一为全暗色、全中文、荧光绿强调和大圆角的沉浸式足球界面，并保持现有业务行为与轻量加载特性。

**Architecture:** 在 `app.wxss` 建立共享设计变量和通用表面规则，以少量原生公共组件承载页面标题、数据胶囊、状态面板和自定义 TabBar。按公共组件、列表页、详情页、表单页分批迁移现有 WXML/WXSS；ViewModel 和 API 服务保持稳定，新增导航行为只通过可测试的纯函数决定选中状态。

**Tech Stack:** 微信原生小程序、WXML、WXSS、TypeScript、Vitest

**Spec:** `docs/superpowers/specs/2026-10-01-football-ui-style-iteration-design.zh-CN.md`

## Global Constraints

- 小程序使用 `#0A0A0A` 页面背景、`#171917` 一级卡片、`#20231F` 二级卡片、`#B0FF00` 品牌主色和 `#F7F8F5` 主文字。
- 所有固定界面文案必须使用中文；外部球员名和卡片原始名称不强制翻译。
- 可见矩形容器优先使用圆角矩形；只有分隔线、球场线、时间线和表格行边界保留直线。
- 不修改 API、鉴权、页面业务状态、表单提交和 ViewModel 数据契约。
- 不新增第三方 UI、字体或动画依赖，不增加大型装饰图片。
- 辉光仅用于当前状态和主要操作；普通卡片不得全部发光。
- 动效控制在 150–220ms，不使用持续循环动画或高成本全屏模糊。
- 保留球员、联赛、我的三个一级导航入口，并适配底部安全区。
- 使用 Node 24：`export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`。

## Review Focus

- iPhone 小屏、长中文标题和英文球员名必须正确截断或换行，不能撑破圆角卡片（Tasks 3–5 视觉验收）。
- 无头像、无队徽、无球员图和无联赛 Logo 时必须显示稳定占位，不产生布局跳动（Tasks 3–5 现有 ViewModel 测试与视觉验收）。
- 自定义 TabBar 在冷启动进入三个一级页面、从二级页面返回和重复点击当前项时必须保持正确选中态（Task 2 测试）。
- 底部操作栏和自定义 TabBar 必须同时适配安全区，不能互相遮挡（Tasks 2、5 视觉验收）。
- 加载、空、失败、无权限和禁用状态必须有中文说明及下一步操作，且不能只依赖颜色表达（Tasks 1、3–5 视觉验收）。

---

### Task 1: 全局视觉变量与公共状态组件

**Files:**
- Modify: `apps/miniprogram/miniprogram/app.wxss`
- Modify: `apps/miniprogram/miniprogram/app.json`
- Create: `apps/miniprogram/miniprogram/components/page-heading/index.json`
- Create: `apps/miniprogram/miniprogram/components/page-heading/index.ts`
- Create: `apps/miniprogram/miniprogram/components/page-heading/index.wxml`
- Create: `apps/miniprogram/miniprogram/components/page-heading/index.wxss`
- Create: `apps/miniprogram/miniprogram/components/data-pill/index.json`
- Create: `apps/miniprogram/miniprogram/components/data-pill/index.ts`
- Create: `apps/miniprogram/miniprogram/components/data-pill/index.wxml`
- Create: `apps/miniprogram/miniprogram/components/data-pill/index.wxss`
- Modify: `apps/miniprogram/miniprogram/components/loading-state/index.wxml`
- Modify: `apps/miniprogram/miniprogram/components/loading-state/index.wxss`

**Interfaces:**
- Produces: 继承式 `--efm-*` 色彩、字号、圆角、间距、边框和阴影变量。
- Produces: `<page-heading title="..." context="..." badge="..." />`，所有属性为中文可见文本。
- Produces: `<data-pill label="..." tone="default|active|warning|danger" />`。
- Produces: 中文、圆角、无持续动画的 `<loading-state label="..." />`。
- Produces: 在 `app.json` 全局注册 `page-heading`、`data-pill` 和现有 `loading-state`，页面无需重复声明。

- [ ] **Step 1: 记录公共组件的视觉验收样例**

在任务记录中固定四个样例：“球员档案 / 球员资料”“当前赛季”“DT 总评 93”“数据加载失败，请重新加载”，并将规范中的精确颜色和圆角作为实现验收值。

- [ ] **Step 2: 建立全局设计变量和基础类**

在 `app.wxss` 写入规范色板、字体栈、页面边距、圆角、数据胶囊、状态卡、按钮、输入框和减少动态效果规则；不得引入外部资源。

- [ ] **Step 3: 实现页面标题与数据胶囊组件**

组件只负责展示，不读取路由、不请求数据、不包含业务判断；`tone` 只映射规范中的语义颜色。

- [ ] **Step 4: 更新加载状态组件**

移除持续旋转或持续发光效果，使用静态足球标识、短时进入动画和中文加载说明。

- [ ] **Step 5: 运行小程序类型检查与现有测试**

Run: `pnpm --filter @efm/miniprogram typecheck && pnpm --filter @efm/miniprogram test`

Expected: 17 个现有测试文件全部 PASS，TypeScript 退出码为 0。

- [ ] **Step 6: 提交本任务**

```bash
git add apps/miniprogram/miniprogram/app.json apps/miniprogram/miniprogram/app.wxss apps/miniprogram/miniprogram/components
git commit -m "style(miniprogram): establish dark football design system"
```

### Task 2: 原生自定义圆角底部导航

**Files:**
- Modify: `apps/miniprogram/miniprogram/app.json`
- Create: `apps/miniprogram/miniprogram/custom-tab-bar/index.json`
- Create: `apps/miniprogram/miniprogram/custom-tab-bar/index.ts`
- Create: `apps/miniprogram/miniprogram/custom-tab-bar/index.wxml`
- Create: `apps/miniprogram/miniprogram/custom-tab-bar/index.wxss`
- Create: `apps/miniprogram/miniprogram/custom-tab-bar/navigation.ts`
- Create: `apps/miniprogram/miniprogram/custom-tab-bar/navigation.spec.ts`
- Reuse: `apps/miniprogram/miniprogram/assets/icons/*.png`

**Interfaces:**
- Produces: `TAB_ITEMS: ReadonlyArray<{ pagePath: string; text: string; iconPath: string; selectedIconPath: string }>`，文本依次为“球员”“联赛”“我的”。
- Produces: `selectedTabForRoute(route: string): number`，精确匹配三个一级页面，未知路径固定返回 `0`。
- Produces: 原生 `custom-tab-bar`，点击后调用 `wx.switchTab`，当前项不重复跳转。

- [ ] **Step 1: 写导航选中逻辑的失败测试**

覆盖 `/pages/players/index → 0`、`/pages/leagues/index → 1`、`/pages/profile/index → 2`、无前导斜杠、未知路径和三个一级导航的中文标签。

- [ ] **Step 2: 运行测试并确认正确失败**

Run: `pnpm --filter @efm/miniprogram test -- custom-tab-bar/navigation.spec.ts`

Expected: FAIL，因为导航模块尚不存在。

- [ ] **Step 3: 实现纯导航模型**

实现 `TAB_ITEMS` 和 `selectedTabForRoute(route: string): number`，不得引用微信全局对象，以便独立测试。

- [ ] **Step 4: 实现原生自定义 TabBar**

在组件生命周期读取当前页面路由，点击时更新选中态并调用 `wx.switchTab`；外层为悬浮深色圆角容器，选中项为荧光绿胶囊，适配底部安全区。

- [ ] **Step 5: 开启自定义 TabBar 并运行验证**

Run: `pnpm --filter @efm/miniprogram test -- custom-tab-bar/navigation.spec.ts && pnpm --filter @efm/miniprogram typecheck && pnpm --filter @efm/miniprogram build`

Expected: PASS；`app.json` 保留原三个 pagePath 并启用自定义模式。

- [ ] **Step 6: 提交本任务**

```bash
git add apps/miniprogram/miniprogram/app.json apps/miniprogram/miniprogram/custom-tab-bar
git commit -m "feat(miniprogram): add rounded custom tab bar"
```

### Task 3: 列表页视觉迁移

**Files:**
- Modify: `apps/miniprogram/miniprogram/pages/players/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/players/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/leagues/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/leagues/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/competitions/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/competitions/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/my-league-teams/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/my-league-teams/index.wxss`
- Test: existing ViewModel specs beside each page

**Interfaces:**
- Consumes: Task 1 的 `page-heading`、`data-pill` 和全局状态卡规则。
- Produces: 统一标题区、搜索与筛选胶囊、横向信息卡、卡片网格和中文空错误状态。
- Preserves: 搜索、防抖、筛选、分页、重试、页面跳转和 ViewModel 输出。

- [ ] **Step 1: 运行五个列表页 ViewModel 测试建立行为基线**

Run: `pnpm --filter @efm/miniprogram test -- players.viewmodel.spec.ts leagues.viewmodel.spec.ts competitions.viewmodel.spec.ts matches.viewmodel.spec.ts my-league-teams.viewmodel.spec.ts`

Expected: PASS。

- [ ] **Step 2: 迁移球员列表**

使用中文页面标题、圆角搜索框、位置和卡片类型筛选胶囊；保留三列球员卡网格，将错误、空和加载状态接入共享表面。

- [ ] **Step 3: 迁移联赛与我的球队列表**

将联赛品牌、当前赛季、我的球队、版本和参赛状态组织为圆角横向卡片；图片缺失时保留固定尺寸占位。

- [ ] **Step 4: 迁移赛事与我的比赛列表**

保留时间线含义但将事件主体改为圆角卡片；比分、报名、状态、日期和席位使用数据胶囊，所有固定文案改为中文。

- [ ] **Step 5: 运行列表页测试、类型检查和构建**

Run: `pnpm --filter @efm/miniprogram test -- players.viewmodel.spec.ts leagues.viewmodel.spec.ts competitions.viewmodel.spec.ts matches.viewmodel.spec.ts my-league-teams.viewmodel.spec.ts && pnpm --filter @efm/miniprogram typecheck && pnpm --filter @efm/miniprogram build`

Expected: PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add apps/miniprogram/miniprogram/pages/players apps/miniprogram/miniprogram/pages/leagues apps/miniprogram/miniprogram/pages/competitions apps/miniprogram/miniprogram/pages/my-matches apps/miniprogram/miniprogram/pages/my-league-teams
git commit -m "style(miniprogram): redesign discovery lists"
```

### Task 4: 详情页与球员卡组件视觉迁移

**Files:**
- Modify: `apps/miniprogram/miniprogram/components/player-card/index.wxml`
- Modify: `apps/miniprogram/miniprogram/components/player-card/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/player-card-detail/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/player-card-detail/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/league-team-detail/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/league-team-detail/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/competition-detail/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/competition-detail/index.wxss`
- Test: existing detail ViewModel specs

**Interfaces:**
- Consumes: Tasks 1、3 的共享组件与列表卡片语言。
- Produces: 圆角沉浸式头部、关键数据胶囊、分组信息卡和稳定图片占位。
- Preserves: 卡片跳转、赛季选择、报名状态、赛事权限、赛程与积分展示。

- [ ] **Step 1: 运行详情页 ViewModel 测试建立行为基线**

Run: `pnpm --filter @efm/miniprogram test -- miniprogram/pages/player-card-detail/detail.viewmodel.spec.ts miniprogram/pages/league-detail/detail.viewmodel.spec.ts miniprogram/pages/league-team-detail/league-team-detail.viewmodel.spec.ts miniprogram/pages/competition-detail/detail.viewmodel.spec.ts`

Expected: 四个详情测试文件全部 PASS。

- [ ] **Step 2: 迁移球员卡与球员详情**

球员卡使用大圆角、固定图片比例、评分胶囊和更清晰的名称层级；详情页使用沉浸式头部、能力数据胶囊、技能胶囊和同球员其他卡片列表。

- [ ] **Step 3: 迁移联赛与球队详情**

使用联赛或球队 Logo 构建圆角品牌区；赛季概览、阵容人数、工资和参赛状态使用共享数据胶囊。

- [ ] **Step 4: 迁移赛事详情**

将报名、规则、赛程、积分和管理员操作分组为独立圆角卡片；保持原权限和操作按钮状态。

- [ ] **Step 5: 运行详情测试、全量小程序测试和类型检查**

Run: `pnpm --filter @efm/miniprogram test && pnpm --filter @efm/miniprogram typecheck`

Expected: PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add apps/miniprogram/miniprogram/components/player-card apps/miniprogram/miniprogram/pages/player-card-detail apps/miniprogram/miniprogram/pages/league-detail apps/miniprogram/miniprogram/pages/league-team-detail apps/miniprogram/miniprogram/pages/competition-detail
git commit -m "style(miniprogram): refine football detail views"
```

### Task 5: 登录、个人中心、表单与管理页视觉迁移

**Files:**
- Modify: `apps/miniprogram/miniprogram/pages/login/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/login/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/match-result/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/match-result/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/competition-manage/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/competition-manage/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/competition-editor/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/competition-editor/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/league-editor/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/league-editor/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/season-manage/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/season-manage/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/team-profile/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/team-profile/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/game-account-edit/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/game-account-edit/index.wxss`
- Test: existing page ViewModel specs

**Interfaces:**
- Consumes: Task 1 的标题、状态、表单、按钮和圆角表面规则。
- Produces: 统一的中文登录页、个人身份页、分组表单卡和安全区吸底操作栏。
- Preserves: 微信登录、复制编号、结果提交、赛事编辑、赛季操作、球队资料和账号编辑逻辑。

- [ ] **Step 1: 运行相关 ViewModel 测试建立行为基线**

Run: `pnpm --filter @efm/miniprogram test -- profile.viewmodel.spec.ts result.viewmodel.spec.ts editor.viewmodel.spec.ts manage.viewmodel.spec.ts team-profile.viewmodel.spec.ts`

Expected: PASS；若同名文件匹配多个目录，保留全部匹配结果。

- [ ] **Step 2: 迁移登录与个人中心**

删除英文栏目眉题和楷体；登录页使用 CSS 球场纹理、圆角登录面板和中文隐私说明，个人中心使用圆角身份卡、用户编号胶囊和球队卡。

- [ ] **Step 3: 迁移比赛结果与赛事管理编辑页**

将比分、平局确认、发布状态、赛程操作和规则字段分成圆角表单卡；主要操作进入安全区吸底操作栏。

- [ ] **Step 4: 迁移联赛、赛季、球队资料和账号编辑页**

统一返回按钮、字段标签、选择器、输入框、上传区、错误状态和保存按钮；危险操作与保存操作分区。

- [ ] **Step 5: 运行相关测试、全量小程序测试和构建**

Run: `pnpm --filter @efm/miniprogram test && pnpm --filter @efm/miniprogram typecheck && pnpm --filter @efm/miniprogram build`

Expected: PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add apps/miniprogram/miniprogram/pages/login apps/miniprogram/miniprogram/pages/profile apps/miniprogram/miniprogram/pages/match-result apps/miniprogram/miniprogram/pages/competition-manage apps/miniprogram/miniprogram/pages/competition-editor apps/miniprogram/miniprogram/pages/league-editor apps/miniprogram/miniprogram/pages/season-manage apps/miniprogram/miniprogram/pages/team-profile apps/miniprogram/miniprogram/pages/game-account-edit
git commit -m "style(miniprogram): unify forms and member pages"
```

### Task 6: 小程序视觉、性能与完整回归验收

**Files:**
- Modify: only the WXML/WXSS file that owns a defect found during review
- Modify: `apps/miniprogram/miniprogram/app.wxss` only for genuinely shared fixes
- Modify: `apps/miniprogram/miniprogram/custom-tab-bar/*` only for navigation defects

**Interfaces:**
- Consumes: Tasks 1–5 的完整小程序界面。
- Produces: 通过小屏、常规屏、长内容、安全区和状态覆盖检查的最终小程序。

- [ ] **Step 1: 在微信开发者工具中检查代表页面**

覆盖登录、球员列表、联赛列表、赛事列表、球员详情、联赛详情、个人中心、比赛结果和至少一个编辑页；分别检查小屏与常规手机宽度。

- [ ] **Step 2: 检查状态与边界输入**

检查无图片、超长中英文名称、空列表、加载失败、无权限、禁用操作、底部安全区、吸底操作栏和 TabBar 同时存在的页面。

- [ ] **Step 3: 修复验收发现的最小视觉问题**

只修改问题所属 WXML/WXSS 或导航组件；不得改变 ViewModel、服务或接口契约。

- [ ] **Step 4: 运行小程序完整验证**

Run: `pnpm --filter @efm/miniprogram lint && pnpm --filter @efm/miniprogram typecheck && pnpm --filter @efm/miniprogram test && pnpm --filter @efm/miniprogram build`

Expected: 全部测试 PASS，类型检查和构建退出码为 0。

- [ ] **Step 5: 检查资源和依赖变化**

Run: `git diff -- apps/miniprogram/package.json pnpm-lock.yaml && find apps/miniprogram/miniprogram/assets -type f -maxdepth 3 -print`

Expected: 没有新增运行时依赖、在线字体或大型装饰图片；导航继续复用本地图标。

- [ ] **Step 6: 运行仓库完整验证**

Run: `set -a; source ./.env; set +a; pnpm verify`

Expected: lint、类型检查、单测、E2E 和构建全部退出码为 0。

- [ ] **Step 7: 提交本任务**

```bash
git add apps/miniprogram
git commit -m "test(miniprogram): verify dark visual refresh"
```
