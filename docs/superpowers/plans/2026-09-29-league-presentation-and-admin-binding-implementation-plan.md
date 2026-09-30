# League Presentation and Admin Binding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let administrators publish league presentation data and seasons, bind a WeChat user to a league team that automatically enters the current season, and expose the resulting read-only league/team experience in the mini-program.

**Architecture:** Extend the existing `League → LeagueSeason → LeagueTeam → SeasonEntry` model instead of adding a parallel CMS. Store one explicit current-season relation on each league, derive participant totals from approved current-season entries, and keep all admin writes behind admin authentication, idempotency, optimistic concurrency, and audit logging. Put image bytes behind a small object-storage interface with environment-selected local and CloudBase adapters.

**Tech Stack:** TypeScript, Prisma/MySQL, NestJS, Zod contracts, React/Ant Design/Vite, native WeChat Mini Program, Jest, Vitest

**Spec:** `docs/superpowers/specs/2026-09-29-league-presentation-and-admin-binding-design.zh-CN.md`

## Global Constraints

- `League.edition` is required and accepts only `NATIONAL` or `INTERNATIONAL`.
- `League.currentSeasonId` is explicit, nullable, manually assigned, and may reference only a season in the same league.
- Current participant count is the live count of current-season entries with `status = APPROVED`.
- First team binding and current-season enrollment are one database transaction.
- A league without a current season cannot receive a new user/team binding.
- Existing league teams never auto-enroll when the current season changes.
- League images accept only JPEG, PNG, or WebP and at most 2 MiB; both UI and API enforce this.
- Game account, personal-profile editing, and self-service team editing disappear from active mini-program navigation.
- New admin/UI contracts do not expose league platform or free-form server-region fields.
- Existing historical game-account fields remain readable during the compatibility window.
- Use Node 24: `export PATH=/opt/homebrew/opt/node@24/bin:$PATH`.

## Review Focus

- A spoofed extension with non-image bytes must fail API MIME/signature validation, not merely UI validation (Task 3).
- Two administrators binding the same user or team number concurrently must yield one success and one domain conflict without partial `SeasonEntry` data (Task 5).
- A season ID from another league must never become the current season, including under stale-version retries (Task 4).
- Switching the current season must immediately change displayed count without enrolling historical teams (Tasks 4 and 6).
- A user with no display name or avatar must still be searchable and render by six-digit public number without crashing either client (Tasks 5 and 8).

---

