# Premium Mini Program UI Implementation Plan

> **Required sub-skill:** Use `superpowers:test-driven-development` for each implementation task and `superpowers:verification-before-completion` before claiming completion.

**Goal:** 将小程序升级为“赛事日精密感”的全暗色中文足球管理产品，强化联赛—赛季主路径、信息层级与品牌质感，同时保持现有数据、路由和业务流程不变。

**Architecture:** 在现有原生微信小程序结构内建立轻量视觉基础层，通过页面局部注册的原生组件复用实体图像、状态徽标和赛季轨道。展示逻辑继续放在纯 view-model 中，页面只负责渲染与交互，服务层和接口契约保持不变。

**Tech Stack:** 原生微信小程序、TypeScript、WXML、WXSS、Node.js test runner、pnpm。

**Spec:** `docs/superpowers/specs/2026-10-01-premium-football-ui-redesign-design.zh-CN.md`

**Supersedes:** `docs/superpowers/plans/2026-10-01-miniprogram-ui-style-iteration-implementation-plan.md`

## Global Constraints

- 不修改 API、数据库、鉴权、比赛规则、现有页面路由和数据含义。
- 不增加 UI 框架、字体包、动画库或远程装饰素材；保留系统中文字体栈。
- 只在重要状态和主操作使用荧光绿；正文、说明、未选中导航不得使用绿色。
- 使用真实联赛徽标、球员图片和已有业务素材；缺图时显示稳定、可识别的文字回退。
- 触控目标不小于 44pt；正文对比度目标至少 4.5:1。
- 动效仅使用 opacity/transform，时长 150–220ms，并尊重 `prefers-reduced-motion` 能力边界。
- 本计划完成前，不删除或重命名历史计划与设计文档。

## Review Focus

1. 长中文/英文联赛名不会顶破卡片、赛季轨道或底部导航。
2. 缺少徽标、球员图片、说明文字时仍有明确层级和稳定布局。
3. 所有赛季状态（含取消）都映射到正确的轨道和状态色，不改变业务含义。
4. 联赛列表保持整卡单一点击目标，不制造卡片内嵌套点击冲突。
5. iPhone 安全区、375px 小屏、大屏手机和横屏下均无内容遮挡。

---

## Task 1: 建立小程序视觉基础层

**Files:**

- Modify: `apps/miniprogram/miniprogram/app.wxss`
- Modify: `apps/miniprogram/miniprogram/app.json`
- Modify: `apps/miniprogram/miniprogram/custom-tab-bar/index.wxml`
- Modify: `apps/miniprogram/miniprogram/custom-tab-bar/index.wxss`
- Create: `apps/miniprogram/miniprogram/design-system/design-contract.spec.ts`
- Create: `apps/miniprogram/miniprogram/components/entity-artwork/index.json`
- Create: `apps/miniprogram/miniprogram/components/entity-artwork/index.ts`
- Create: `apps/miniprogram/miniprogram/components/entity-artwork/index.wxml`
- Create: `apps/miniprogram/miniprogram/components/entity-artwork/index.wxss`
- Create: `apps/miniprogram/miniprogram/components/status-badge/index.json`
- Create: `apps/miniprogram/miniprogram/components/status-badge/index.ts`
- Create: `apps/miniprogram/miniprogram/components/status-badge/index.wxml`
- Create: `apps/miniprogram/miniprogram/components/status-badge/index.wxss`

**Interfaces:**

```ts
type EntityArtworkProperties = {
  src: string
  fallback: string
  shape: 'square' | 'portrait'
}

type StatusBadgeProperties = {
  label: string
  tone: 'accent' | 'info' | 'warning' | 'muted' | 'danger'
}
```

- [ ] Write a failing contract test that reads `app.wxss` and asserts the approved semantic colors, layered radii, tab safe-area padding, and absence of blanket `999rpx !important` rounding.
- [ ] Run `pnpm --filter @efm/miniprogram test -- design-contract.spec.ts` and confirm it fails for the current legacy tokens.
- [ ] Replace global hard-coded visual overrides with named CSS custom properties for background, raised surfaces, strong/weak borders, primary/secondary/muted text, accent and on-accent text.
- [ ] Update native navigation and tab-bar colors without changing tab labels or tab routes.
- [ ] Implement `entity-artwork` with fixed aspect ratio, `mode="aspectFit"` for badges, `mode="aspectFill"` for portraits, image-error fallback, and no layout shift.
- [ ] Implement `status-badge` as a compact rounded rectangle; only accent/current states use the bright accent treatment.
- [ ] Run the focused test and all current mini-program tests.
- [ ] Commit: `feat(miniprogram): establish premium visual primitives`

## Task 2: 重做联赛列表、详情与赛季轨道

**Files:**

- Modify: `apps/miniprogram/miniprogram/pages/leagues/index.json`
- Modify: `apps/miniprogram/miniprogram/pages/leagues/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/leagues/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/leagues/leagues.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/leagues/leagues.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/index.json`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/detail.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/league-detail/detail.viewmodel.spec.ts`
- Create: `apps/miniprogram/miniprogram/components/season-rail/index.json`
- Create: `apps/miniprogram/miniprogram/components/season-rail/index.ts`
- Create: `apps/miniprogram/miniprogram/components/season-rail/index.wxml`
- Create: `apps/miniprogram/miniprogram/components/season-rail/index.wxss`

**Interfaces:**

```ts
export type SeasonRailStep = {
  key: 'registration' | 'confirmation' | 'schedule' | 'settlement'
  label: '报名' | '确认' | '赛程' | '结算'
  state: 'complete' | 'current' | 'upcoming' | 'cancelled'
}

