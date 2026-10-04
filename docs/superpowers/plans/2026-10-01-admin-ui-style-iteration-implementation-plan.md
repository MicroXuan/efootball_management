# 管理后台 UI 风格迭代实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将管理后台改造成“深色导航框架 × 浅色数据工作区”的全中文圆角界面，同时保持现有业务行为、可读性和加载性能。

**Architecture:** 以 Ant Design `ConfigProvider` 主题 Token 和 `styles.css` 中的语义化 CSS 变量为唯一视觉基础，不引入新的 UI 或动画依赖。先统一登录页与应用框架，再按平台页、联赛页、阵容交易页逐批迁移，最后通过完整自动验证和真实浏览器截图完成视觉验收。

**Tech Stack:** React 19、TypeScript、Ant Design 6、React Router、Vite、Vitest、Testing Library、CSS

**Spec:** `docs/superpowers/specs/2026-10-01-football-ui-style-iteration-design.zh-CN.md`

## Global Constraints

- 后台采用 `#0A0A0A` 深色侧边栏、`#F3F5F1` 浅色工作区、`#FFFFFF` 内容卡片和 `#B0FF00` 品牌主色。
- 所有固定界面文案必须使用中文；`DT 总评` 等业务缩写必须搭配中文含义。
- 可见矩形容器优先使用圆角矩形；只有分隔线、球场线和表格行边界保留直线。
- 不修改 API、权限、路由、表单提交、错误处理和业务数据契约。
- 不新增 UI 框架、在线字体、动画库或大型装饰图片。
- 保留现有页面懒加载；动效仅使用 150–220ms 的颜色、透明度和小范围位移。
- 桌面内容最大宽度约 1440px；低于 1100px 时双栏工作区切换为单栏。
- 使用 Node 24：`export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`。

## Review Focus

- 只有联赛权限、没有平台权限的管理员仍能看到全部已授权联赛，但不能看到平台管理入口（Task 2 测试）。
- 1100px 附近的双栏页面必须切换为单栏，表格允许横向滚动而不是压坏内容（Tasks 3–5 浏览器验收）。
- 超长联赛名、球队名、球员名和管理员名必须截断或换行，不能挤出圆角卡片（Tasks 2–5 浏览器验收）。
- 错误、警告、禁用和版本冲突状态必须保留原语义色及可见说明，不能全部变成品牌绿（Tasks 3–5 现有交互测试）。
- 键盘用户必须能看见导航、按钮、输入框、标签页和表格操作的焦点状态（Task 6 浏览器验收）。

---

### Task 1: 全局主题、登录页与视觉基础

**Files:**
- Modify: `apps/admin-web/src/app.tsx`
- Modify: `apps/admin-web/src/styles.css`
- Modify: `apps/admin-web/src/auth/login-page.tsx`
- Modify: `apps/admin-web/src/auth/auth-shell.spec.tsx`

**Interfaces:**
- Produces: Ant Design 主题 Token，包含 `colorPrimary = #B0FF00`、`colorBgLayout = #F3F5F1`、`colorBgContainer = #FFFFFF`、`colorText = #171A17`、`colorBorder = #DDE2D9`、`borderRadius = 12`、`borderRadiusLG = 18` 和统一系统字体栈。
- Produces: `styles.css` 中的 `--efm-*` 后台视觉变量、圆角表面、焦点态和减少动态效果规则。
- Produces: 全中文、深色品牌区配浅色圆角面板的登录页。

- [ ] **Step 1: 写登录页中文界面的失败测试**

在 `auth-shell.spec.tsx` 增加 `使用全中文文案呈现登录界面`，断言“赛事管理后台”“管理员账号”“密码”“登录后台”可见，并断言装饰性英文 `CONTROL / 01` 与 `EFOOTBALL LEAGUE OPERATIONS` 不再出现。

- [ ] **Step 2: 运行测试并确认正确失败**

Run: `pnpm --filter @efm/admin-web test -- auth-shell.spec.tsx`

Expected: FAIL，因为登录页仍包含英文装饰文案。

- [ ] **Step 3: 配置主题 Token 与全局 CSS 变量**

在 `app.tsx` 更新 `ConfigProvider`，在 `styles.css` 建立规范中的后台色板、字号、圆角、表面、焦点和 `prefers-reduced-motion` 规则。不得添加外部字体或运行时依赖。

- [ ] **Step 4: 重构登录页视觉与中文文案**

