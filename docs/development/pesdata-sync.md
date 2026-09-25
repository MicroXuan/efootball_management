# PESDATA 授权同步操作指南

本功能只在已获得数据来源方授权的前提下使用。同步由 NestJS 后端执行，微信小程序不会直接请求 PESDATA，也不会包含签名材料。

## 1. 配置

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

## 2. 准备操作人

命令中的 `--actor` 必须是有效用户 UUID，并拥有：

- `catalog.import.create`
- `catalog.import.read`
- `catalog.import.publish`

本地可查询平台管理员：

```bash
export EFM_LOCAL_ACTOR_ID="$(docker compose exec -T mysql mysql \
  --user=efm --password=efm_local --database=efootball_management \
  --batch --skip-column-names \
  -e "SELECT u.id FROM users u JOIN user_role_bindings b ON b.user_id=u.id JOIN roles r ON r.id=b.role_id WHERE r.code='PLATFORM_ADMIN' LIMIT 1")"
test -n "$EFM_LOCAL_ACTOR_ID"
```

生产环境应通过正式的成员与角色管理流程授权，不能直接修改数据库。

## 3. 连接检查与样本验收

先读取 2 条，不写同步运行和导入批次：

```bash
pnpm sync:pesdata sample --actor "$EFM_LOCAL_ACTOR_ID" --limit 2 --dry-run
```

预期 `fetchedCount=2`、`failedCount=0`、`batchIds=[]`、`runId=null`。

再创建 100 条待审核样本：

```bash
pnpm sync:pesdata sample --actor "$EFM_LOCAL_ACTOR_ID" --limit 100
```

预期运行状态为 `READY`、100 个终态条目、没有协议错误，并生成一个 `READY` 导入批次。该命令不会发布目录版本。

## 4. 检查运行与导入内容

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

## 5. 全量、增量与恢复

```bash
pnpm sync:pesdata full --actor "$EFM_LOCAL_ACTOR_ID"
pnpm sync:pesdata incremental --actor "$EFM_LOCAL_ACTOR_ID"
pnpm sync:pesdata resume '<run-id>' --actor "$EFM_LOCAL_ACTOR_ID"
```

默认每秒最多一个请求。当前约 4.3 万张卡需要逐条补全详情，全量预计约 12–15 小时。运行会保存分页偏移和条目状态，进程中断后用 `resume` 继续；相同内容会复用现有导入批次。全量超过 5,000 条时会稳定拆成多个批次，每个批次都必须独立审核。

后续日常使用 `incremental`。它跳过摘要未变化且曾成功获取详情的卡片，重新获取新增、摘要变化或上次失败的卡片。来源列表暂时缺少某张卡不会自动把正式卡片下架。

遇到 `PESDATA_PROTOCOL_ERROR`、403、验证码或响应结构变化时立即停止，不要提高并发或尝试规避限制。修复并验证协议适配器后再恢复运行。

