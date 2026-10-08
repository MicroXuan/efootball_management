# Team Shell Catalog and PESDATA Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将球队名称、简称和队徽建模为可同步、可分配、可更换的队壳目录，并在后台创建球队、小程序展示和 PESDATA 同步中完整使用。

**Architecture:** `TeamCatalogItem` 是跨联赛复用的队壳目录，`LeagueTeam` 是联赛内承载负责人、编号、阵容和资产的经营主体。经营球队保存必填目录绑定和当前展示快照；所有队壳分配变更通过事务、唯一约束和具体审计动作完成。PESDATA 只通过后端适配器进入待审核目录，队徽复制到自有对象存储，运行时界面只依赖本地数据。

**Tech Stack:** TypeScript 5.9、NestJS 12、Prisma 7、MariaDB、Zod 4、React 19/Ant Design 6、原生微信小程序、Jest/Vitest。

**Spec:** `docs/superpowers/specs/2026-10-06-team-shell-catalog-pesdata-sync-design.zh-CN.md`

## Global Constraints

- 直接在现有 `codex/league-center-banner` 分支实施，不新建分支或工作树。
- 遵循 TDD：每个行为先写失败测试并确认按预期失败，再写最小实现。
- 队壳只包含名称、简称和队徽，不同步或转移阵容、工资、资金、成绩和赛季资格。
- 每支经营球队始终拥有一个队壳；同一联赛内同一队壳只能被使用一次；不同联赛可以复用。
- 小程序和后台运行时不直接请求 PESDATA；公开响应只返回自有对象存储队徽地址。
- PESDATA 队徽复制必须以授权覆盖球队名称、队徽保存与展示为上线前置条件。
- 所有审计动作使用具体名称，不产生“其他后台操作”。
- 现有工作区包含其他已确认需求的未提交变更；所有编辑必须保留这些变更，提交时使用精确路径。

## Review Focus

- 两个管理员并发选择同一队壳时，只有一个事务成功，失败方得到可识别冲突而不是 500。
- 迁移已有空队徽或同名球队时，每支经营球队得到独立的自定义队壳且不丢失现有展示值。
- PESDATA 返回伪装成图片的 HTML、超大文件或重定向异常时，该条失败且不会写入目录或对象存储。
- 更换、转让或交换队壳时，阵容、财务、赛季报名和历史快照逐项保持不变。
- 来源球队从 PESDATA 列表暂时消失时，仅标记待确认，不删除目录、不释放当前联赛中的占用。

---

### Task 1: Contracts for catalog items and shell-bound league teams

**Files:**
- Create: `packages/contracts/src/team-catalog.ts`
- Modify: `packages/contracts/src/league-team.ts`
- Modify: `packages/contracts/src/index.ts`
- Test: `packages/contracts/src/contracts.spec.ts`

**Interfaces:**
- Produces: `TeamCatalogItemSchema`, `TeamCatalogListResponseSchema`, `CreateCustomTeamCatalogItemRequestSchema`, catalog sync run/difference schemas, `CreateLeagueTeamRequestSchema` with `ownerAlias` and `catalogTeamId`, plus `ChangeTeamShellRequestSchema`, `TransferTeamShellRequestSchema`, `SwapTeamShellRequestSchema`, and `RefreshTeamShellRequestSchema`.
- Produces: `LeagueTeamSummary` fields `ownerAlias: string`, `catalogTeamId: string`, `name`, `shortName`, and `logoUrl`.

- [ ] **Step 1: Write failing contract tests**

Add tests asserting trimmed `ownerAlias` length `1..32`, required UUID `catalogTeamId`, published catalog list and sync-difference parsing, and rejection of create requests that omit a shell. Assert `UpdateLeagueTeamRequestSchema` accepts alias changes but not direct name/logo changes. Add separate tests proving transfer requires a replacement shell, swap requires two distinct team IDs, and refresh requires the current catalog ID plus expected version.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @efm/contracts test -- --runInBand`

Expected: FAIL because catalog schemas and new required fields are absent.

- [ ] **Step 3: Implement minimal schemas and exports**

Use source types `PESDATA | CUSTOM`, statuses `ACTIVE | SOURCE_UNCONFIRMED | DISABLED`, nullable multilingual/source fields, and independent response fields rather than a pre-composed display string.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @efm/contracts test -- --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit exact contract files**

Commit message: `feat(contracts): define team shell catalog`

### Task 2: Database catalog, assignment history, and legacy backfill

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261006_team_shell_catalog/migration.sql`
- Create: `apps/api/src/team-catalog/team-catalog-backfill.ts`
- Test: `apps/api/src/team-catalog/team-catalog-backfill.spec.ts`
- Test: `apps/api/src/database/prisma.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 catalog/source/status names.
- Produces: Prisma models `TeamCatalogItem`, `LeagueTeamShellHistory`, `TeamCatalogSyncRun`, and `TeamCatalogSyncItem`; `LeagueTeam.ownerAlias` and `LeagueTeam.catalogTeamId`; function `buildLegacyShellSeed(team): LegacyShellSeed`.

- [ ] **Step 1: Write failing pure backfill and database invariant tests**

Assert that two existing league teams with equal names still receive different `CUSTOM` shell seeds, null logos remain null, current names/short names are preserved, and `(leagueId, catalogTeamId)` rejects a duplicate while the same catalog item works in another league.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @efm/api test -- team-catalog-backfill.spec.ts prisma.service.spec.ts --runInBand`

