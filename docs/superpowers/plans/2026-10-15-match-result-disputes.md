# 赛果争议取证与管理员仲裁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有双方确认赛果流程上增加 24 小时确认期限、异常补证、管理员仲裁、私有图片留存与完整操作审计。

**Architecture:** 保留 `MatchResultVersion` 作为不可变比分版本，新增争议、证据、上传会话和事件模型。生产环境由 API 签发 CloudBase/COS 临时直传信息，小程序直传对象存储后完成登记；后台工作器推进期限并删除到期对象。正常确认路径仍然不需要图片，争议和强制截图通过同一证据服务接入。

**Tech Stack:** NestJS、Prisma/MariaDB、Zod contracts、CloudBase Object Storage、原生微信小程序 TypeScript/WXML/WXSS、React/Ant Design、Jest/Vitest。

**Spec:** `docs/superpowers/specs/2026-10-15-match-result-disputes-design.md`

## Global Constraints

- 确认期限固定 24 小时，补证期限固定 24 小时。
- 联赛级 `resultEvidenceRequired` 默认 `false`；第一版不提供赛事级或阶段级覆盖。
- 普通比赛提交和确认不要求图片；强制截图仅要求提交方 1 张，对手确认无需重复上传。
- 拒绝后双方各提交 1 张，管理员可选 1 张；每场最多 3 张有效证据。
- 仅允许 JPEG、PNG、WebP；客户端目标 500–800KB，服务端硬限制 1MB。
- 正式证据使用私有对象键和短时读取地址，不保存二进制或永久公开 URL。
- 官方结果确定 90 天后删除图片，但比分、操作者、时间、原因、证据元数据和事件永久保留。
- 不读取微信群截图，不调用群机器人，不把群消息作为赛果依据。
- 生产环境直传域名必须加入微信小程序 request 合法域名；本地存储提供受鉴权的开发上传回退路径。
- 不创建 PR，除非用户另行明确要求。

## Review Focus

- 确认请求与 24 小时超时申请同时到达时，只允许锁内先成功的一方改变状态，另一方得到版本冲突。
- 强制截图上传完成但比分提交失败时，上传会话保持可重试且不能生成重复有效证据。
- 拒绝方或提交方逾期不补证时，争议仍在截止后进入管理员队列，并明确记录缺失方。
- 已软删除联赛、已归档球队、已取消赛事或无联赛权限的用户不能上传、查看或仲裁证据。
- 对象删除失败时不得写 `deletedAt`；重试成功后只追加一次删除事件。

---

### Task 1: 赛果争议契约、数据库模型与联赛开关

**Files:**
- Create: `packages/contracts/src/match-result-dispute.ts`
- Modify: `packages/contracts/src/competition.ts`
- Modify: `packages/contracts/src/league.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`
- Modify: `apps/api/prisma/schema.prisma`
- Create: `apps/api/prisma/migrations/20261016010000_match_result_disputes/migration.sql`

**Interfaces:**
- Produces: `MatchResultDisputeResponse`, `MatchResultEvidenceResponse`, `MatchResultTimelineEvent`, `CreateEvidenceUploadRequest/Response`, `CompleteEvidenceUploadRequest`, `OpenTimeoutDisputeRequest`, `AdminResolveMatchResultDisputeRequest`。
- Produces: `CompetitionMatchStatus.DISPUTED`、`League.resultEvidenceRequired`、`CompetitionMatch.resultConfirmationDeadlineAt` 及 Prisma 的 dispute/evidence/upload/event 模型。

- [ ] **Step 1: Write failing contract tests**

在 `contracts.spec.ts` 增加测试，断言：24 小时流程所需状态可解析；上传大小最大 `1_048_576`；管理员替换比分必须包含比分与非空原因；`USE_SUBMITTED_SCORE` 不接受替换比分；联赛响应默认暴露 `resultEvidenceRequired: false`。

- [ ] **Step 2: Run contract tests and verify RED**

Run: `pnpm --filter @efm/contracts test`

Expected: FAIL，缺少争议契约和联赛字段。