### Task 1: League and Season Entry Persistence Migration

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/<timestamp>_league_edition_current_season/migration.sql`
- Modify: `apps/api/prisma/seed.ts`
- Test: `apps/api/src/database/prisma.service.spec.ts`

**Interfaces:**
- Produces: Prisma `LeagueEdition = NATIONAL | INTERNATIONAL`.
- Produces: `League.edition`, `League.currentSeasonId`, `League.currentSeason`, and named inverse `LeagueSeason.currentForLeagues`.
- Produces: nullable legacy `SeasonEntry` game-account fields plus required `leagueEditionSnapshot` for new application code.
- Produces: nullable legacy `LeagueSeason.createdById` plus `LeagueSeason.createdByAdminId` so season creation no longer requires a fake player identity.

- [ ] **Step 1: Write failing persistence tests**

Add tests named `persists required league edition and current season`, `allows an admin-created league season`, and `allows a season entry without a game account` with assertions for the two enum values, same-league relation, nullable legacy creator/game fields, `createdByAdminId`, and `leagueEditionSnapshot`.

- [ ] **Step 2: Run the database test and verify it fails**

Run: `pnpm --filter @efm/api test -- --runInBand src/database/prisma.service.spec.ts`

Expected: FAIL because the generated Prisma model lacks the new enum, relation, and nullable fields.

- [ ] **Step 3: Add schema and two-phase-safe SQL migration**

The migration must map `GLOBAL`/`INTERNATIONAL` to `INTERNATIONAL`, map `CN`/`CHINA`/`NATIONAL` to `NATIONAL`, stop with a diagnostic query for unknown non-empty values, backfill `league_edition_snapshot`, then enforce non-null `League.edition`. Preserve the old league platform/region columns for compatibility.

- [ ] **Step 4: Regenerate Prisma and run persistence tests**

Run: `pnpm --filter @efm/api prisma:generate && pnpm --filter @efm/api test -- --runInBand src/database/prisma.service.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/prisma apps/api/src/database/prisma.service.spec.ts
git commit -m "feat(db): add league edition and current season"
```

### Task 2: Shared League and Admin Contracts

**Files:**
- Modify: `packages/contracts/src/league.ts`
- Modify: `packages/contracts/src/league-team.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`

**Interfaces:**
- Produces: `LeagueEditionSchema` and `LeagueEdition`.
- Produces: `CurrentSeasonSummarySchema = { id, displayName, status, approvedEntryCount }`.
- Produces: league create/update inputs with `edition`, without `defaultPlatform` or `defaultServerRegion`.
- Produces: `SetCurrentSeasonRequestSchema = { expectedVersion }` and `EnrollLeagueTeamsRequestSchema = { leagueTeamIds, expectedSeasonVersion }`.
- Produces: league-team create input without `defaultGameAccountId`.
- Produces: `SeasonEntrySchema` with nullable legacy game fields and `leagueEditionSnapshot`.

- [ ] **Step 1: Write failing contract tests**

Cover required edition, rejection of missing/unknown edition, absence of platform/region in parsed new inputs, nullable season-entry game identity, current-season summary, and duplicate-free enrollment IDs.

- [ ] **Step 2: Run contracts tests and verify they fail**

Run: `pnpm --filter @efm/contracts test`

Expected: FAIL on missing schemas and old required fields.

- [ ] **Step 3: Implement the exact Zod schemas and exported inferred types**

Keep the capacity defaults `23`, `18`, and `4`. Replace `featuredSeason` with `currentSeason` in `LeagueSummarySchema` and update every compiled consumer in this plan.

- [ ] **Step 4: Build and test contracts**

Run: `pnpm --filter @efm/contracts test && pnpm --filter @efm/contracts build`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts
git commit -m "feat(contracts): define league presentation and season binding"
```

### Task 3: League Image Storage and Upload API

**Files:**
- Create: `apps/api/src/storage/object-storage.ts`
- Create: `apps/api/src/storage/local-object-storage.ts`
- Create: `apps/api/src/storage/cloudbase-object-storage.ts`
- Create: `apps/api/src/storage/image-validation.ts`
- Create: `apps/api/src/storage/admin-uploads.controller.ts`
- Create: `apps/api/src/storage/public-media.controller.ts`
- Create: `apps/api/src/storage/storage.module.ts`
- Create: `apps/api/src/storage/image-validation.spec.ts`
- Create: `apps/api/src/storage/admin-uploads.controller.spec.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/config/env.schema.ts`
- Modify: `apps/api/src/config/configuration.ts`
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.env.example`

**Interfaces:**
- Produces: `ObjectStorage.put(scope: 'league-images', file: StoredUploadInput): Promise<StoredObject>`.
- Produces: `ObjectStorage.delete(key: string): Promise<void>`.
- Produces: `POST /v1/admin/uploads/league-images` returning `{ key, url, mimeType, size }`.
- Produces: `GET /v1/media/:key` for local development assets.

- [ ] **Step 1: Write failing validation and controller tests**

Assert acceptance of real JPEG/PNG/WebP signatures at exactly 2 MiB, rejection at 2 MiB + 1 byte, rejection of executable bytes named `.png`, admin authentication, a stable local public URL, provider selection, and CloudBase URL/key mapping with a mocked SDK client.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `pnpm --filter @efm/api test -- --runInBand src/storage`

Expected: FAIL because storage and routes do not exist.

- [ ] **Step 3: Implement the provider boundary, local adapter, validation, and routes**

Use a configured directory outside source control, generated opaque keys, no client-supplied paths, and streaming responses with the stored content type. Add a CloudBase adapter using the official server SDK and select `local` or `cloudbase` through validated environment configuration; missing CloudBase credentials must fail at startup rather than fall back silently.

- [ ] **Step 4: Run storage tests, typecheck, and lint**

Run: `pnpm --filter @efm/api test -- --runInBand src/storage && pnpm --filter @efm/api typecheck && pnpm --filter @efm/api lint`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .env.example apps/api/package.json pnpm-lock.yaml apps/api/src/storage apps/api/src/app.module.ts apps/api/src/config
git commit -m "feat(api): add validated league image uploads"
```

