# 个人赛事闭环本地验收

本文用于在本地一次性准备四名演示球员，并验证“登录 → 赛事 → 比赛 → 比分确认 → 积分榜”完整流程。演示命令只允许在非生产环境运行，重复执行不会创建重复赛事、用户、账号或赛程。

> 本文保留的是旧个人公开赛事 `OPEN_EVENT` 回归流程。联赛赛季使用独立的 `DIVISION_LEAGUE`、正式组别和参赛球队私有积分榜，两套流程不可混用。分级联赛本地数据与入口见 [本地开发指南](./local-development.md#分级联赛演示数据)。

## 1. 前置条件

- Node.js 24、pnpm 11.23.0。
- Docker Desktop 已启动，MySQL 容器可用。
- 已执行数据库迁移和种子数据，数据库中存在 `PLATFORM_ADMIN`、`EVENT_MANAGER` 角色及赛事权限。
- 微信开发者工具已导入 `apps/miniprogram`。

```bash
pnpm dev:db
pnpm db:migrate
pnpm --filter @efm/api exec prisma db seed
pnpm db:status
```

## 2. 找到本地平台管理员 UUID

演示命令的 `--actor` 必须是拥有平台级 `PLATFORM_ADMIN` 角色的用户 UUID。查询现有管理员：

```bash
export EFM_LOCAL_ACTOR_ID="$(docker compose exec -T mysql mysql -uefm -pefm_local efootball_management -N -s \
  -e "SELECT u.id FROM users u JOIN user_role_bindings b ON b.user_id=u.id JOIN roles r ON r.id=b.role_id WHERE r.code='PLATFORM_ADMIN' AND b.scope_type='PLATFORM' LIMIT 1")"
printf '%s\n' "$EFM_LOCAL_ACTOR_ID"
```

如果没有结果，先用本地登录接口创建自己的开发用户，再由数据库管理员给该用户添加平台管理员绑定。不要在共享或生产数据库中临时提升普通账号。

## 3. 配置模拟器登录

在本地 `.env` 中设置：

```dotenv
NODE_ENV=development
WECHAT_GATEWAY_MODE=fake
DEV_WECHAT_OPEN_ID=test-openid-competition-demo-1
```

此配置仅在 `fake` 网关生效。微信开发者工具产生的任意一次性 `wx.login()` code 都会映射到演示球员 1。显式的 `test-code-*` 仍保持各自确定身份，例如 `test-code-competition-demo-2` 对应演示球员 2。

生产环境必须使用 `WECHAT_GATEWAY_MODE=http`，并且不得设置 `DEV_WECHAT_OPEN_ID`。正式 HTTP 网关不会读取或使用该映射。

## 4. 创建演示赛事

```bash
pnpm competition:demo --actor "$EFM_LOCAL_ACTOR_ID"
pnpm competition:demo --actor "$EFM_LOCAL_ACTOR_ID"
```

两次输出的 `competitionId` 应完全相同，并且均应显示：

- `participantCount: 4`
- `roundCount: 3`
- `matchCount: 6`
- `status: IN_PROGRESS`

命令创建四个 `test-openid-competition-demo-1` 至 `-4` 用户、四个 MOBILE/GLOBAL 游戏账号、一个已开赛的个人单循环赛事，并给演示球员 1 授予该赛事范围内的管理员角色。

## 5. 启动 API 和小程序

```bash
pnpm start:api
```

在微信开发者工具中：

1. 导入目录 `apps/miniprogram`，确认 `miniprogramRoot` 是 `miniprogram/`。
2. 打开“详情 → 本地设置”，仅在本地开发时关闭“校验合法域名”。
3. 确认 `miniprogram/config/api.ts` 指向 `http://127.0.0.1:3000/v1`。
4. 重新编译，点击微信登录；此时应进入“演示球员 1”。

## 6. 四人赛事验收步骤

在小程序中验证：

1. “赛事”列表出现 `[DEMO] 本地四人循环赛`，状态为进行中。
2. 赛事详情的赛程包含 3 轮、6 场，任意两名球员只交手一次。
3. “我的 → 我的比赛”展示演示球员 1 的三场比赛。
4. 进入一场比赛，提交一个 `2:1` 比分。
5. 对手确认后，返回赛事积分榜；应出现 4 行，快照版本为 1。
6. 演示球员 1 还可以从赛事详情进入工作台，查看报名、赛程和官方比分修正入口。

### 用 API 模拟对手确认

另开终端。显式测试 code 不受 `DEV_WECHAT_OPEN_ID` 影响，可用于球员 2 至 4：

```bash
API=http://127.0.0.1:3000/v1
P2_TOKEN="$(curl -sS "$API/auth/wechat" -H 'content-type: application/json' \
  -d '{"code":"test-code-competition-demo-2"}' | jq -r .accessToken)"
P3_TOKEN="$(curl -sS "$API/auth/wechat" -H 'content-type: application/json' \
  -d '{"code":"test-code-competition-demo-3"}' | jq -r .accessToken)"
P4_TOKEN="$(curl -sS "$API/auth/wechat" -H 'content-type: application/json' \
  -d '{"code":"test-code-competition-demo-4"}' | jq -r .accessToken)"

curl -sS "$API/me/matches?limit=20" -H "Authorization: Bearer $P2_TOKEN" | jq
```

从响应中找到 `action` 为 `CONFIRM` 的比赛，记录 `match.id`、`match.version` 和 `actionableResultVersion.version`，然后确认：

```bash
MATCH_ID='<match-id>'
MATCH_VERSION='<match-version>'
RESULT_VERSION='<result-version>'
curl -sS "$API/matches/$MATCH_ID/results/$RESULT_VERSION/confirm" \
  -H "Authorization: Bearer $P2_TOKEN" \
  -H 'content-type: application/json' \
  -H "Idempotency-Key: local-confirm-$MATCH_ID" \
  -d "{\"expectedVersion\":$MATCH_VERSION}" | jq
```

最后查询积分榜：

```bash
COMPETITION_ID='<competition-id>'
curl -sS "$API/competitions/$COMPETITION_ID/standings" | jq '{version, rows}'
```

首次确认官方结果后，预期 `version` 为 `1`、`rows` 长度为 `4`。

## 7. 数据库不变量检查

```bash
docker compose exec -T mysql mysql -uefm -pefm_local efootball_management \
  -e "SELECT c.id,c.status,COUNT(DISTINCT p.id) participants,COUNT(DISTINCT m.id) matches,COUNT(DISTINCT m.round_number) rounds,COUNT(DISTINCT m.pairing_key) pairing_keys FROM competitions c JOIN competition_participants p ON p.competition_id=c.id JOIN competition_stages s ON s.competition_id=c.id AND s.status='PUBLISHED' JOIN competition_matches m ON m.stage_id=s.id WHERE c.name='[DEMO] 本地四人循环赛' GROUP BY c.id,c.status;"
```

预期只有一行：4 名参赛者、6 场比赛、3 轮、6 个不同的 `pairing_key`。

## 8. 清理演示数据

只允许清理以下明确前缀的数据：

- 小程序身份：`test-openid-competition-demo-%`
- 赛事名称：`[DEMO] 本地四人循环赛`
- 游戏昵称：`DEMO-1` 至 `DEMO-4`

由于赛事历史包含多层受保护外键，不要执行宽泛的 `DELETE FROM users`。确需清理时，只在专用本地数据库运行下面的定向事务；它先锁定唯一的演示赛事与演示用户，再按外键顺序删除：

```bash
docker compose exec -T mysql mysql -uefm -pefm_local efootball_management <<'SQL'
START TRANSACTION;
CREATE TEMPORARY TABLE demo_competitions AS
  SELECT id FROM competitions WHERE name='[DEMO] 本地四人循环赛';
CREATE TEMPORARY TABLE demo_users AS
  SELECT id FROM users WHERE wechat_open_id LIKE 'test-openid-competition-demo-%';

DELETE sr FROM standings_rows sr JOIN standings_snapshots ss ON ss.id=sr.snapshot_id
  JOIN demo_competitions dc ON dc.id=ss.competition_id;
DELETE ss FROM standings_snapshots ss JOIN demo_competitions dc ON dc.id=ss.competition_id;
UPDATE competition_matches m JOIN competition_stages s ON s.id=m.stage_id
  JOIN demo_competitions dc ON dc.id=s.competition_id SET m.official_result_version_id=NULL;
DELETE rv FROM match_result_versions rv JOIN competition_matches m ON m.id=rv.match_id
  JOIN competition_stages s ON s.id=m.stage_id JOIN demo_competitions dc ON dc.id=s.competition_id;
DELETE m FROM competition_matches m JOIN competition_stages s ON s.id=m.stage_id
  JOIN demo_competitions dc ON dc.id=s.competition_id;
DELETE s FROM competition_stages s JOIN demo_competitions dc ON dc.id=s.competition_id;
DELETE p FROM competition_participants p JOIN demo_competitions dc ON dc.id=p.competition_id;
DELETE h FROM competition_registration_status_history h
  JOIN competition_registrations r ON r.id=h.registration_id
  JOIN demo_competitions dc ON dc.id=r.competition_id;
DELETE r FROM competition_registrations r JOIN demo_competitions dc ON dc.id=r.competition_id;
DELETE b FROM user_role_bindings b JOIN demo_competitions dc ON dc.id=b.scope_id;
DELETE rv FROM competition_rule_versions rv JOIN demo_competitions dc ON dc.id=rv.competition_id;
DELETE c FROM competitions c JOIN demo_competitions dc ON dc.id=c.id;
DELETE mr FROM mutation_receipts mr LEFT JOIN demo_users du ON du.id=mr.actor_id
  WHERE du.id IS NOT NULL OR mr.`key` LIKE 'competition-demo:%';
DELETE rs FROM refresh_sessions rs JOIN demo_users du ON du.id=rs.user_id;
DELETE b FROM user_role_bindings b JOIN demo_users du ON du.id=b.user_id;
DELETE ga FROM game_accounts ga JOIN demo_users du ON du.id=ga.user_id;
DELETE u FROM users u JOIN demo_users du ON du.id=u.id;
COMMIT;
SQL
```

绝不能在 CloudBase、预发或生产数据库中运行演示命令或清理操作。

## 9. 常见错误

- `COMPETITION_DEMO_ACTOR_REQUIRED`：未提供合法 UUID 格式的 `--actor`。
- `COMPETITION_DEMO_ACTOR_NOT_ADMIN`：该用户没有有效的平台级管理员绑定。
- `COMPETITION_DEMO_DISABLED`：当前 `NODE_ENV=production`，演示命令按设计拒绝运行。
- 小程序仍登录成新用户：确认 `.env` 使用 fake 网关、`DEV_WECHAT_OPEN_ID` 拼写正确，并重启 API。

## 10. 新旧赛事兼容回归

发布前同时运行个人赛事与分级联赛用例：

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
set -a; source .env; set +a
pnpm --filter @efm/api test:e2e -- competitions.e2e-spec.ts tiered-league.e2e-spec.ts --runInBand
```

个人赛事仍应保持单循环比赛数、正式比分和公开积分榜；分级联赛应只更新发生比赛的对应组积分榜，未报名用户访问私有榜单返回 403。