- [ ] **Step 3: Add schemas, Prisma models, relations, indexes and migration**

新增枚举 `MatchResultDisputeStatus`、`MatchResultDisputeTrigger`、`MatchResultDecisionType`、`MatchResultEvidenceRole`、`MatchResultEvidenceStatus`、`MatchResultEventType`、`MatchResultEvidenceUploadStatus`。上传会话必须包含 `expiresAt` 和唯一对象键；每场未结束争议通过可查询索引和事务检查保证唯一。

- [ ] **Step 4: Generate Prisma client and run contract/type checks**

Run: `pnpm --filter @efm/api prisma:generate && pnpm --filter @efm/contracts test && pnpm --filter @efm/api typecheck`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/contracts apps/api/prisma
git commit -m "feat: add match result dispute models"
```

### Task 2: 私有证据对象存储与上传会话

**Files:**
- Modify: `apps/api/src/storage/object-storage.ts`
- Modify: `apps/api/src/storage/cloudbase-object-storage.ts`
- Modify: `apps/api/src/storage/local-object-storage.ts`
- Modify: `apps/api/src/storage/storage.module.ts`
- Modify: `apps/api/src/storage/image-validation.ts`
- Create: `apps/api/src/competitions/result-evidence-storage.service.ts`
- Create: `apps/api/src/competitions/result-evidence-storage.service.spec.ts`
- Create: `apps/api/src/competitions/result-evidence.controller.ts`
- Create: `apps/api/src/competitions/result-evidence.controller.spec.ts`
- Modify: `apps/api/src/competitions/competitions.module.ts`

**Interfaces:**
- Consumes: Task 1 upload/evidence contracts and Prisma models。
- Produces: `ObjectStorage.createDirectUpload(scope, name, mimeType)`、`ObjectStorage.temporaryReadUrl(key, maxAgeSeconds)`、`ObjectStorage.inspect(key)`。
- Produces: `ResultEvidenceStorageService.createUserUpload(userId, matchId, input)`、`completeUserUpload(userId, matchId, uploadId, input)`、`userReadUrl(...)`，以及对应 `/matches/:matchId/result-evidence/uploads` API。

- [ ] **Step 1: Write failing storage and controller tests**

覆盖 CloudBase `getUploadMetadata` 映射、10 分钟读取地址、私有 `match-result-evidence` scope、本地鉴权回退、1MB/类型限制、跨比赛完成上传拒绝、归档球队和软删除联赛拒绝。验证上传成功但未登记只保留 `PENDING` 会话，不创建 evidence。

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd apps/api && JEST_SCOPE=unit NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --config jest.config.ts --runInBand src/competitions/result-evidence-storage.service.spec.ts src/competitions/result-evidence.controller.spec.ts src/storage/image-validation.spec.ts`

Expected: FAIL，上传接口和存储能力尚不存在。

- [ ] **Step 3: Implement provider-neutral direct upload and evidence sessions**

CloudBase 使用 SDK `getUploadMetadata` 返回 PUT URL 与必需请求头，`getTempFileURL` 生成短时读取地址；本地 provider 返回受 JWT/Admin guard 保护的原始 PUT 回退 URL。完成接口必须调用 `inspect` 校验对象存在、MIME 和真实大小，再把会话标为 `UPLOADED`。

- [ ] **Step 4: Run focused tests and typecheck**

