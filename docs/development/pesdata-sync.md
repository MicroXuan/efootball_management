# PESDATA 球员卡同步操作指南

本功能只在已获得数据来源方授权的前提下使用。同步由 NestJS 后端执行，微信小程序不会直接请求 PESDATA，也不会包含签名材料。

## 1. 推荐操作入口

平台管理员登录后台后，进入 **数据同步**（`/platform/data-sync`），默认打开“球员卡”页签。这里是日常操作入口：

- **抽样同步**：目标是新增指定数量的待审核球员卡（默认 100 条），不是只检查来源列表前 N 条；系统会每次检查 50 条并自动继续，直到凑满目标或确认数据源耗尽；
- **增量同步**：日常使用，只补充新增、发生变化或上次失败的数据；
- **全量同步**：重新扫描全部球员卡，耗时长且会产生大量待审核批次，界面会二次确认；
- **继续任务**：只在任务因进程中断等可恢复原因失败时显示，位于“同步任务历史”的对应行。

启动任务后接口立即返回，页面每 2.5 秒刷新一次进度，无需停留在当前页面。进度同时显示“新增 X/Y”和“已检查 Z”，因此检查 140 条、最终新增 100 条是正常结果，不表示多处理了 40 条。若数据源耗尽时只能找到 60 条新卡，任务以“部分完成，新增 60/100”结束。离开再返回、刷新浏览器或重新登录都不会丢失任务和审核记录。

增量和全量任务点击“暂停”后，会先让正在执行的最多 50 条分片安全提交，再进入暂停状态。暂停、恢复或取消任务都不会删除已生成的待确认批次；管理员可在任务暂停或取消后继续审核、发布或驳回这些批次。取消只是不再继续扫描来源。

“同步完成”只表示候选数据准备完毕，并不等于已经进入正式球员目录。批次必须由平台管理员查看明细、确认后整批发布；有无效记录的批次不能发布。列表默认显示待发布、有无效记录和失败批次，已发布和已驳回数据需主动勾选筛选。批次及记录均使用服务端分页，每页只提供 20 或 50 条，避免一次加载数万条数据；记录可按差异类型以及球员名、卡片名或来源 ID 筛选。活动任务进入完成或失败状态后，历史和审核列表会随轮询结果自动刷新。

## 2. 配置

把以下配置写入本地 `.env` 或部署平台的加密环境变量：

```dotenv
PESDATA_BASE_URL=https://pesdata.net
PESDATA_SITE_VERSION=1.9.0
PESDATA_SIGNATURE_SEED=<来源方当前授权协议所需的签名材料>
PESDATA_REQUESTS_PER_SECOND=1
PESDATA_TIMEOUT_MS=15000
PESDATA_MAX_RETRIES=5
```

`.env` 已被 Git 忽略。签名材料不得进入 Git、小程序包、截图、日志或公开 API。接口或签名协议变化时，应停止同步并更新后端适配器；不要绕过验证码、登录、WAF 或其他访问控制。

## 3. 后台权限与 CLI 操作人

后台入口仅对 `PLATFORM_ADMIN` 开放；普通联赛管理员看不到菜单，也不能调用 `/v1/admin/data-sync/*`。

CLI 是后台不可用时的应急手段，不是日常操作入口。除只读 `--dry-run` 外，命令中的 `--actor` 是 `admin_accounts.id` 中有效的平台管理员 UUID，与后台分片任务使用相同的权限和执行路径。

本地可查询平台管理员：

```bash
export EFM_LOCAL_ACTOR_ID="$(docker compose exec -T mysql mysql \
  --user=efm --password=efm_local --database=efootball_management \
  --batch --skip-column-names \
  -e "SELECT id FROM admin_accounts WHERE platform_role='PLATFORM_ADMIN' AND status='ACTIVE' LIMIT 1")"
test -n "$EFM_LOCAL_ACTOR_ID"
```

生产环境应通过正式的成员与角色管理流程授权，不能直接修改数据库。

## 4. 连接检查与样本验收（CLI 回退）