保留现有表单字段、登录行为和错误逻辑；将左侧球场品牌区、右侧登录卡、输入框和按钮改为规范中的圆角布局，删除楷体和英文眉题。

- [ ] **Step 5: 运行登录页测试、类型检查和构建**

Run: `pnpm --filter @efm/admin-web test -- auth-shell.spec.tsx && pnpm --filter @efm/admin-web typecheck && pnpm --filter @efm/admin-web build`

Expected: PASS；Vite 构建不新增远程字体或图片请求。

- [ ] **Step 6: 提交本任务**

```bash
git add apps/admin-web/src/app.tsx apps/admin-web/src/styles.css apps/admin-web/src/auth/login-page.tsx apps/admin-web/src/auth/auth-shell.spec.tsx
git commit -m "style(admin): establish hybrid football theme"
```

### Task 2: 应用框架、侧边栏与联赛工作区导航

**Files:**
- Modify: `apps/admin-web/src/app.tsx`
- Modify: `apps/admin-web/src/styles.css`
- Modify: `apps/admin-web/src/leagues/league-shell.tsx`
- Modify: `apps/admin-web/src/leagues/league-shell.spec.tsx`

**Interfaces:**
- Consumes: Task 1 的主题 Token 与 `--efm-*` 变量。
- Produces: 深色圆角侧边栏、浅色圆角顶部状态栏、响应式主内容容器和中文联赛分段导航。
- Preserves: `ApplicationShell`、`DefaultRoute`、`PlatformRoute` 的权限与路由行为。

- [ ] **Step 1: 写角色导航与中文标签的失败测试**

扩展 `league-shell.spec.tsx`，断言联赛管理员可看到每个授权联赛、“用户与球队”“赛季管理”“工资规则”“转会窗口”“财务流水”，看不到平台专属入口，也不再出现 `LEAGUE WORKSPACE`。

- [ ] **Step 2: 运行测试并确认正确失败**

Run: `pnpm --filter @efm/admin-web test -- league-shell.spec.tsx`

Expected: FAIL，因为现有工作区仍显示英文眉题。

- [ ] **Step 3: 重构应用壳层结构和中文文案**

为品牌、导航分组、管理员身份、顶部状态栏和内容容器增加语义类名；保留现有链接、选中判断、退出逻辑和懒加载边界。

- [ ] **Step 4: 将联赛标签页改为圆角分段导航**

保持 `Tabs` 的路由链接与 activeKey 逻辑不变，只调整中文上下文标题、圆角容器、滚动和窄屏行为。

- [ ] **Step 5: 运行框架测试和全量后台测试**

Run: `pnpm --filter @efm/admin-web test -- league-shell.spec.tsx auth-shell.spec.tsx && pnpm --filter @efm/admin-web test`

Expected: PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add apps/admin-web/src/app.tsx apps/admin-web/src/styles.css apps/admin-web/src/leagues/league-shell.tsx apps/admin-web/src/leagues/league-shell.spec.tsx
git commit -m "style(admin): redesign navigation workspace"
```

### Task 3: 平台管理数据页

**Files:**
- Modify: `apps/admin-web/src/styles.css`
- Modify: `apps/admin-web/src/platform/leagues-page.tsx`
- Modify: `apps/admin-web/src/platform/leagues-page.spec.tsx`
- Modify: `apps/admin-web/src/platform/admin-accounts-page.tsx`
- Modify: `apps/admin-web/src/platform/admin-accounts-page.spec.tsx`
- Modify: `apps/admin-web/src/platform/audit-page.tsx`
- Modify: `apps/admin-web/src/platform/audit-page.spec.tsx`

**Interfaces:**
- Consumes: Task 1 的卡片、表格、表单、按钮和数据胶囊规则。
- Produces: 平台页统一的 `page-intro`、`surface-card`、`data-table`、`form-panel` 和 `status-pill` 语义结构。
- Preserves: 创建、编辑、上传、权限分配、密码重置、审计只读和版本冲突行为。

- [ ] **Step 1: 扩展平台页行为测试**

在现有三个测试文件中补充中文页面标题、主要操作名称、错误状态和空状态断言；密码重置仍必须显示“确认重置”，审计页仍不能出现编辑或删除操作。

- [ ] **Step 2: 运行平台页测试建立基线**

Run: `pnpm --filter @efm/admin-web test -- leagues-page.spec.tsx admin-accounts-page.spec.tsx audit-page.spec.tsx`

Expected: 现有业务断言 PASS；新增页面结构或文案断言在实现前 FAIL。

- [ ] **Step 3: 重构联赛管理页布局**

增加中文页面介绍区，将列表与编辑表单放入圆角双栏表面；使用胶囊状态、圆角上传控件和清晰的主次按钮，不改变上传校验和冲突刷新流程。

- [ ] **Step 4: 重构管理员与审计页布局**

统一账号表格、创建表单、权限表单、密码弹窗和审计表格的圆角表面、状态标签、操作区与空状态；危险和禁用状态保留语义色。

- [ ] **Step 5: 运行平台页测试、类型检查和构建**

Run: `pnpm --filter @efm/admin-web test -- leagues-page.spec.tsx admin-accounts-page.spec.tsx audit-page.spec.tsx && pnpm --filter @efm/admin-web typecheck && pnpm --filter @efm/admin-web build`

Expected: PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add apps/admin-web/src/styles.css apps/admin-web/src/platform
git commit -m "style(admin): refine platform data pages"
```

