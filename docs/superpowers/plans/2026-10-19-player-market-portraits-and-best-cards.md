# Player Market Portraits and Best Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make market portraits load like catalog portraits and repair/fallback missing best-card selections for fixed zero-level cards.

**Architecture:** Preserve the market query's defensive card selection, add an idempotent explicit repair command around the existing `PlayerBuildsService`, and opt market artwork into direct HTTPS rendering while retaining cloud/local resolution. Data repair and runtime fallback are independent safety layers.

**Tech Stack:** NestJS, Prisma/MariaDB, TypeScript, native WeChat Mini Program, Jest, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-19-player-presentation-and-season-fixtures-design.md`

## Global Constraints

- Do not introduce an image proxy or cloud-storage mirror.
- Direct HTTPS artwork must render without `wx.downloadFile`; cloud IDs and local sources keep their existing resolver.
- Repair only active, published zero-level cards missing an auto-build; the operation must be idempotent.
- Best-card recomputation must use the existing `selectBestCard` ranking and must not replace an existing stronger selection with a weaker card.
- Owned market rows continue to use the owned current card's gameplay values, even when another best-card fallback exists.
- Reconcile and preserve the pre-existing uncommitted edits in `player-market-query.service.ts` and its spec rather than overwriting them.

## Review Focus

- An owned player with no persisted best card must still show the owned current card, not a fallback card; Task 1 pins this.
- A free player with no persisted best card and no derivable card must remain usable with a null card instead of throwing; Task 1 pins this.
- Running repair twice must create one build and one selection and report no second mutation; Task 2 pins this.
- A weaker repaired fixed card must not displace a stronger existing best card; Task 2 pins this.
- A stale asynchronous image resolution must not overwrite a newer `src`, and real image errors must show initials; Task 3 pins this.

---

### Task 1: Defensive Market Card Selection

**Files:**
- Modify: `apps/api/src/player-market/player-market-query.service.ts`
- Test: `apps/api/src/player-market/player-market-query.service.spec.ts`

**Interfaces:**
- Consumes: existing `derivePesdataAutoBuild(...)` and stored `bestCard`/ownership relations.
- Produces: private `fallbackCard(cards)` selection used only when `bestCard` is absent; response shape remains `PlayerMarketListResponse`.

- [ ] **Step 1: Complete failing fallback tests without discarding current edits**

Cover fixed zero-level, trainable, inactive/unpublished, no-derivation, and owned-current-card rows. Assert the highest valid active published fallback is selected using derived/stored max overall and deterministic tie breaks; assert owned rows retain their owned card's `imageUrl`, position, and rating.

- [ ] **Step 2: Run the focused API test and verify red**

Run: `pnpm --filter @efm/api test -- --runInBand src/player-market/player-market-query.service.spec.ts`

Expected: at least one new fallback/ownership assertion fails before implementation is complete.

- [ ] **Step 3: Finish the minimal query fallback**

Fetch candidate cards only for page rows missing `bestCard`; exclude inactive/unpublished cards; use the newest stored build or `derivePesdataAutoBuild` for comparison; and apply fallback only after `ownership?.currentPlayerCard` and `player.bestCard?.playerCard` in the response precedence.

- [ ] **Step 4: Run the focused API test and verify green**

Run: `pnpm --filter @efm/api test -- --runInBand src/player-market/player-market-query.service.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/player-market/player-market-query.service.ts apps/api/src/player-market/player-market-query.service.spec.ts
git commit -m "fix: fall back to valid market player cards"
```

### Task 2: Idempotent Missing-Build Repair

**Files:**
- Create: `apps/api/src/player-builds/player-build-repair.ts`
- Create: `apps/api/src/player-builds/player-build-repair.spec.ts`
- Create: `apps/api/src/player-builds/player-build-repair.cli.ts`
- Modify: `apps/api/package.json`

**Interfaces:**
- Consumes: `PlayerBuildsService.resolveOrDeriveWithClient(client, playerCardId)` and its existing best-card recomputation.
- Produces: `repairMissingPlayerBuilds(prisma: PrismaService, mode: 'dry-run' | 'apply'): Promise<{ candidates: number; repaired: number; skipped: number }>` and script `player-builds:repair -- --dry-run|--apply`.

- [ ] **Step 1: Write failing repair tests**

Create database-backed tests for an active published EPIC card with `maxLevel: 0`, an unpublished card, a card with an existing build, repeated apply, and a player with a stronger existing best card. Assert dry-run writes nothing, apply creates `pesdata-final-card-v1`, repeated apply reports zero repairs, and the stronger selection survives.

- [ ] **Step 2: Run the repair test and verify red**

Run: `pnpm --filter @efm/api test -- --runInBand src/player-builds/player-build-repair.spec.ts`

Expected: FAIL because the repair module does not exist.

- [ ] **Step 3: Implement the repair and guarded CLI**

Select only `status: ACTIVE`, non-null `publishedAt`, no auto-build, and normalized source `maxLevel === 0`. In apply mode process each candidate transactionally through `resolveOrDeriveWithClient`; in dry-run return counts only. Require exactly one of `--dry-run` or `--apply`, following the existing backfill CLI pattern.

- [ ] **Step 4: Verify repair and existing build selection**

Run: `pnpm --filter @efm/api test -- --runInBand src/player-builds/player-build-repair.spec.ts src/player-builds/player-builds.service.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/player-builds/player-build-repair.ts apps/api/src/player-builds/player-build-repair.spec.ts apps/api/src/player-builds/player-build-repair.cli.ts apps/api/package.json
git commit -m "feat: repair missing fixed player builds"
```

### Task 3: Direct HTTPS Market Artwork

**Files:**
- Modify: `apps/miniprogram/miniprogram/components/entity-artwork/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/player-market/index.wxml`
- Test: `apps/miniprogram/miniprogram/components/entity-artwork/index.spec.ts`
- Test: `apps/miniprogram/miniprogram/pages/player-market/player-market.template.spec.ts`
- Modify: `docs/development/local-development.md`

**Interfaces:**
- Consumes: existing `cacheImageSource` for cloud/local sources.
- Produces: `entity-artwork` Boolean property `directHttps`; when true and `src` starts with `https://`, `displaySrc` is the original URL and no download client is invoked.