### Task 4: Admin League Metadata and Current Season Management

**Files:**
- Modify: `apps/api/src/admin/admin-leagues.service.ts`
- Modify: `apps/api/src/admin/admin-leagues.controller.ts`
- Create: `apps/api/src/admin/admin-league-seasons.service.ts`
- Create: `apps/api/src/admin/admin-league-seasons.controller.ts`
- Create: `apps/api/src/admin/admin-league-seasons.service.spec.ts`
- Modify: `apps/api/src/admin/admin.module.ts`
- Modify: `apps/api/src/admin/admin-leagues.service.spec.ts`

**Interfaces:**
- Consumes: Task 2 league/current-season contracts.
- Produces: platform league CRUD using required `edition`.
- Produces: `GET/POST /v1/admin/leagues/:leagueId/seasons`.
- Produces: `PATCH /v1/admin/leagues/:leagueId/seasons/:seasonId`.
- Produces: `POST /v1/admin/leagues/:leagueId/seasons/:seasonId/set-current`.
- Produces: `POST /v1/admin/leagues/:leagueId/seasons/:seasonId/teams` for explicit existing-team enrollment.

- [ ] **Step 1: Write failing service tests**

Assert required edition persistence, current-season same-league validation, optimistic version conflict, no automatic enrollment when switching, explicit enrollment idempotency, foreign-team rejection, participant count, and audit metadata containing old/new season IDs.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `pnpm --filter @efm/api test -- --runInBand src/admin/admin-leagues.service.spec.ts src/admin/admin-league-seasons.service.spec.ts`

Expected: FAIL on missing fields/services.

- [ ] **Step 3: Implement admin-authenticated league and season operations**

Use `AdminAuthorizationService.requireLeagueAccess`, `AdminMutationReceiptService`, `AuditLogService`, row locks for current-season changes, and `APPROVED` entries with `source = RENEWAL`, `confirmedAt = now`, and league/team snapshots for explicit enrollment.

- [ ] **Step 4: Run focused tests and API typecheck**

Run: `pnpm --filter @efm/api test -- --runInBand src/admin/admin-leagues.service.spec.ts src/admin/admin-league-seasons.service.spec.ts && pnpm --filter @efm/api typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/admin
git commit -m "feat(admin): manage league seasons and current season"
```

### Task 5: Atomic User-Team Binding to the Current Season

**Files:**
- Modify: `apps/api/src/league-teams/league-teams.service.ts`
- Modify: `apps/api/src/league-teams/admin-league-teams.controller.ts`
- Modify: `apps/api/src/league-teams/league-teams.service.spec.ts`
- Modify: `apps/admin-web/src/leagues/teams-page.tsx`
- Modify: `apps/admin-web/src/leagues/teams-page.spec.tsx`

**Interfaces:**
- Consumes: Task 1 nullable game fields and Task 2 league-team input.
- Produces: `LeagueTeamsService.create(...)` that creates both `LeagueTeam` and approved current-season `SeasonEntry` in one receipt transaction.
- Produces errors: `LEAGUE_CURRENT_SEASON_REQUIRED`, `LEAGUE_TEAM_OWNER_ALREADY_EXISTS`, `LEAGUE_TEAM_NUMBER_ALREADY_EXISTS`.

- [ ] **Step 1: Rewrite service tests around the new binding behavior**

Assert no game account is required, no-current-season rejection leaves no team, success creates one approved entry with snapshots, six-digit user with null profile renders, duplicate/concurrent owner and number conflicts produce no orphan entry, and idempotent replay returns the original result.

- [ ] **Step 2: Run the focused API test and verify it fails**

Run: `pnpm --filter @efm/api test -- --runInBand src/league-teams/league-teams.service.spec.ts`

Expected: FAIL because create still validates `defaultGameAccountId` and does not enroll.