Expected: FAIL because models, fields, and seed helper do not exist.

- [ ] **Step 3: Implement phased migration and schema**

Create catalog rows for every legacy `LeagueTeam`, backfill a default `ownerAlias` from the current owner display name, attach each team, then enforce non-null catalog assignment and the league/catalog unique key. Add team-specific sync run/item records so catalog review is not coupled to player import batches. Preserve all pre-existing schema edits in the dirty worktree.

- [ ] **Step 4: Generate Prisma client and verify GREEN**

Run: `pnpm db:generate && pnpm --filter @efm/api test -- team-catalog-backfill.spec.ts prisma.service.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit exact schema, migration, helper, and tests**

Commit message: `feat(api): add team shell persistence`

### Task 3: Local catalog service, custom shells, and crest storage

**Files:**
- Create: `apps/api/src/team-catalog/team-catalog.service.ts`
- Create: `apps/api/src/team-catalog/team-catalog.service.spec.ts`
- Create: `apps/api/src/team-catalog/admin-team-catalog.controller.ts`
- Create: `apps/api/src/team-catalog/team-catalog.module.ts`
- Modify: `apps/api/src/app.module.ts`
- Modify: `apps/api/src/storage/object-storage.ts`
- Modify: `apps/api/src/storage/local-object-storage.ts`
- Modify: `apps/api/src/storage/cloudbase-object-storage.ts`
- Modify: `apps/api/src/storage/admin-uploads.controller.ts`
- Modify: `apps/api/src/storage/admin-uploads.controller.spec.ts`

**Interfaces:**
- Consumes: Task 1 catalog contracts and Task 2 Prisma models.
- Produces: `TeamCatalogService.listAvailable(leagueId, query)`, `createCustom(actorAdminId, input)`, and upload scope `team-crests`; admin routes under `/v1/admin/team-catalog` and `/v1/admin/uploads/team-crests`.

- [ ] **Step 1: Write failing catalog availability and upload tests**

Assert active filtering, name/league search, occupied state for one league but availability in another, custom item creation, 2 MiB and pixel-dimension validation, and rejection of non-images. Pin the Review Focus case that an existing disabled shell remains readable but is excluded from new assignments.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @efm/api test -- team-catalog.service.spec.ts admin-uploads.controller.spec.ts --runInBand`

Expected: FAIL because catalog service/routes and `team-crests` storage scope do not exist.

- [ ] **Step 3: Implement catalog module and crest upload**

Reuse existing image signature validation. Extend local safe-key and CloudBase paths for `team-crests`; expose only stored URLs in catalog responses.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @efm/api test -- team-catalog.service.spec.ts admin-uploads.controller.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit exact catalog and storage files**

Commit message: `feat(api): add local team shell catalog`

### Task 4: Create and read league teams through catalog shells

**Files:**
- Modify: `apps/api/src/league-teams/league-teams.service.ts`
- Modify: `apps/api/src/league-teams/league-teams.service.spec.ts`
- Modify: `apps/api/src/league-teams/league-team-summary.spec.ts`
- Modify: `apps/api/src/league-teams/admin-league-teams.controller.ts`

**Interfaces:**
- Consumes: `catalogTeamId` and `ownerAlias` from Task 1; `TeamCatalogItem` from Task 2.
- Produces: creation that copies catalog `nameZh ?? nameEn`, `shortName`, and `storedLogoUrl` into `LeagueTeam`; summaries containing alias and catalog ID.

- [ ] **Step 1: Write failing service tests**

