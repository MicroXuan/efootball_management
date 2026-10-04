# Player Discovery and Favorites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent player favorites, complete mini-program pack filtering, and add practical player/team filters to the existing admin workflows.

**Architecture:** Store one favorite per user and football player, then resolve the displayed card at read time from the existing best-card selection with a deterministic active-card fallback. Expose authenticated `/v1/me/player-favorites` endpoints, reuse existing catalog summaries in the mini-program, and extend the existing roster/team screens instead of creating duplicate admin modules.

**Tech Stack:** TypeScript 5.9, Prisma 7/MySQL, NestJS 12, Zod 4, native WeChat mini-program, React 19, Ant Design 6, Jest/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-02-player-discovery-favorites-design.zh-CN.md`

## Global Constraints

- Small-program UI remains dark football themed; admin data workspaces remain light with dark navigation.
- All user-facing copy and business errors are Chinese.
- Do not add large runtime or image-processing dependencies.
- Keep existing player catalog and card-detail responses backward compatible.
- Favorites are scoped to the authenticated user; clients never provide `userId`.
- List endpoints are bounded and avoid per-row card queries.
- Do not modify or overwrite the user's changes in the primary checkout.

## Review Focus

- A saved best-card reference can point to a card no longer active; the favorite list must use the deterministic active-card fallback.
- Several favorites can share the same `createdAt`; cursor pagination must neither skip nor duplicate rows.
- A player can remain favorited while having no active cards; the relation remains stored but the row is hidden.
- A rapid filter change can return responses out of order; the mini-program must keep only the newest request result.
- Admin combinations with no matching cards must show an explicit empty result without disabling unrelated team creation controls.

---

### Task 1: Favorite Contracts and Persistence

**Files:**
- Modify: `packages/contracts/src/player-catalog.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261002_user_player_favorites/migration.sql`

**Interfaces:**
- Consumes: existing `ResourceIdSchema` and `PlayerCardSummarySchema`.
- Produces: `CreatePlayerFavoriteRequestSchema`, `PlayerFavoriteListQuerySchema`, `PlayerFavoriteStatusQuerySchema`, `PlayerFavoriteItemSchema`, `PlayerFavoriteListResponseSchema`, `PlayerFavoriteStatusResponseSchema`, and Prisma model `UserPlayerFavorite` unique on `(userId, footballPlayerId)`.

- [ ] **Step 1: Write failing contract tests**

Add tests named `validates player favorite requests and bounded list queries` and `rejects oversized favorite status queries`. Assert UUID validation, trimmed keyword, default `limit: 20`, maximum `limit: 100`, and at most 100 unique player IDs.

- [ ] **Step 2: Run the contract tests and verify RED**

Run: `pnpm --filter @efm/contracts test -- contracts.spec.ts`

Expected: FAIL because the favorite schemas are not exported.

- [ ] **Step 3: Add schemas, types, relations, indexes, and migration**

The list item signature is `{ playerId: string; favoritedAt: string; card: PlayerCardSummary }`. The status response is `{ favoritePlayerIds: string[] }`. The migration creates foreign keys to `users(id)` and `football_players(id)` with cascading deletes.

- [ ] **Step 4: Generate Prisma client and verify GREEN**

Run: `pnpm --filter @efm/api prisma:generate && pnpm --filter @efm/contracts test -- contracts.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts apps/api/prisma
git commit -m "feat: add player favorite contracts and storage"
```

### Task 2: Authenticated Favorite API

**Files:**
- Create: `apps/api/src/player-favorites/player-favorites.service.ts`
- Create: `apps/api/src/player-favorites/player-favorites.service.spec.ts`
- Create: `apps/api/src/player-favorites/player-favorites.controller.ts`
- Create: `apps/api/src/player-favorites/player-favorites.module.ts`
- Modify: `apps/api/src/app.module.ts`

**Interfaces:**
- Consumes: Task 1 schemas/types and generated Prisma `userPlayerFavorite` delegate.
- Produces: `PlayerFavoritesService.list(userId, query)`, `favorite(userId, playerId)`, `unfavorite(userId, playerId)`, and `statuses(userId, playerIds)` plus `/v1/me/player-favorites` routes protected by `JwtAuthGuard`.

- [ ] **Step 1: Write failing service tests**

Cover idempotent favorite/unfavorite, missing player `PLAYER_NOT_FOUND`, user isolation, best active card selection, inactive saved-best fallback, hidden no-active-card relation, keyword filtering, same-timestamp cursor stability, and status result deduplication.

- [ ] **Step 2: Run the service test and verify RED**

Run: `pnpm --filter @efm/api test -- player-favorites.service.spec.ts --runInBand`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement service with bounded batch reads**

Use one favorites query plus batched player/card/version reads. Encode the cursor from `{ createdAt, id }`; order by `createdAt desc, id desc`. Prefer an active `FootballPlayerBestCard`; fallback by `overallRating desc`, `publishedAt desc`, `playerCardId asc` from the current catalog release snapshot.

- [ ] **Step 4: Run the service test and verify GREEN**

Run: `pnpm --filter @efm/api test -- player-favorites.service.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Write failing controller/module test**

