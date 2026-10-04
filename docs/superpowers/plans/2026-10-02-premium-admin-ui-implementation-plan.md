# Premium Admin Web UI Implementation Plan

> **Required sub-skill:** Use `superpowers:test-driven-development` for each implementation task and `superpowers:verification-before-completion` before claiming completion.

**Goal:** 将管理后台升级为深色导航框架 + 浅色数据工作区的专业中文赛事控制台，解决未选中菜单不可见、绿色文字泛滥、卡片边界弱和赛季入口不清晰的问题。

**Architecture:** 保留 React + Ant Design 页面结构，在应用层增加集中主题配置、少量自有 SVG 图标和可测试的赛季轨道模型。重写重复冲突的全局样式为语义变量与明确的 shell/page/component 层级，业务请求、路由、权限和表单提交逻辑保持原样。

**Tech Stack:** React 19、TypeScript、Vite、Ant Design 6、Vitest、Testing Library、CSS。

**Spec:** `docs/superpowers/specs/2026-10-01-premium-football-ui-redesign-design.zh-CN.md`

**Supersedes:** `docs/superpowers/plans/2026-10-01-admin-ui-style-iteration-implementation-plan.md`

## Global Constraints

- 不修改 API、数据库、鉴权、权限判定、路由地址和表单数据结构。
- 不安装新 UI、字体、图标或动画依赖；图标使用本地轻量 SVG。
- 侧栏未选中项必须使用高对比灰白文字；绿色仅用于当前项标记、主操作和关键状态。
- 数据工作区保持浅色；卡片边缘必须通过背景、边框与极轻阴影共同建立层级。
- 正文对比度目标至少 4.5:1，大字号与次级视觉至少 3:1；所有交互必须有键盘焦点样式。
- 1440px、1024px、768px 宽度均需可用；窄屏不得通过隐藏关键操作来换取布局。
- 不引入全屏模糊、背景视频或大尺寸装饰图片。

## Review Focus

1. 侧栏所有未选中菜单在普通显示器与低亮度下仍能清楚辨认。
2. 联赛卡片、数据表、筛选区和表单分组有明确但克制的边界与圆角。
3. 联赛详情中的当前赛季入口、阶段与下一步操作一眼可见。
4. 长联赛名、无徽标、无当前赛季、取消赛季和空表格均不会破坏布局。
5. 桌面、平板及键盘操作下保持完整导航、焦点和反馈。

---

## Task 1: 集中主题、字体与样式基础

**Files:**

- Create: `apps/admin-web/src/design-system/theme.ts`
- Create: `apps/admin-web/src/design-system/theme.spec.ts`
- Modify: `apps/admin-web/src/app.tsx`
- Rewrite: `apps/admin-web/src/styles.css`

**Interfaces:**

```ts
import type { ThemeConfig } from 'antd'

export const premiumAdminTheme: ThemeConfig
export const adminSemanticColors: Readonly<{
  sidebar: string
  sidebarSelected: string
  navText: string
  navMuted: string
  workspace: string
  surface: string
  text: string
  textSecondary: string
  border: string
  accent: string
}>
```

- [ ] Write a failing theme test for the approved semantic colors, 10–14px component radii, primary text, control height, focus color and system font stack.
- [ ] Run `pnpm --filter @efm/admin-web test -- theme.spec.ts` and confirm it fails because theme values are currently embedded in `app.tsx`/CSS.
- [ ] Implement `premiumAdminTheme` and make `ConfigProvider` consume it.
- [ ] Replace the duplicated legacy blocks in `styles.css` with one ordered system: reset/tokens, shell, shared components, pages, responsive rules.
- [ ] Define Chinese system-font fallback and tabular numeric styling; do not load a webfont.
- [ ] Remove green body/menu copy, excessive pill controls and contradictory card rules.
- [ ] Run the focused test, all admin tests and typecheck.
- [ ] Commit: `feat(admin): establish premium control-room theme`

## Task 2: 重建后台外壳、导航与页面标题层级

**Files:**

- Create: `apps/admin-web/src/design-system/icons.tsx`
- Create: `apps/admin-web/src/design-system/icons.spec.tsx`
- Modify: `apps/admin-web/src/app.tsx`
- Modify: `apps/admin-web/src/league-shell.tsx`
- Modify: `apps/admin-web/src/league-shell.spec.tsx`
- Modify: `apps/admin-web/src/auth-shell.spec.tsx`
- Modify: `apps/admin-web/src/styles.css`

**Interfaces:**

```ts
export type AdminIconName = 'league' | 'administrators' | 'audit' | 'teams' | 'seasons'

export function AdminIcon(props: {
  name: AdminIconName
  decorative?: boolean
}): React.ReactElement
```

- [ ] Add failing tests asserting visible Chinese navigation labels, selected-page semantics, league sub-navigation, and decorative SVG accessibility behavior.
- [ ] Run `pnpm --filter @efm/admin-web test -- league-shell.spec.tsx auth-shell.spec.tsx icons.spec.tsx` and confirm the new assertions fail.
- [ ] Build consistent 18px stroke-style local SVG icons without external assets.
- [ ] Rework the sidebar with readable inactive text, restrained selected surface, a 3px accent marker, clear section caption and stable hover/focus feedback.
- [ ] Rework the top bar/page header into eyebrow, H1, supporting copy and action cluster; remove green text as the primary hierarchy device.
- [ ] Make league sub-navigation explicit and preserve current routes and authorization checks.
- [ ] Add responsive behavior: collapsible/narrow sidebar at tablet width, wrapped action cluster, no clipped page title.
- [ ] Run focused tests, all admin tests and typecheck.
- [ ] Commit: `feat(admin): rebuild navigation and page hierarchy`

