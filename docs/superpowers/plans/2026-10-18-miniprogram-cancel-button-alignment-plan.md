# Mini Program Cancel Button Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Center the nickname editor’s cancel-button label horizontally and vertically in the WeChat mini program.

**Architecture:** This is an isolated native WXSS correction. It deliberately remains separate from the synchronization redesign because it has no shared interfaces or state.

**Tech Stack:** Native WeChat Mini Program WXML/WXSS, TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-10-18-checkpointed-data-sync-redesign.zh-CN.md` section 11

## Global Constraints

- Do not change nickname editing behavior, copy, dimensions of the action row, or the primary save button’s visual hierarchy.
- Verify in the WeChat renderer; Vitest does not render WXML/WXSS layout.

## Review Focus

- Disabled state must remain centered and readable.
- The retry page’s shared `.outline-button` must not regress.
- Long system font metrics on iOS and Android must not shift vertical centering.
- The primary save button must retain equal height with cancel.
- Native `button::after` borders must remain disabled.

---

### Task 1: Scope the centering rule to nickname editor actions

**Files:**
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.wxss`
- Verify: `apps/miniprogram/miniprogram/pages/profile/index.wxml`

**Interfaces:**
- Produces a scoped selector for `.nickname-editor__actions .outline-button` and `.nickname-editor__actions .primary-button` with `box-sizing: border-box`, `display: flex`, `align-items: center`, `justify-content: center`, fixed shared `min-height: 88rpx`, and normalized padding/line-height.

- [ ] **Step 1: Capture the current visual failure**

Open the profile nickname editor in WeChat Developer Tools at the same viewport as the supplied screenshot and retain a before screenshot showing the cancel label above center.

- [ ] **Step 2: Apply the scoped WXSS correction**

Add only the properties in Interfaces to the nickname action selector. Do not globally change `.outline-button`, because it is also used by the retry state.

- [ ] **Step 3: Run static verification**

Run: `pnpm --filter @efm/miniprogram typecheck && pnpm --filter @efm/miniprogram test`

Expected: both commands exit 0.

- [ ] **Step 4: Verify native rendering**

In WeChat Developer Tools, verify cancel and save labels are centered at normal and disabled states, both buttons have equal height, and the retry button is unchanged. Capture an after screenshot.

- [ ] **Step 5: Commit**

```bash
git add apps/miniprogram/miniprogram/pages/profile/index.wxss
git commit -m "fix: center profile cancel button label"
```