Assert create copies only published local shell data, ignores client attempts to inject name/logo, rejects occupied/disabled shells with explicit error codes, and records `CREATE_LEAGUE_TEAM` audit metadata. Add a concurrent duplicate-shell test and assert roster/season snapshot creation remains unchanged.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @efm/api test -- league-teams.service.spec.ts league-team-summary.spec.ts --runInBand`

Expected: FAIL because creation still accepts direct name/logo and has no alias/catalog checks.

- [ ] **Step 3: Implement catalog-backed creation and response mapping**

Lock the parent league, verify catalog status, rely on the database unique constraint for the final concurrency guard, and translate uniqueness failures to `LEAGUE_TEAM_SHELL_ALREADY_ASSIGNED`.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @efm/api test -- league-teams.service.spec.ts league-team-summary.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit exact league-team API files**

Commit message: `feat(api): create teams from assigned shells`

### Task 5: Admin creation picker and composed team identity

**Files:**
- Create: `apps/admin-web/src/leagues/team-shell-picker.tsx`
- Create: `apps/admin-web/src/leagues/team-shell-picker.spec.tsx`
- Modify: `apps/admin-web/src/leagues/teams-page.tsx`
- Modify: `apps/admin-web/src/leagues/teams-page.spec.tsx`
- Modify: `apps/admin-web/src/styles.css`

**Interfaces:**
- Consumes: Task 1 catalog list/create contracts and Task 4 create endpoint.
- Produces: searchable shell picker by source league/name, required league alias input, occupied-state display, crest preview, and list cells formatted as `编号-球队名` plus `（联赛称呼）`.

- [ ] **Step 1: Write failing component tests**

Assert search requests local APIs only, selecting a shell renders its stored crest, submission sends only `ownerUserId`, `ownerAlias`, `teamNumber`, and `catalogTeamId`, and the list exposes accessible image alt text plus exact `7-阿贾克斯（tidus）` identity content.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @efm/admin-web test -- team-shell-picker.spec.tsx teams-page.spec.tsx`

Expected: FAIL because picker, alias, and catalog-backed request are absent.

- [ ] **Step 3: Implement picker and responsive presentation**

Keep filters local to the published catalog endpoint, disable occupied/disabled items, and retain explicit empty/error/retry states.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @efm/admin-web test -- team-shell-picker.spec.tsx teams-page.spec.tsx`

Expected: PASS.

- [ ] **Step 5: Commit exact admin files**

Commit message: `feat(admin): select team shells when creating teams`

### Task 6: Mini-program crest and identity presentation

**Files:**
- Modify: `apps/miniprogram/miniprogram/pages/my-league-teams/my-league-teams.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/my-league-teams/my-league-teams.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/my-league-teams/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/my-league-teams/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/profile/profile.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/profile/profile.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/profile/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/league-team-detail/index.wxml`

**Interfaces:**
- Consumes: Task 1 `LeagueTeamSummary.ownerAlias` and stored `logoUrl`.
- Produces: view models with `identityCopy` and `ownerAliasCopy`; UI with `entity-artwork` crest and stable fallback.

- [ ] **Step 1: Write failing view-model and visual-contract tests**

Assert exact `3-阿贾克斯` identity, `（tidus）` alias, stored crest URL, and name fallback when logo is null or fails. Update affected fixtures to supply required catalog and alias fields.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @efm/miniprogram test -- my-league-teams.viewmodel.spec.ts profile.viewmodel.spec.ts registered-pages-visual-contract.spec.ts`

Expected: FAIL because the new identity presentation is absent.

- [ ] **Step 3: Implement view-model and WXML/WXSS changes**

Use the existing `entity-artwork` component; do not introduce remote PESDATA requests.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @efm/miniprogram test -- my-league-teams.viewmodel.spec.ts profile.viewmodel.spec.ts registered-pages-visual-contract.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit exact mini-program files**

Commit message: `feat(miniprogram): show league team shells and aliases`

### Task 7: Atomic shell change, transfer, and swap

**Files:**
- Create: `apps/api/src/league-teams/league-team-shells.service.ts`
- Create: `apps/api/src/league-teams/league-team-shells.service.spec.ts`
- Modify: `apps/api/src/league-teams/league-teams.module.ts`
- Modify: `apps/api/src/league-teams/admin-league-teams.controller.ts`
- Create: `apps/admin-web/src/leagues/team-shell-actions.tsx`
- Create: `apps/admin-web/src/leagues/team-shell-actions.spec.tsx`
- Modify: `apps/admin-web/src/leagues/team-detail-page.tsx`

**Interfaces:**
- Consumes: Task 1 operation contracts and Task 2 history model.
- Produces: `changeShell`, `transferShell`, `swapShells`, and `refreshShell`, each transactionally updating catalog binding plus name/shortName/logo snapshots and writing specific audit/history records.

- [ ] **Step 1: Write failing API invariance tests**