## Task 3: 建立可复用赛季轨道并强化当前赛季入口

**Files:**

- Create: `apps/admin-web/src/components/season-rail.model.ts`
- Create: `apps/admin-web/src/components/season-rail.tsx`
- Create: `apps/admin-web/src/components/season-rail.spec.tsx`
- Modify: `apps/admin-web/src/seasons-page.tsx`
- Modify: `apps/admin-web/src/seasons-page.spec.tsx`
- Modify: `apps/admin-web/src/league-workspace-page.tsx`
- Modify: `apps/admin-web/src/league-workspace-page.spec.tsx`
- Modify: `apps/admin-web/src/styles.css`

**Interfaces:**

```ts
export type SeasonRailItem = {
  key: 'registration' | 'confirmation' | 'schedule' | 'settlement'
  label: string
  state: 'complete' | 'current' | 'upcoming' | 'cancelled'
}

export function createSeasonRail(status: LeagueSeasonStatus): SeasonRailItem[]

export function SeasonRail(props: {
  status: LeagueSeasonStatus
  compact?: boolean
}): React.ReactElement
```

- [ ] Write failing model/render tests for DRAFT, REGISTRATION_OPEN, ALLOCATION_REVIEW, READY, IN_PROGRESS, COMPLETED and CANCELLED; require `aria-current="step"` on the current stage.
- [ ] Add failing page tests for a visible “进入当前赛季” action when a current season exists and a clear empty-state action when it does not.
- [ ] Run the focused specs and confirm the assertions fail.
- [ ] Implement the pure season-status mapping and an ordered-list-based accessible rail.
- [ ] Place the rail in the league workspace summary and season page without changing season transitions or API payloads.
- [ ] Make current season name, state, participation count and primary next action visually dominant; keep historical seasons secondary.
- [ ] Treat cancellation as a neutral/danger state, never as a completed green state.
- [ ] Run focused tests, all admin tests and typecheck.
- [ ] Commit: `feat(admin): surface current season journey`

## Task 4: 深化平台、联赛、球队与赛季工作区

**Files:**

- Modify: `apps/admin-web/src/platform-leagues-page.tsx`
- Modify: `apps/admin-web/src/platform-leagues-page.spec.tsx`
- Modify: `apps/admin-web/src/league-form-page.tsx`
- Modify: `apps/admin-web/src/league-form-page.spec.tsx`
- Modify: `apps/admin-web/src/league-teams-page.tsx`
- Modify: `apps/admin-web/src/league-teams-page.spec.tsx`
- Modify: `apps/admin-web/src/platform-admins-page.tsx`
- Modify: `apps/admin-web/src/platform-admins-page.spec.tsx`
- Modify: `apps/admin-web/src/audit-logs-page.tsx`
- Modify: `apps/admin-web/src/audit-logs-page.spec.tsx`
- Modify: `apps/admin-web/src/login-page.tsx`
- Modify: `apps/admin-web/src/styles.css`

- [ ] Add failing tests for long league names, logo fallback, no-current-season state, row/card primary actions, form error visibility and empty tables.
- [ ] Run the focused page specs and confirm the new assertions fail.
- [ ] Rebuild league cards with 14px radius, visible neutral border, subtle elevation, protected logo box, restrained edition badge and a full-width action hierarchy.
- [ ] Use white cards on `#F2F5F7`; separate cards with space and border rather than neon outlines.
- [ ] Rework tables and filters with visible column hierarchy, compact status badges, readable inactive pagination and stable empty/loading areas.
- [ ] Rework forms into labeled sections with 44px+ controls, explicit required/error/help text and distinct primary/secondary/destructive actions.
- [ ] Ensure team, administrator and audit pages share the same title, filter, table and drawer/modal language.
- [ ] Run focused tests, all admin tests and typecheck.
- [ ] Commit: `feat(admin): polish league operations workspace`

## Task 5: 响应式、可访问性与视觉验收

**Files:**

- Modify: `apps/admin-web/src/styles.css`
- Modify: affected `apps/admin-web/src/*.spec.tsx` files only where verification exposes missing semantics
- Modify: `docs/superpowers/specs/2026-10-01-premium-football-ui-redesign-design.zh-CN.md` only if implementation reveals an approved, necessary clarification

- [ ] Run `pnpm --filter @efm/admin-web test`.
- [ ] Run `pnpm --filter @efm/admin-web typecheck`.
- [ ] Run `pnpm --filter @efm/admin-web build`.
- [ ] Inspect platform leagues, league workspace, seasons, teams, admins, audit logs, login and forms at 1440px, 1024px and 768px.
- [ ] Keyboard-test sidebar, tabs, filters, tables, modals and forms; verify focus rings never disappear on the light workspace or dark sidebar.
- [ ] Test long Chinese/English names, missing logos, empty/loading/error states, every season status and dense table data.
- [ ] Use browser computed styles or an accessibility checker to verify the specified text contrast targets; adjust semantic tokens, not one-off page colors.
- [ ] Record before/after screenshots for the platform league list, league workspace/current season, team table and one form.
- [ ] Score the implementation against point of view, typography, restrained color, breathing hierarchy and imagery intent; no category may be below 9/10 without documenting the remaining gap.
- [ ] Commit: `test(admin): verify premium control-room ui`

## Plan Self-Review

- The plan directly addresses every reported defect: green text, invisible menu items, weak card edges, non-rounded league cards, cheap typography and unclear season entry.
- Theme and CSS cleanup happen before page work, preventing another layer of conflicting overrides.
- The season rail is a pure, tested presentation model shared by the two relevant admin views.
- Route, permission, API and mutation behavior remain outside scope.
- Automated tests verify semantics and edge states; manual review verifies visual hierarchy, responsiveness, typography and contrast.