### Task 4: 联赛、赛季与规则页面

**Files:**
- Modify: `apps/admin-web/src/styles.css`
- Modify: `apps/admin-web/src/leagues/teams-page.tsx`
- Modify: `apps/admin-web/src/leagues/teams-page.spec.tsx`
- Modify: `apps/admin-web/src/leagues/team-detail-page.tsx`
- Modify: `apps/admin-web/src/leagues/team-detail-page.spec.tsx`
- Modify: `apps/admin-web/src/leagues/seasons-page.tsx`
- Modify: `apps/admin-web/src/leagues/seasons-page.spec.tsx`
- Modify: `apps/admin-web/src/leagues/salary-rules-page.tsx`
- Modify: `apps/admin-web/src/leagues/salary-rules-page.spec.tsx`
- Modify: `apps/admin-web/src/leagues/transfer-windows-page.tsx`
- Modify: `apps/admin-web/src/leagues/transfer-windows-page.spec.tsx`

**Interfaces:**
- Consumes: Tasks 1–2 的应用壳层、圆角表面和分段导航。
- Produces: 联赛工作区统一的双栏页、详情页、规则预览页和数据胶囊。
- Preserves: 用户查找、球队创建、赛季切换、球队报名、工资预览、转会窗口重叠校验和乐观并发行为。

- [ ] **Step 1: 扩展联赛页回归测试**

为五个现有测试文件补充中文标题、主要操作和错误信息断言；保留当前赛季标记、未预选球队、六位用户编号、工资超限预览、窗口重叠和版本冲突断言。

- [ ] **Step 2: 运行联赛页测试建立失败基线**

Run: `pnpm --filter @efm/admin-web test -- teams-page.spec.tsx team-detail-page.spec.tsx seasons-page.spec.tsx salary-rules-page.spec.tsx transfer-windows-page.spec.tsx`

Expected: 新的视觉结构或中文文案断言在实现前 FAIL，既有业务断言保持 PASS。

- [ ] **Step 3: 迁移球队与赛季页面**

将球队列表、用户绑定、球队详情、赛季列表、当前赛季状态和球队报名区迁移到统一圆角模板；关键赛季状态、球队数和版本使用数据胶囊。

- [ ] **Step 4: 迁移工资规则与转会窗口页面**

统一档位表格、工资影响预览、转会窗口列表和编辑表单；输入控件、日期控件、提示与按钮遵循圆角规范，警告继续使用橙色或红色。

- [ ] **Step 5: 运行联赛页测试和后台全量测试**

Run: `pnpm --filter @efm/admin-web test -- teams-page.spec.tsx team-detail-page.spec.tsx seasons-page.spec.tsx salary-rules-page.spec.tsx transfer-windows-page.spec.tsx && pnpm --filter @efm/admin-web test`