export function seasonRailSteps(status: LeagueSeasonStatus): SeasonRailStep[]
```

- [ ] Add failing view-model tests for all season statuses, cancelled handling, long league names, missing logo fallback, and current-season entry copy.
- [ ] Run `pnpm --filter @efm/miniprogram test -- leagues.viewmodel.spec.ts detail.viewmodel.spec.ts` and confirm the new assertions fail.
- [ ] Implement the pure status-to-rail mapping; do not derive or mutate business state in WXML.
- [ ] Rebuild league cards as clearly separated rounded rectangles with strong border, restrained shadow, large logo area, two-line title clamp, description, current-season summary, state badge and one directional affordance.
- [ ] Keep the entire league card as the only list action. Do not add a separately tappable season control inside the list card.
- [ ] Rebuild league detail around identity header, explicit “进入当前赛季” primary action, season rail, season switcher, and existing team/fixture/standing content.
- [ ] Make “进入当前赛季” move focus/scroll to the existing selected-season content instead of introducing a new route.
- [ ] Locally register `entity-artwork`, `status-badge`, and `season-rail` only on pages that use them.
- [ ] Run the focused tests and all mini-program tests.
- [ ] Commit: `feat(miniprogram): clarify league and season journey`

## Task 3: 统一球员、赛事、比赛与球队浏览页面

**Files:**

- Modify: `apps/miniprogram/miniprogram/pages/players/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/players/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/player-card-detail/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/player-card-detail/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/competitions/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/competitions/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/competition-detail/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/competition-detail/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/match-result/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/match-result/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/my-league-teams/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/my-league-teams/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/league-team-detail/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/league-team-detail/index.wxss`
- Create: `apps/miniprogram/miniprogram/design-system/registered-pages-visual-contract.spec.ts`

- [ ] Write a failing static contract test that checks all registered discovery/detail pages use the shared semantic page shell classes and contain no legacy accent hex values in body-copy rules.
- [ ] Run `pnpm --filter @efm/miniprogram test -- registered-pages-visual-contract.spec.ts` and confirm it identifies the unconverted pages.
- [ ] Apply the new title ladder, muted metadata, bordered cards, predictable 16/20/24 spacing rhythm, image clear-space and clipped media corners.
- [ ] Preserve player-card information density but make rating, position, name and card series readable in that order.
- [ ] Make filters segmented rounded rectangles rather than adjacent borderless text; selected state must remain readable without relying on color alone.
- [ ] Keep empty/loading/error components stable in height to avoid content jump.
- [ ] Run the focused test and all mini-program tests.
- [ ] Commit: `feat(miniprogram): unify football discovery surfaces`

## Task 4: 统一管理、表单、登录与个人页面

**Files:**

- Modify: `apps/miniprogram/miniprogram/pages/competition-manage/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/competition-manage/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/competition-editor/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/competition-editor/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/login/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/login/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.wxss`
- Modify: `apps/miniprogram/miniprogram/components/loading-state/index.wxml`
- Modify: `apps/miniprogram/miniprogram/components/loading-state/index.wxss`

- [ ] Add/extend existing page or view-model tests for disabled submit, validation error, loading, empty and signed-out labels before changing styles.
- [ ] Run the relevant focused specs and confirm new state assertions fail where behavior is not exposed accessibly.
- [ ] Restyle forms with visible labels, 48–52px control height, strong focus/error boundaries and a single dominant submit action.
- [ ] Convert destructive and secondary actions to bordered or text treatments; never reuse the bright green fill for destructive actions.
- [ ] Align login/profile/management pages to the same surface, radius and typography hierarchy without changing submission logic.
- [ ] Ensure keyboard focus, validation text and loading copy remain visible against the dark background.
- [ ] Run all mini-program tests.
- [ ] Commit: `feat(miniprogram): polish management and account states`

## Task 5: 全面验证与视觉验收

**Files:**

- Modify: `apps/miniprogram/miniprogram/design-system/design-contract.spec.ts`
- Modify: `apps/miniprogram/miniprogram/design-system/registered-pages-visual-contract.spec.ts`
- Modify: `docs/superpowers/specs/2026-10-01-premium-football-ui-redesign-design.zh-CN.md` only if implementation reveals an approved, necessary clarification

- [ ] Extend the visual contract test to scan all files registered in `app.json` for deprecated colors, unsafe full-pill card rules, and missing dark page backgrounds.
- [ ] Run `pnpm --filter @efm/miniprogram test`.
- [ ] Run `pnpm --filter @efm/miniprogram typecheck`.
- [ ] Open the project in 微信开发者工具 and verify players, competitions, leagues, league detail, matches, management, login and profile flows at 375px, a large phone preset and landscape.
- [ ] Verify safe-area padding, long names, missing images, every season status, empty/loading/error states, pressed/disabled/focus feedback and no nested tappable league controls.
- [ ] Record before/after screenshots for the league list, league detail/current season, player list and one form page.
- [ ] Compare the result against the five approved quality criteria and record scores in the implementation handoff; no score may be below 9/10 without documenting the remaining gap.
- [ ] Commit: `test(miniprogram): verify premium ui system`

## Plan Self-Review

- Scope is limited to presentation and presentation-only view models; no service or route rewrite is planned.
- Every new reusable component has a precise input contract and a local registration strategy.
- The league list avoids nested actions; the explicit season entry lives on the detail page.
- Automated checks cover token drift, registered-page coverage, missing artwork and season status mapping.
- Manual checks cover the visual qualities that unit tests cannot prove: hierarchy, texture, density, responsiveness and safe areas.