Run: `cd apps/api && JEST_SCOPE=unit NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --config jest.config.ts --runInBand src/competitions/result-evidence-storage.service.spec.ts src/competitions/result-evidence.controller.spec.ts src/storage/image-validation.spec.ts && pnpm typecheck`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/storage apps/api/src/competitions
git commit -m "feat: add private result evidence uploads"
```

### Task 3: 正常赛果确认、强制截图与永久事件流水

**Files:**
- Create: `apps/api/src/competitions/match-result-events.service.ts`
- Create: `apps/api/src/competitions/match-result-events.service.spec.ts`
- Modify: `apps/api/src/competitions/results.service.ts`
- Modify: `apps/api/src/competitions/results.service.spec.ts`
- Modify: `apps/api/src/competitions/my-competitions.service.ts`
- Modify: `apps/api/src/competitions/my-competitions.service.spec.ts`
- Modify: `apps/api/src/competitions/competitions.module.ts`

**Interfaces:**
- Consumes: Task 1 event/evidence models；Task 2 已完成上传会话。
- Produces: `MatchResultEventsService.append(tx, event)` 和扩展后的 `ResultsService.submit/confirm/reject`。
- Produces: `MyMatchResponse` 中的 `confirmationDeadlineAt`、`evidenceRequired`、`disputeSummary`、`timeline`。

- [ ] **Step 1: Write failing result-flow tests**

覆盖：普通提交无需图片；强制模式没有 `evidenceUploadId` 时拒绝；有效上传会话只消费一次；提交写入 `RESULT_SUBMITTED` 和 24 小时截止时间；对手确认写确认人事件、清空截止时间、生成官方结果并把已有证据到期时间设为确认时间加 90 天；重复提交失败不重复消费证据。

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd apps/api && JEST_SCOPE=unit NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --config jest.config.ts --runInBand src/competitions/results.service.spec.ts src/competitions/my-competitions.service.spec.ts src/competitions/match-result-events.service.spec.ts`

Expected: FAIL，现有流程没有期限、强制证据和事件。

- [ ] **Step 3: Implement transactional event and deadline integration**

`submit` 在同一事务中消费上传会话、创建 evidence、设置 `now + 24h`；`confirm` 写明确确认者事件。所有事件使用业务唯一键避免幂等重放产生重复记录。

- [ ] **Step 4: Run focused tests and API typecheck**

Run: `cd apps/api && JEST_SCOPE=unit NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --config jest.config.ts --runInBand src/competitions/results.service.spec.ts src/competitions/my-competitions.service.spec.ts src/competitions/match-result-events.service.spec.ts && pnpm typecheck`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/competitions
git commit -m "feat: audit confirmed match results"
```

### Task 4: 拒绝争议、超时申请与期限推进

**Files:**
- Create: `apps/api/src/competitions/match-result-disputes.service.ts`
- Create: `apps/api/src/competitions/match-result-disputes.service.spec.ts`
- Create: `apps/api/src/competitions/match-result-deadline.worker.ts`
- Create: `apps/api/src/competitions/match-result-deadline.worker.spec.ts`
- Modify: `apps/api/src/competitions/results.service.ts`
- Modify: `apps/api/src/competitions/results.service.spec.ts`
- Modify: `apps/api/src/competitions/results.controller.ts`
- Modify: `apps/api/src/competitions/competitions.module.ts`

**Interfaces:**
- Consumes: Tasks 1–3 比分、上传、证据和事件接口。
- Produces: `MatchResultDisputesService.openFromRejection(...)`、`openFromTimeout(...)`、`attachEvidence(...)`、`getForParticipant(...)`、`advanceDue(now)`。
- Produces: `POST /matches/:matchId/result-disputes/timeout`、`GET /matches/:matchId/result-dispute`、争议补证完成接口。

- [ ] **Step 1: Write failing dispute lifecycle tests**

覆盖：拒绝立即创建 `EVIDENCE_COLLECTION`、比赛进入 `DISPUTED`、双方各 24 小时补证；超时前禁止仲裁申请；超时后必须由提交方携带已完成截图申请；双方齐全提前进入 `READY_FOR_REVIEW`；截止后即使一方缺证也推进并追加缺失方事件。

- [ ] **Step 2: Add the Review Focus concurrency tests**

在 `results.service.spec.ts` 同时发起确认与超时申请，断言仅一个成功；对重复 worker tick 断言不重复创建争议或期限事件。

- [ ] **Step 3: Run focused tests and verify RED**

Run: `cd apps/api && JEST_SCOPE=unit NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --config jest.config.ts --runInBand src/competitions/match-result-disputes.service.spec.ts src/competitions/match-result-deadline.worker.spec.ts src/competitions/results.service.spec.ts`

Expected: FAIL，争议服务和 deadline worker 尚不存在。

- [ ] **Step 4: Implement dispute transitions and five-minute worker**

Worker 每 5 分钟扫描到期确认和补证期限；服务的读取、补证与仲裁写操作也先调用单比赛期限校正。拒绝、确认和超时申请共享比赛行锁与 `expectedVersion`。

- [ ] **Step 5: Run focused tests and typecheck**

Run: `cd apps/api && JEST_SCOPE=unit NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --config jest.config.ts --runInBand src/competitions/match-result-disputes.service.spec.ts src/competitions/match-result-deadline.worker.spec.ts src/competitions/results.service.spec.ts && pnpm typecheck`

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/competitions
git commit -m "feat: add match result dispute lifecycle"
```