Add a module-level test asserting every route uses the current JWT identity and that request/query schemas reject malformed IDs and oversized status requests before service invocation.

- [ ] **Step 6: Implement controller/module registration and verify GREEN**

Run: `pnpm --filter @efm/api test -- player-favorites --runInBand`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/player-favorites apps/api/src/app.module.ts
git commit -m "feat: add authenticated player favorites api"
```

### Task 3: Mini-Program Pack Filter and Favorite Client

**Files:**
- Modify: `apps/miniprogram/miniprogram/services/catalog.ts`
- Create: `apps/miniprogram/miniprogram/services/favorites.ts`
- Modify: `apps/miniprogram/miniprogram/pages/players/players.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/players/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/players/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/players/index.wxss`

**Interfaces:**
- Consumes: Task 1 favorite contracts and existing `catalogApi.listCardPacks`/`PlayerQueryInput.cardPackId`.
- Produces: `favoritesApi.list`, `favorite`, `unfavorite`, `statuses`; players page state `packOptions`, `cardPackId`, `favoritePlayerIds`; handlers `onPackChange` and `onFavoriteTap`.

- [ ] **Step 1: Write failing view-model/query tests**

Assert choosing a pack sends `cardPackId`, clearing sends no pack, and favorite status maps by `playerId` rather than card ID. Add the rapid-change case that only the latest request token updates the page.

- [ ] **Step 2: Run the mini-program test and verify RED**

Run: `pnpm --filter @efm/miniprogram test -- players.viewmodel.spec.ts`

Expected: FAIL because pack/favorite page state is absent.

- [ ] **Step 3: Implement pack loading, selector, favorite client, and list controls**

Load up to 100 pack options once per page load. Keep `skipAuth: true` only for public catalog requests; favorite requests use the existing authenticated request behavior. Stop tap propagation before toggling a favorite.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `pnpm --filter @efm/miniprogram test -- players.viewmodel.spec.ts && pnpm --filter @efm/miniprogram typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/miniprogram/miniprogram/services apps/miniprogram/miniprogram/pages/players
git commit -m "feat: add pack filtering and favorite controls"
```

### Task 4: Mini-Program Favorites Page and Card Detail Toggle

**Files:**
- Create: `apps/miniprogram/miniprogram/pages/favorites/index.json`
- Create: `apps/miniprogram/miniprogram/pages/favorites/index.ts`
- Create: `apps/miniprogram/miniprogram/pages/favorites/index.wxml`
- Create: `apps/miniprogram/miniprogram/pages/favorites/index.wxss`
- Create: `apps/miniprogram/miniprogram/pages/favorites/favorites.viewmodel.ts`
- Create: `apps/miniprogram/miniprogram/pages/favorites/favorites.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/player-card-detail/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/player-card-detail/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/player-card-detail/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/player-card-detail/detail.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.wxss`
- Modify: `apps/miniprogram/miniprogram/app.json`
- Modify: `apps/miniprogram/miniprogram/design-system/registered-pages-visual-contract.spec.ts`

**Interfaces:**
- Consumes: Task 3 `favoritesApi` and favorite response types.
- Produces: registered `/pages/favorites/index`, searchable cursor-paginated favorite state, profile entry, and card-detail toggle keyed by `card.playerId`.

- [ ] **Step 1: Write failing favorite-page and detail tests**

Assert refresh/append deduplicates by `playerId`, empty/error states are Chinese, search resets the cursor, detail toggles the player ID, and an unsuccessful mutation preserves the prior favorite state.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm --filter @efm/miniprogram test -- favorites.viewmodel.spec.ts detail.viewmodel.spec.ts registered-pages-visual-contract.spec.ts`

Expected: FAIL because the page and favorite behavior are absent.

- [ ] **Step 3: Implement page, profile entry, and card-detail toggle**