- [ ] **Step 3: Implement the atomic binding and remove game-account handling from the active create/update path**

Lock the league, require `currentSeasonId`, create the team and its entry with `source = NEW_APPLICATION`, `status = APPROVED`, and `confirmedAt = now`, write team/edition snapshots, and preserve database unique constraints as the concurrency backstop.

- [ ] **Step 4: Update the admin team form and its tests**

Remove `defaultGameAccountId`, show the current-season prerequisite error, keep user lookup by six-digit number, and leave team number/name/short name/logo fields.

- [ ] **Step 5: Run API and admin tests**

Run: `pnpm --filter @efm/api test -- --runInBand src/league-teams/league-teams.service.spec.ts && pnpm --filter @efm/admin-web test -- teams-page.spec.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/league-teams apps/admin-web/src/leagues/teams-page.*
git commit -m "feat(admin): bind league teams into the current season"
```

### Task 6: Public and User-Scoped League Read Models

**Files:**
- Modify: `apps/api/src/leagues/leagues.service.ts`
- Modify: `apps/api/src/leagues/leagues.service.spec.ts`
- Modify: `apps/api/src/league-teams/league-teams.service.ts`
- Modify: `apps/api/src/league-teams/my-league-teams.controller.ts`
- Modify: `apps/api/src/league-teams/league-teams.service.spec.ts`

**Interfaces:**
- Produces: public `LeagueSummary.currentSeason` from explicit relation only.
- Produces: `currentSeason.approvedEntryCount` from live `APPROVED` count.
- Produces: authenticated “my league teams” items containing league image, description, edition, current season, and owner team summary.

- [ ] **Step 1: Write failing read-model tests**

Assert explicit current season wins over status/date heuristics, count changes after entry changes, season switching changes count without adding entries, no-current-season returns null/zero, and user scope returns only bound leagues.

- [ ] **Step 2: Run focused tests and verify they fail**

Run: `pnpm --filter @efm/api test -- --runInBand src/leagues/leagues.service.spec.ts src/league-teams/league-teams.service.spec.ts`

Expected: FAIL because the service still computes `featuredSeason` heuristically.

- [ ] **Step 3: Implement explicit current-season includes and mappers**