### Task 5: 管理员仲裁、证据读取与 90 天清理

**Files:**
- Create: `apps/api/src/competitions/admin-match-result-disputes.controller.ts`
- Create: `apps/api/src/competitions/admin-match-result-disputes.controller.spec.ts`
- Create: `apps/api/src/competitions/admin-match-result-disputes.service.ts`
- Create: `apps/api/src/competitions/admin-match-result-disputes.service.spec.ts`
- Create: `apps/api/src/competitions/result-evidence-retention.worker.ts`
- Create: `apps/api/src/competitions/result-evidence-retention.worker.spec.ts`
- Modify: `apps/api/src/competitions/competitions.module.ts`
- Modify: `apps/api/src/competitions/results.service.ts`

**Interfaces:**
- Consumes: Tasks 1–4 的争议、证据、事件、积分与杯赛晋级能力。
- Produces: 管理端争议列表/详情/临时证据 URL/裁决 API，以及 `AdminMatchResultDisputesService.resolve(adminId, leagueId, disputeId, input)`。
- Produces: `ResultEvidenceRetentionWorker.cleanup(now)`，每日删除 90 天到期证据和 24 小时孤儿上传。

- [ ] **Step 1: Write failing administrator arbitration tests**

覆盖联赛授权、未结束补证期禁止提前裁决、原比分采用、替换比分、必填原因、可选管理员证据、裁决后证据到期时间为 90 天、旧官方结果 `SUPERSEDED`、积分重算、淘汰赛晋级修正和管理员 audit log。另覆盖无争议的管理员直接修改官方比分仍可选附证据且必须填写原因。

- [ ] **Step 2: Write failing retention tests**

覆盖：未解决争议不删除；官方结果 90 天前不删除；到期成功后写 `deletedAt` 和单个 `EVIDENCE_DELETED`；存储删除失败不写删除状态且下次重试；24 小时上传孤儿被删除。

- [ ] **Step 3: Run focused tests and verify RED**

Run: `cd apps/api && JEST_SCOPE=unit NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --config jest.config.ts --runInBand src/competitions/admin-match-result-disputes.service.spec.ts src/competitions/admin-match-result-disputes.controller.spec.ts src/competitions/result-evidence-retention.worker.spec.ts`

Expected: FAIL，管理端服务和保留 worker 尚不存在。

- [ ] **Step 4: Implement arbitration and cleanup workers**

裁决事务必须同时生成官方结果、更新争议、写事件和审计，并调用现有积分/杯赛推进逻辑。清理 worker 每日运行，按 ID 小批量处理并可安全重入。

- [ ] **Step 5: Run focused tests and API suites**

Run: `cd apps/api && JEST_SCOPE=unit NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --config jest.config.ts --runInBand src/competitions/admin-match-result-disputes.service.spec.ts src/competitions/admin-match-result-disputes.controller.spec.ts src/competitions/result-evidence-retention.worker.spec.ts src/competitions/results.service.spec.ts && pnpm typecheck`