Capture both teams' roster ownership counts, ledger totals, season entries, results, owner IDs, aliases, and team numbers before each operation; assert they are byte-for-byte unchanged afterward. Assert transfer requires a replacement shell, swap rejects the same team, occupied conflicts roll back, refresh copies a newly published name/logo without changing the catalog binding, and the Review Focus concurrency case returns a domain conflict.

- [ ] **Step 2: Verify API RED**

Run: `pnpm --filter @efm/api test -- league-team-shells.service.spec.ts --runInBand`

Expected: FAIL because shell operation service does not exist.

- [ ] **Step 3: Implement transactional operations**

Lock the league and relevant teams. For swap, use a transaction-safe temporary catalog item or a deterministic multi-step strategy that never commits null and cleans up before commit. Persist `CHANGE_TEAM_SHELL`, `TRANSFER_TEAM_SHELL`, `SWAP_TEAM_SHELL`, or `REFRESH_TEAM_SHELL` audit actions.

- [ ] **Step 4: Verify API GREEN**

Run: `pnpm --filter @efm/api test -- league-team-shells.service.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Write failing admin confirmation tests**

Assert dialogs enumerate old/new shells and state that roster, finance, results, number, owner, and alias are unchanged; assert a transfer cannot submit without the source replacement shell.

- [ ] **Step 6: Implement admin actions and verify**

Run: `pnpm --filter @efm/admin-web test -- team-shell-actions.spec.tsx team-detail-page.spec.tsx`

Expected: PASS after implementation.

- [ ] **Step 7: Commit exact operation files**

Commit message: `feat(leagues): change and exchange team shells`

### Task 8: PESDATA team protocol and safe crest ingestion

**Files:**
- Modify: `apps/api/src/pesdata-sync/pesdata-client.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata-client.spec.ts`
- Create: `apps/api/src/pesdata-sync/pesdata-team.schemas.ts`
- Create: `apps/api/src/pesdata-sync/pesdata-team-mapper.ts`
- Create: `apps/api/src/pesdata-sync/pesdata-team-mapper.spec.ts`
- Create: `apps/api/src/pesdata-sync/pesdata-crest-loader.ts`
- Create: `apps/api/src/pesdata-sync/pesdata-crest-loader.spec.ts`
- Modify: `apps/api/src/storage/object-storage.ts`
- Modify: `apps/api/src/storage/local-object-storage.ts`
- Modify: `apps/api/src/storage/cloudbase-object-storage.ts`

**Interfaces:**
- Produces: `listLeagues()`, `listTeams(query)`, `getTeamDetail(id)`, `mapPesdataTeam(raw): TeamCatalogCandidate`, and `PesdataCrestLoader.load(candidate): StoredCrest`.
- Consumes: Task 3 `team-crests` storage and Task 2 catalog fields.

- [ ] **Step 1: Write failing protocol and mapper tests**

Use sanitized fixtures for league, team list, and detail responses containing multilingual names and `team_logo`; assert unknown fields are tolerated and required identifiers/names fail clearly. Pin display-name priority to Chinese, then English, then Japanese; derive a missing short name from the preferred display name using the first 24 Unicode code points so it always satisfies the contract and remains editable after staging.

- [ ] **Step 2: Verify protocol RED**

Run: `pnpm --filter @efm/api test -- pesdata-client.spec.ts pesdata-team-mapper.spec.ts --runInBand`

Expected: FAIL because team endpoints and mapper are absent.

- [ ] **Step 3: Implement endpoint schemas, client methods, and mapper**

Keep signing, version, throttling, retries, and protocol-error behavior in the existing client boundary.

- [ ] **Step 4: Write failing malicious/invalid crest tests**

Cover HTML with image headers, body larger than 2 MiB, unsupported signatures, redirect loops/non-HTTPS final URLs, duplicate content hashes, and a valid PNG/WebP. Assert invalid bodies never call storage.

- [ ] **Step 5: Implement safe loader and deterministic storage key support**

Add a named/content-addressed put operation to both storage adapters without changing random upload behavior. Verify redirects and final scheme before validation.

- [ ] **Step 6: Verify GREEN**

Run: `pnpm --filter @efm/api test -- pesdata-client.spec.ts pesdata-team-mapper.spec.ts pesdata-crest-loader.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 7: Commit exact PESDATA protocol and storage files**

Commit message: `feat(pesdata): ingest team shell metadata and crests`

### Task 9: Resumable PESDATA catalog synchronization and review controls