- [ ] **Step 1: Write failing component and market-template tests**

Assert direct HTTPS sets the original URL synchronously without `wx.downloadFile`, cloud/local sources still resolve, empty sources show fallback, `binderror` switches to fallback, and a late old request cannot replace a newer source. Assert the market passes `directHttps="{{true}}"`.

- [ ] **Step 2: Run focused mini-program tests and verify red**

Run: `pnpm --filter @efm/miniprogram test -- miniprogram/components/entity-artwork/index.spec.ts miniprogram/pages/player-market/player-market.template.spec.ts`

Expected: FAIL because the opt-in property and behavior do not exist.

- [ ] **Step 3: Implement opt-in direct rendering and document deployment**

Add `directHttps`, preserve the requested-source race guard for resolved sources, and leave fallback handling on the `<image>` error event. Document adding `https://img.pesdata.net` to the mini-program `downloadFile` legal-domain list for remaining download-based consumers.

- [ ] **Step 4: Verify image behavior and market page tests**

Run: `pnpm --filter @efm/miniprogram test -- miniprogram/components/entity-artwork/index.spec.ts miniprogram/pages/player-market`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/miniprogram/miniprogram/components/entity-artwork/index.ts apps/miniprogram/miniprogram/components/entity-artwork/index.spec.ts apps/miniprogram/miniprogram/pages/player-market/index.wxml apps/miniprogram/miniprogram/pages/player-market/player-market.template.spec.ts docs/development/local-development.md
git commit -m "fix: render market portraits directly"
```