Expected: PASS。

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/competitions
git commit -m "feat: add result dispute arbitration"
```

### Task 6: 小程序赛果、证据与争议页面

**Files:**
- Modify: `apps/miniprogram/miniprogram/services/competitions.ts`
- Create: `apps/miniprogram/miniprogram/services/result-evidence.ts`
- Create: `apps/miniprogram/miniprogram/services/result-evidence.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/match-result/index.ts`
- Modify: `apps/miniprogram/miniprogram/pages/match-result/index.wxml`
- Modify: `apps/miniprogram/miniprogram/pages/match-result/index.wxss`
- Modify: `apps/miniprogram/miniprogram/pages/match-result/result.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/match-result/result.viewmodel.spec.ts`
- Create: `apps/miniprogram/miniprogram/pages/match-result/match-result.page.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/matches.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/matches.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/my-matches/index.wxml`

**Interfaces:**
- Consumes: Tasks 2–5 用户 API 和争议 read model。
- Produces: `chooseAndCompressEvidence()`、`uploadEvidenceGrant()`、`completeEvidenceUpload()`，以及 match-result 页面状态 `SUBMIT/WAIT_CONFIRM/CONFIRM/CONFIRMATION_EXPIRED/EVIDENCE_COLLECTION/READY_FOR_REVIEW/DONE`。

- [ ] **Step 1: Write failing service, view-model, page and template tests**

覆盖普通提交无图、强制模式上传后提交、拒绝确认提示、拒绝后双方补证状态、24 小时超时申请、图片压缩目标、1MB 客户端拦截、对方仅显示是否已提交、不展示证据 URL、已裁决时间线。

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd apps/miniprogram && pnpm exec vitest run miniprogram/services/result-evidence.spec.ts miniprogram/pages/match-result/result.viewmodel.spec.ts miniprogram/pages/match-result/match-result.page.spec.ts miniprogram/pages/my-matches/matches.viewmodel.spec.ts miniprogram/pages/my-matches/my-matches.template.spec.ts`

Expected: FAIL，上传服务和新页面状态不存在。

- [ ] **Step 3: Implement direct PUT upload and state-driven UI**

使用 `wx.chooseMedia`、`wx.compressImage`、文件系统读取与 `wx.request` PUT 完成生产直传；本地 grant URL 使用相同调用接口。所有按钮在请求期间防重复，版本冲突后保留用户输入并重新加载。

- [ ] **Step 4: Run miniprogram tests and typecheck**

Run: `pnpm --filter @efm/miniprogram test && pnpm --filter @efm/miniprogram typecheck`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/miniprogram
git commit -m "feat: add match result evidence flow"
```

### Task 7: 联赛强制截图设置与管理员争议工作台

**Files:**
- Modify: `apps/api/src/leagues/admin-leagues.controller.ts`
- Modify: `apps/api/src/leagues/leagues.service.ts`
- Modify: `apps/api/src/leagues/leagues.service.spec.ts`
- Modify: `apps/admin-web/src/app.tsx`
- Modify: `apps/admin-web/src/leagues/league-shell.tsx`
- Create: `apps/admin-web/src/leagues/result-disputes-page.tsx`
- Create: `apps/admin-web/src/leagues/result-disputes-page.spec.tsx`
- Modify: `apps/admin-web/src/lib/api.ts`
- Modify: `apps/admin-web/src/design-system/icons.tsx`

**Interfaces:**
- Consumes: Task 1 联赛开关和 Task 5 管理 API。
- Produces: `/leagues/:leagueId/result-disputes` 工作台；联赛级强制截图设置更新并写管理员审计。

- [ ] **Step 1: Write failing API and React tests**

覆盖默认关闭、管理员开关并记录审计、补证到期优先排序、证据私有预览、缺证方提示、替换比分表单、原因必填、可选管理员证据和裁决后刷新。

- [ ] **Step 2: Run focused tests and verify RED**

Run: `cd apps/api && JEST_SCOPE=unit NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --config jest.config.ts --runInBand src/leagues/leagues.service.spec.ts src/competitions/admin-match-result-disputes.service.spec.ts && cd ../admin-web && pnpm exec vitest run src/leagues/result-disputes-page.spec.tsx`

Expected: FAIL，开关和工作台尚未接入。

- [ ] **Step 3: Implement league rule UI, queue and arbitration drawer**

导航名称使用“赛果争议”；开关文案明确“默认关闭，开启后每场由比分提交方上传 1 张截图”。证据 URL 只在用户展开争议时请求，不写入浏览器持久缓存。

- [ ] **Step 4: Run admin/API tests and typechecks**

Run: `pnpm --filter @efm/api test -- --runInBand leagues.service.spec.ts admin-match-result-disputes.service.spec.ts && pnpm --filter @efm/admin-web test -- result-disputes-page.spec.tsx && pnpm --filter @efm/admin-web typecheck`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/leagues apps/admin-web
git commit -m "feat: add result dispute admin workspace"
```