先读取 2 条，不写同步运行和导入批次：

```bash
pnpm sync:pesdata sample --actor "$EFM_LOCAL_ACTOR_ID" --limit 2 --dry-run
```

预期 `fetchedCount=2`、`failedCount=0`、`batchIds=[]`、`runId=null`。

再创建 100 条待审核样本：

```bash
pnpm sync:pesdata sample --actor "$EFM_LOCAL_ACTOR_ID" --limit 100
```

预期运行状态为 `READY`、`matched_count=100`、没有协议错误，并生成一个或多个 `READY` 导入批次。`scanned_count` 可以大于 100，因为已发布或已在待审核批次中的来源卡只计入检查数，不计入新增目标。该命令不会发布目录版本。

## 5. 检查运行与导入内容

在数据库客户端中使用返回的运行 ID 和批次 ID：

```sql
SELECT id, mode, status, source_total, scanned_count, fetched_count,
       skipped_count, failed_count, current_offset, error_code
FROM external_sync_runs
WHERE id = '<run-id>';

SELECT external_id, status, attempts, last_error
FROM external_sync_items
WHERE run_id = '<run-id>'
ORDER BY external_id
LIMIT 100;

SELECT row_number, external_id, diff_type, validation_errors, normalized_json
FROM import_records
WHERE batch_id = '<batch-id>'
ORDER BY row_number;
```

至少抽查 5 张不同位置、不同卡片类型的记录，确认中英文名、总评、卡图 URL、技能、能力值、卡包、球队和国籍。图片保持来源站远程 HTTPS URL，本阶段不批量复制图片。

确认没有自动发布：

```sql
SELECT * FROM catalog_releases WHERE import_batch_id = '<batch-id>';
```

审核无误后才显式发布：

```bash
pnpm player-import:publish '<batch-id>' --actor "$EFM_LOCAL_ACTOR_ID"
```

## 6. 全量、增量与恢复

```bash
pnpm sync:pesdata full --actor "$EFM_LOCAL_ACTOR_ID"
pnpm sync:pesdata incremental --actor "$EFM_LOCAL_ACTOR_ID"
pnpm sync:pesdata resume '<run-id>' --actor "$EFM_LOCAL_ACTOR_ID"
```

默认每秒最多一个请求。每个持久化分片最多检查 50 条来源记录，成功结果、审核批次和下一页偏移在同一数据库事务内提交。当前约 4.3 万张卡需要逐条补全详情，全量预计约 12–15 小时。运行会保存分页偏移和条目状态，进程中断后用 `resume` 继续；相同内容会复用现有导入批次。每个分片会生成独立审核批次，每个批次都必须独立审核。

后续日常使用 `incremental`。它跳过摘要未变化且曾成功获取详情的卡片，重新获取新增、摘要变化或上次失败的卡片。来源列表暂时缺少某张卡不会自动把正式卡片下架。

### 服务重启后的行为

任务进度、已获取条目和已生成批次都保存在数据库中，重启 API 服务不会清空进度。启动时会把租约已过期的 `PENDING`/`RUNNING` 任务恢复为可执行的 `PENDING`，并从最后一次已提交的 50 条检查点继续调度；不会从头重复创建审核记录。租约同时保存工作进程所有权令牌；过期进程即使稍后收到上游响应，也无法再写入明细、检查点或最终状态。

## 7. 清理同步工作区

需要清空同步任务和未发布候选批次时，先预览，再显式执行：

```bash
pnpm data-sync:clear
pnpm data-sync:clear -- --execute
pnpm data-sync:clear
```

该命令只删除球员/球队同步运行、同步明细、运行与批次关联，以及这些关联指向的非 `PUBLISHED` 批次。它不会删除已发布批次、目录发布记录、正式球员卡、球队目录或审计日志。命令只输出计数，不输出行内容或凭据。

遇到 `PESDATA_PROTOCOL_ERROR`、403、验证码或响应结构变化时立即停止，不要提高并发或尝试规避限制。修复并验证协议适配器后再恢复运行。
