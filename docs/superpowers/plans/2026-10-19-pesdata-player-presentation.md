# PESDATA Player Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make position suitability and ability colors match PESDATA while preserving the existing ratings and automatic-build calculations.

**Architecture:** Keep all classification logic in the player-detail view model and expose semantic tone names to WXML. CSS owns the exact PESDATA colors; the primary-position outline remains an independent modifier.

**Tech Stack:** TypeScript, native WeChat Mini Program WXML/WXSS, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-player-presentation-and-season-fixtures-design.md`

## Global Constraints

- `PositionHot` index order is exactly `GK, CB, LB, RB, DMF, CMF, LMF, RMF, AMF, LWF, RWF, SS, CF`.
- Position hotness `3` uses `#07c160`; `2` uses `rgba(7, 193, 96, 0.40)`; `1`, missing, malformed, or out-of-range values are neutral.
- Ability bands are `<70 #ff0000`, `70-79 #ffe600`, `80-89 #22ff00`, and `>=90 #00efff`.
- Ability tones use the displayed post-build value; bars cap at 100 without changing the displayed number.
- Preserve unrelated working-tree changes and do not redesign the radar or player-card layout.

## Review Focus

- `PositionHot` values supplied as whitespace-padded numeric strings must classify identically to numbers; Task 1 pins this.
- A short, missing, or non-array `PositionHot` must leave every unknown cell neutral without hiding its rating; Task 1 pins this.
- Automatic-build deltas that cross 69/70, 79/80, or 89/90 must change both value and tone; Task 1 pins this.
- Values above 100 must remain visible while the bar width is exactly 100; Task 1 pins this.
- The primary outline must not replace strong, partial, or neutral backgrounds; Task 2 pins this.

---

### Task 1: PESDATA Tone Classification

**Files:**
- Modify: `apps/miniprogram/miniprogram/pages/player-card-detail/detail.viewmodel.ts`
- Test: `apps/miniprogram/miniprogram/pages/player-card-detail/detail.viewmodel.spec.ts`

**Interfaces:**
- Consumes: `PlayerCardDetail.attributes.sourceMetadata.PositionHot` or `PlayerCardDetail.attributes.positionHot`, whichever imported field is already present after canonical metadata normalization.
- Produces: exported `AbilityTone = 'red' | 'yellow' | 'green' | 'cyan'`, `PositionSuitabilityTone = 'strong' | 'partial' | 'neutral'`, `abilityTone(value: number): AbilityTone`, and presentation rows using those tone types.

- [ ] **Step 1: Write failing boundary and normalization tests**

Add tests named `uses PESDATA ability bands at every boundary`, `uses post-build values for ability tones and caps only bar width`, and `maps numeric and whitespace PositionHot values by PESDATA index`. Assert exact tones at `69`, `70`, `79`, `80`, `89`, and `90`; assert `104` displays as `104` with width `100`; and assert `3`, `' 2 '`, `1`, missing, malformed, and short arrays map to `strong`, `partial`, or `neutral` without changing ratings.

- [ ] **Step 2: Run the focused tests and verify red**

Run: `pnpm --filter @efm/miniprogram test -- miniprogram/pages/player-card-detail/detail.viewmodel.spec.ts`

Expected: FAIL because the current view model exposes only `elite/standard` and derives position tones from ratings.

- [ ] **Step 3: Implement the classifiers and presentation mapping**

In `detail.viewmodel.ts`, add the exact index map and safe numeric normalization. Change attribute tone calculation to `abilityTone(value)` after deltas, and change position tone calculation to read `PositionHot` independently from the calculated/imported `rating`. Keep `isPrimary` independent.

- [ ] **Step 4: Run the focused tests and verify green**

Run: `pnpm --filter @efm/miniprogram test -- miniprogram/pages/player-card-detail/detail.viewmodel.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/miniprogram/miniprogram/pages/player-card-detail/detail.viewmodel.ts apps/miniprogram/miniprogram/pages/player-card-detail/detail.viewmodel.spec.ts
git commit -m "feat: match PESDATA player tone bands"
```

### Task 2: Render Exact PESDATA Colors

**Files:**
- Modify: `apps/miniprogram/miniprogram/pages/player-card-detail/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/player-card-detail/index.wxss`
- Test: `apps/miniprogram/miniprogram/pages/player-card-detail/player-card-detail.template.spec.ts`

**Interfaces:**
- Consumes: `AbilityTone` and `PositionSuitabilityTone` strings from Task 1 through `presentation.attributes[*].tone` and `presentation.positions[*].tone`.
- Produces: `tone-red/yellow/green/cyan` ability classes and `tone-strong/partial/neutral` position classes with exact spec colors.

- [ ] **Step 1: Write failing template/style assertions**

Assert that attribute numbers and fills receive `tone-{{item.tone}}`, the old `90+ 高亮` copy is replaced with PESDATA band copy, position cells retain the separate `is-primary` class, and WXSS contains the four exact ability colors plus the solid/translucent position greens.

- [ ] **Step 2: Run the template test and verify red**

Run: `pnpm --filter @efm/miniprogram test -- miniprogram/pages/player-card-detail/player-card-detail.template.spec.ts`

Expected: FAIL on the new class and color assertions.

- [ ] **Step 3: Update WXML and WXSS**

Bind the semantic tone class to both the ability value and fill. Replace old position heat-map classes with strong/partial/neutral backgrounds, use dark text on solid green, and retain `.is-primary` as an outline-only modifier.

- [ ] **Step 4: Verify the complete player-detail surface**

Run: `pnpm --filter @efm/miniprogram test -- miniprogram/pages/player-card-detail/detail.viewmodel.spec.ts miniprogram/pages/player-card-detail/player-card-detail.template.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/miniprogram/miniprogram/pages/player-card-detail/index.wxml apps/miniprogram/miniprogram/pages/player-card-detail/index.wxss apps/miniprogram/miniprogram/pages/player-card-detail/player-card-detail.template.spec.ts
git commit -m "style: render PESDATA player colors"
```