### Task 8: 待办中心赛果提醒与全链路回归

**Files:**
- Modify: `packages/contracts/src/action-center.ts`
- Modify: `packages/contracts/src/contracts.spec.ts`
- Modify: `apps/api/src/action-center/action-center.service.ts`
- Modify: `apps/api/src/action-center/action-center.service.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/action-center/action-center.viewmodel.ts`
- Modify: `apps/miniprogram/miniprogram/pages/action-center/action-center.viewmodel.spec.ts`
- Modify: `apps/miniprogram/miniprogram/pages/action-center/index.wxml`

**Interfaces:**
- Consumes: Task 3–5 的比赛、争议和事件状态。
- Produces: `ActionCenterSource.MATCH_RESULT`，提醒 `待确认/确认超时/需要补证/等待仲裁/裁决完成`，深链 `/pages/match-result/index?id=<matchId>`。

- [ ] **Step 1: Write failing projection and view-model tests**

断言待我确认和待我补证属于 `ACTION_REQUIRED`；提交方等待对手和等待管理员属于 `STATUS_UPDATE`；裁决完成属于 `RECENT`；跨联赛筛选不误标读；已删除联赛和已归档球队不产生提醒。

- [ ] **Step 2: Run focused tests and verify RED**

Run: `pnpm --filter @efm/contracts test && cd apps/api && JEST_SCOPE=unit NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --config jest.config.ts --runInBand src/action-center/action-center.service.spec.ts && cd ../miniprogram && pnpm exec vitest run miniprogram/pages/action-center/action-center.viewmodel.spec.ts miniprogram/pages/action-center/action-center.page.spec.ts`

Expected: FAIL，`MATCH_RESULT` 来源和投影不存在。

- [ ] **Step 3: Implement role-aware result reminders**

按当前用户在比赛中的身份计算动作，不能把对方的补证任务计入我的角标；完成提醒沿用本地 ID + version 已读模型。

- [ ] **Step 4: Run focused and package tests**

Run: `pnpm --filter @efm/contracts test && pnpm --filter @efm/api test -- --runInBand action-center.service.spec.ts && pnpm --filter @efm/miniprogram test`

Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add packages/contracts apps/api/src/action-center apps/miniprogram/miniprogram/pages/action-center
git commit -m "feat: add match result action reminders"
```

### Task 9: 全量验证、迁移审查与最终复核

**Files:**
- Modify only if verification finds a defect.

**Interfaces:**
- Consumes: Tasks 1–8 implementation。
- Produces: 可部署、可迁移且经过完整审查的当前分支，不创建 PR。

- [ ] **Step 1: Validate migration and generated client from a clean database**

Run: `pnpm --filter @efm/api prisma:generate && pnpm --filter @efm/api typecheck`

Expected: PASS，migration SQL 与 Prisma schema 一致。

- [ ] **Step 2: Run full workspace verification**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`

Expected: PASS。

- [ ] **Step 3: Review the complete diff against the spec and Review Focus**

使用独立 reviewer 检查权限、期限竞态、对象存储私密性、删除重试、积分/晋级一致性和旧客户端兼容性。

- [ ] **Step 4: Fix Critical/Important findings through RED→GREEN and rerun full verification**

Expected: 独立复审结论 Ready，无未解决 Critical/Important。

- [ ] **Step 5: Record completion without creating a PR**

记录最终提交范围、测试数量、迁移验证结果和保留的低优先级事项；保持当前分支，等待用户决定是否创建 PR。