Keep queries paginated, avoid per-league count queries, and ensure archived leagues remain absent from the public list.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm --filter @efm/api test -- --runInBand src/leagues/leagues.service.spec.ts src/league-teams/league-teams.service.spec.ts && pnpm --filter @efm/api typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/leagues apps/api/src/league-teams
git commit -m "feat(api): expose current league season summaries"
```

### Task 7: Admin League and Season Screens

**Files:**
- Modify: `apps/admin-web/src/platform/leagues-page.tsx`
- Modify: `apps/admin-web/src/platform/leagues-page.spec.tsx`
- Create: `apps/admin-web/src/leagues/seasons-page.tsx`
- Create: `apps/admin-web/src/leagues/seasons-page.spec.tsx`
- Modify: `apps/admin-web/src/leagues/league-shell.tsx`
- Modify: `apps/admin-web/src/app.tsx`
- Modify: `apps/admin-web/src/lib/api.ts`
- Modify: `apps/admin-web/src/styles.css`

**Interfaces:**
- Consumes: Tasks 3 and 4 admin APIs.
- Produces: league editor with required edition and actual image upload.
- Produces: league season screen for create/edit/set-current and existing-team enrollment.

- [ ] **Step 1: Write failing component tests**

Assert the league form has no game-platform/server-region controls, requires 国服/国际服, displays `支持 JPG、PNG、WebP，图片大小不超过 2MB`, blocks oversized/wrong-type images, uploads before save, and renders upload errors. Assert season screen marks the current season, changes it with expected version, and does not auto-select all teams.

- [ ] **Step 2: Run admin tests and verify they fail**

Run: `pnpm --filter @efm/admin-web test -- leagues-page.spec.tsx seasons-page.spec.tsx`

Expected: FAIL because the controls and screen do not exist.

- [ ] **Step 3: Implement the league editor and season screen**

Use Ant Design `Upload` with `beforeUpload` client validation and the existing authenticated API wrapper for multipart requests. Keep errors visible and Chinese.

- [ ] **Step 4: Add the route/navigation and run the admin suite**

Run: `pnpm --filter @efm/admin-web test && pnpm --filter @efm/admin-web typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-web/src
git commit -m "feat(admin-web): edit league presentation and seasons"
```

### Task 8: Mini-Program League Directory and Read-Only Profile

**Files:**
- Modify: `apps/miniprogram/miniprogram/pages/leagues/leagues.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/leagues/leagues.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/leagues/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/leagues/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/leagues/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/profile/profile.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/profile/profile.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.wxss`
- Modify: `apps/miniprogram/miniprogram/services/leagues.ts`
- Modify: `apps/miniprogram/miniprogram/app.json`

**Interfaces:**
- Consumes: Task 6 public and “my league teams” read models.
- Produces: “全部联赛 / 我的联赛” tabs under the league tab.
- Produces: read-only “我的” identity with public number and team summaries.

- [ ] **Step 1: Write failing view-model tests**

Assert edition labels, current season name, approved participant copy, all-vs-mine filtering, missing image/name fallbacks, null profile safety, and no game-account/profile form helpers.

- [ ] **Step 2: Run mini-program tests and verify they fail**

Run: `pnpm --filter @efm/miniprogram test`

Expected: FAIL on old platform labels and editable profile/account behavior.

- [ ] **Step 3: Implement the league tabs, refresh behavior, and cards**

Reload on `onShow` and pull-down refresh. “我的联赛” consumes the authenticated team endpoint and does not duplicate a second standalone directory.

- [ ] **Step 4: Replace the profile screen with the read-only identity/team summary**

Remove routes to game-account editing, self-service team profile, league creation, and profile save actions from `app.json` and active event handlers. Leave the unregistered legacy page files in place for the compatibility window; they must have no active navigation path or service call.

- [ ] **Step 5: Run mini-program tests and typecheck**

Run: `pnpm --filter @efm/miniprogram test && pnpm --filter @efm/miniprogram typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/miniprogram
git commit -m "feat(miniprogram): show current leagues and read-only identity"
```

### Task 9: Compatibility Cleanup, Documentation, and Full Verification

**Files:**
- Modify: `apps/api/src/users/game-accounts.controller.ts`
- Modify: `apps/api/src/leagues/team-profiles.controller.ts`
- Modify: `docs/development/admin-web-local-development.zh-CN.md`
- Modify: `docs/development/local-development.md`
- Create: `docs/development/league-presentation-verification.zh-CN.md`

**Interfaces:**
- Consumes: all previous tasks.
- Produces: documented deprecation boundary for old user-write APIs and a repeatable local acceptance checklist.

- [ ] **Step 1: Add deprecation coverage**

Ensure active clients make no calls to game-account/profile-write routes. Mark legacy controllers as deprecated in API metadata/logging without deleting historical reads needed by old records.

- [ ] **Step 2: Document local setup and manual verification**

Include API/admin restart commands, upload directory configuration, administrator login flow, create league → upload image → create season → set current → bind user → refresh mini-program verification, and expected participant-count changes.

- [ ] **Step 3: Run migration status and all automated checks**

Run:

```bash
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
set -a
source /Users/xiaoxuan/Documents/Codex_project/efootball_management/.env
set +a
pnpm db:status
pnpm verify
git diff --check
```

Expected: migrations current; all builds, typechecks, tests, and lint checks pass; no whitespace errors.

- [ ] **Step 4: Perform manual acceptance**

Verify a ≤2 MiB valid image succeeds, a >2 MiB image fails, league edition is mandatory, binding without current season fails, successful binding increments current-season count, switching current season resets displayed count without auto-enrollment, and game-account/profile edit entry points are absent.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/users/game-accounts.controller.ts apps/api/src/leagues/team-profiles.controller.ts docs/development
git commit -m "docs: add league presentation verification runbook"
```

- [ ] **Step 6: Request final branch review**

Use `superpowers:requesting-code-review` for a whole-branch review against the spec and this plan. Address all Critical and Important findings before presenting the branch as merge-ready.