**Files:**
- Create: `apps/api/src/pesdata-sync/pesdata-team-sync.service.ts`
- Create: `apps/api/src/pesdata-sync/pesdata-team-sync.service.spec.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata-sync.module.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata-sync.cli.ts`
- Modify: `apps/api/src/pesdata-sync/pesdata-sync.cli.spec.ts`
- Modify: `apps/api/src/team-catalog/team-catalog.service.ts`
- Modify: `apps/api/src/team-catalog/team-catalog.service.spec.ts`
- Modify: `apps/api/src/team-catalog/admin-team-catalog.controller.ts`
- Create: `apps/admin-web/src/leagues/team-catalog-sync-card.tsx`
- Create: `apps/admin-web/src/leagues/team-catalog-sync-card.spec.tsx`
- Modify: `apps/admin-web/src/leagues/teams-page.tsx`
- Create: `docs/development/pesdata-team-sync.md`

**Interfaces:**
- Consumes: Task 8 client/mapper/crest loader and Task 3 catalog service.
- Produces: team modes `sample`, `full`, `incremental`, `resume`; staged catalog differences; explicit publish/reject actions; sync summary and checkpoints.

- [ ] **Step 1: Write failing synchronization tests**

Assert stable ordering, source checksums, new/changed/skipped/failed counts, resume without repeating successful work, no automatic publish, and `SOURCE_UNCONFIRMED` rather than deletion for missing source items. Assert an upstream protocol error fails the run without changing published catalog rows.

- [ ] **Step 2: Verify RED**

Run: `pnpm --filter @efm/api test -- pesdata-team-sync.service.spec.ts pesdata-sync.cli.spec.ts --runInBand`

Expected: FAIL because team synchronization modes do not exist.

- [ ] **Step 3: Implement orchestration, CLI mode selection, and review/publish integration**

Use the Task 2 `TeamCatalogSyncRun` and `TeamCatalogSyncItem` records for checkpoints and staged differences. Reuse the proven retry/checksum patterns from player synchronization, but do not overload player import batches with team catalog payloads.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm --filter @efm/api test -- pesdata-team-sync.service.spec.ts pesdata-sync.cli.spec.ts --runInBand`

Expected: PASS.

- [ ] **Step 5: Add admin sync status/action coverage and operations guide**

Add a catalog sync card with last-sync status, sample/incremental triggers, staged-difference review, and explicit publish/reject actions; test that no browser request goes to PESDATA.

- [ ] **Step 6: Commit exact sync, admin, and documentation files**

Commit message: `feat(pesdata): synchronize reviewed team shell catalog`

### Task 10: Full regression, migration rehearsal, and release evidence

**Files:**
- Modify: `apps/admin-web/src/leagues/seasons-page.spec.tsx`
- Modify: `apps/admin-web/src/leagues/team-detail-page.spec.tsx`
- Modify: `apps/api/src/admin/admin-league-seasons.service.spec.ts`
- Modify: `apps/api/src/competitions/my-competitions.service.spec.ts`
- Modify: `apps/api/src/league-economy/team-assets.service.spec.ts`
- Modify: `apps/api/src/league-rosters/roster-transactions.service.spec.ts`
- Modify: `apps/api/src/league-rosters/salary-rules.service.spec.ts`
- Modify: `apps/api/src/leagues/leagues.service.spec.ts`
- Modify: `apps/api/src/leagues/season-entries.service.spec.ts`
- Modify: `apps/api/src/leagues/seasons.service.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/leagues/leagues.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/team-assets/team-assets.viewmodel.spec.ts`
- Modify: `docs/development/pesdata-team-sync.md`

**Interfaces:**
- Consumes: Tasks 1–9.
- Produces: a green repository verification and documented local migration/sync rehearsal.

- [ ] **Step 1: Run focused suites and fix only feature-caused regressions via RED→GREEN**

Run: `pnpm --filter @efm/contracts test && pnpm --filter @efm/api test && pnpm --filter @efm/admin-web test && pnpm --filter @efm/miniprogram test`

Expected: PASS.

- [ ] **Step 2: Rehearse migration against a disposable local database**

Run the migration on a database seeded with at least two legacy teams, including a null logo and duplicate display names; assert every team has a distinct catalog ID, preserved display data, and no duplicate league assignment.

- [ ] **Step 3: Run repository verification**

Run: `pnpm verify`

Expected: lint, typecheck, unit tests, API e2e tests, and builds all PASS with no hidden test failures.

- [ ] **Step 4: Record authorized sample-sync command without publishing**

Document and, only when valid local authorization/config is present, run a two-team dry-run. If credentials are unavailable, report this as an external verification prerequisite rather than fabricating success.

- [ ] **Step 5: Commit exact remaining fixtures and documentation**

Commit message: `test: verify team shell catalog workflow`