Reuse existing card typography and artwork fallbacks. Debounce search by 300 ms, keep 20-row pages, and show a login redirect when the authenticated API returns 401.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `pnpm --filter @efm/miniprogram test -- favorites.viewmodel.spec.ts detail.viewmodel.spec.ts registered-pages-visual-contract.spec.ts && pnpm --filter @efm/miniprogram typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/miniprogram/miniprogram
git commit -m "feat: add mini-program player favorites page"
```

### Task 5: Admin Player Candidate Filters

**Files:**
- Modify: `packages/contracts/src/league-roster.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`
- Modify: `apps/api/src/league-rosters/admin-rosters.controller.ts`
- Modify: `apps/api/src/league-rosters/admin-roster-queries.service.ts`
- Create: `apps/api/src/league-rosters/admin-roster-queries.service.spec.ts`
- Modify: `apps/admin-web/src/rosters/acquire-player-drawer.tsx`
- Modify: `apps/admin-web/src/rosters/acquire-player-drawer.spec.tsx`

**Interfaces:**
- Consumes: existing `PlayerPositionSchema`, `PlayerCardTypeSchema`, `ResourceIdSchema`, card packs, and candidate response.
- Produces: `RosterPlayerCandidateQuerySchema` with required trimmed keyword plus optional `position`, `cardType`, `cardPackId`; `AdminRosterQueriesService.candidates(leagueId, query)`.

- [ ] **Step 1: Write failing contract, service, and component tests**

Assert query validation, cards filtered by every supplied condition, players omitted when no cards remain, and the drawer sends the selected URL parameters and displays an explicit no-result state.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @efm/contracts test -- contracts.spec.ts && pnpm --filter @efm/api test -- admin-roster-queries.service.spec.ts --runInBand && pnpm --filter @efm/admin-web test -- acquire-player-drawer.spec.tsx`

Expected: FAIL because candidate filters are not accepted or rendered.

- [ ] **Step 3: Implement query contract, database filtering, and drawer controls**

Filter cards at the database relation level and require `cards: { some: ...filters }` at player level. Load public packs for the drawer and preserve keyword as required to bound results.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm --filter @efm/contracts test -- contracts.spec.ts && pnpm --filter @efm/api test -- admin-roster-queries.service.spec.ts --runInBand && pnpm --filter @efm/admin-web test -- acquire-player-drawer.spec.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts apps/api/src/league-rosters apps/admin-web/src/rosters
git commit -m "feat: filter admin player candidates"
```

### Task 6: Admin Team List Filter and Whole-Branch Verification

**Files:**
- Modify: `packages/contracts/src/league-team.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`
- Modify: `apps/api/src/league-teams/league-teams.service.ts`
- Modify: `apps/api/src/league-teams/league-teams.service.spec.ts`
- Modify: `apps/admin-web/src/leagues/teams-page.tsx`
- Modify: `apps/admin-web/src/leagues/teams-page.spec.tsx`

**Interfaces:**
- Consumes: existing league team list query and owner relation.
- Produces: backward-compatible `LeagueTeamSummary.ownerDisplayName?: string` populated by the API.
- Produces: pure `filterLeagueTeams(teams, keyword)` matching name, short name, numeric team number, owner display name, and public user number; page search input and filtered empty state.

- [ ] **Step 1: Write failing team filter tests**

Assert the list response includes `ownerDisplayName`; assert case-insensitive matching for names, exact/partial numeric matching, owner matching, whitespace normalization, and a visible `没有符合筛选条件的球队` state while the create form remains enabled.

- [ ] **Step 2: Run the component test and verify RED**

Run: `pnpm --filter @efm/contracts test -- contracts.spec.ts && pnpm --filter @efm/api test -- league-teams.service.spec.ts --runInBand && pnpm --filter @efm/admin-web test -- teams-page.spec.tsx`

Expected: FAIL because the team filter does not exist.

- [ ] **Step 3: Implement pure filter and page controls**

Keep filtering client-side because the current league team list is already bounded by league scope. Do not alter the create-team form state when filtering.

- [ ] **Step 4: Run the component test and verify GREEN**

Run: `pnpm --filter @efm/contracts test -- contracts.spec.ts && pnpm --filter @efm/api test -- league-teams.service.spec.ts --runInBand && pnpm --filter @efm/admin-web test -- teams-page.spec.tsx`

Expected: PASS.

- [ ] **Step 5: Run complete verification**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm test:e2e && pnpm build`

Expected: PASS with zero failing commands. Record any unrelated pre-existing failure rather than hiding it.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts apps/api/src/league-teams apps/admin-web/src/leagues/teams-page.tsx apps/admin-web/src/leagues/teams-page.spec.tsx
git commit -m "feat: filter league teams in admin"
```