Expected: PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add apps/admin-web/src/styles.css apps/admin-web/src/leagues
git commit -m "style(admin): unify league management surfaces"
```

### Task 5: 阵容、交易抽屉与财务流水

**Files:**
- Modify: `apps/admin-web/src/styles.css`
- Modify: `apps/admin-web/src/rosters/roster-page.tsx`
- Modify: `apps/admin-web/src/rosters/roster-page.spec.tsx`
- Modify: `apps/admin-web/src/rosters/acquire-player-drawer.tsx`
- Modify: `apps/admin-web/src/rosters/acquire-player-drawer.spec.tsx`
- Modify: `apps/admin-web/src/rosters/transfer-player-drawer.tsx`
- Modify: `apps/admin-web/src/rosters/transfer-player-drawer.spec.tsx`
- Modify: `apps/admin-web/src/rosters/upgrade-card-drawer.tsx`
- Modify: `apps/admin-web/src/rosters/upgrade-card-drawer.spec.tsx`
- Modify: `apps/admin-web/src/rosters/ledger-page.tsx`
- Modify: `apps/admin-web/src/rosters/ledger-page.spec.tsx`

**Interfaces:**
- Consumes: Task 1 的表格、表单、抽屉、按钮和状态 Token。
- Produces: 统一圆角阵容表、球员候选卡、浅色大圆角抽屉和只读财务流水表面。
- Preserves: 球员归属、工资帽、阵容上限、转会目标排除、卡片推荐、升级禁用和幂等键复用逻辑。

- [ ] **Step 1: 扩展阵容与抽屉回归测试**

在现有测试中补充中文标题、主要操作、推荐状态、工资影响、超限提示和只读流水说明断言；保留所有交易业务断言。

- [ ] **Step 2: 运行阵容测试建立失败基线**

Run: `pnpm --filter @efm/admin-web test -- roster-page.spec.tsx acquire-player-drawer.spec.tsx transfer-player-drawer.spec.tsx upgrade-card-drawer.spec.tsx ledger-page.spec.tsx`

Expected: 新文案或结构断言在实现前 FAIL，业务断言保持 PASS。

- [ ] **Step 3: 迁移阵容页与候选球员卡**

将阵容统计、工资、DT 总评、卡片状态和操作区放入数据胶囊或圆角卡片；表格保持密度和横向滚动能力。

- [ ] **Step 4: 迁移三个交易抽屉与流水页**

为抽屉增加语义类名、圆角边缘、固定操作区和一致表单间距；流水页保持只读并使用清晰的收入、支出和交易类型状态。

- [ ] **Step 5: 运行阵容测试、全量后台测试和构建**

Run: `pnpm --filter @efm/admin-web test -- roster-page.spec.tsx acquire-player-drawer.spec.tsx transfer-player-drawer.spec.tsx upgrade-card-drawer.spec.tsx ledger-page.spec.tsx && pnpm --filter @efm/admin-web test && pnpm --filter @efm/admin-web build`

Expected: PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add apps/admin-web/src/styles.css apps/admin-web/src/rosters
git commit -m "style(admin): polish roster transaction workspace"
```

### Task 6: 响应式、可访问性、性能与视觉验收

**Files:**
- Modify: `apps/admin-web/src/styles.css`
- Modify: `apps/admin-web/src/app.tsx` only if browser review exposes a shell issue
- Modify: affected page file only when the visual defect belongs to that page

**Interfaces:**
- Consumes: Tasks 1–5 的完整后台界面。
- Produces: 通过桌面、1100px 临界宽度和窄屏视觉验收的最终后台。

- [ ] **Step 1: 启动或复用本地后台并检查登录页**

Run: `pnpm --filter @efm/admin-web dev --host 127.0.0.1 --port 4173`

在 1440px、1100px 和 820px 宽度检查圆角、中文文案、焦点态、溢出和减少动态效果。

- [ ] **Step 2: 使用真实管理员会话检查代表页面**

检查平台联赛、管理员、球队、赛季、工资规则、转会窗口、阵容、交易抽屉和财务流水。特别验证超长文本、空列表、错误提示、禁用操作和横向表格滚动。

- [ ] **Step 3: 修复浏览器验收发现的最小视觉问题**

只调整对应语义类名或 CSS；不得借此修改业务逻辑、API 或数据模型。

- [ ] **Step 4: 运行后台完整验证**

Run: `pnpm --filter @efm/admin-web lint && pnpm --filter @efm/admin-web typecheck && pnpm --filter @efm/admin-web test && pnpm --filter @efm/admin-web build`

Expected: 16 个现有测试文件及新增断言全部 PASS，类型检查和生产构建退出码为 0。

- [ ] **Step 5: 检查产物与依赖变化**

Run: `git diff -- apps/admin-web/package.json pnpm-lock.yaml && du -sh apps/admin-web/dist`

Expected: `package.json` 与锁文件无新增运行时依赖；构建产物没有因新字体或装饰图片异常增长。

- [ ] **Step 6: 提交本任务**

```bash
git add apps/admin-web
git commit -m "test(admin): verify responsive visual refresh"
```
