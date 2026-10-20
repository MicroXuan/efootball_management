# 本地开发指南

本项目由 NestJS API、MySQL 8、共享契约包和原生微信小程序组成。API 默认监听 `http://127.0.0.1:3000/v1`，本地 MySQL 默认监听 `127.0.0.1:3307`。

## 1. 准备环境

- macOS，已安装 Git。
- Node.js 24 LTS。仓库的 `.nvmrc` 固定为 24，不能使用 Node 25。
- pnpm 11.23.0，由 Corepack 管理。
- MySQL 8.0/8.4。推荐 Docker；如果已经安装本机 MySQL，只要连接串一致即可。
- 微信开发者工具 Stable，并使用已注册的小程序 AppID。

```bash
cd /path/to/efootball_management
nvm install
nvm use
corepack enable
corepack prepare pnpm@11.23.0 --activate
pnpm install --frozen-lockfile
```

## 2. 配置本地环境变量

```bash
cp .env.example .env
openssl rand -hex 32
openssl rand -hex 32
```

把两次输出分别填入 `JWT_ACCESS_SECRET` 和 `REFRESH_TOKEN_PEPPER`。两个值必须不同。开发阶段保留 `WECHAT_GATEWAY_MODE=fake`；`.env` 已被 Git 忽略，不要把其中内容粘贴到提交、截图或日志中。

## 3. 启动 MySQL 并迁移

Docker 方案：

```bash
pnpm dev:db
docker compose ps
pnpm db:migrate
pnpm db:status
pnpm --filter @efm/api exec prisma db seed
```

本机 MySQL 方案：先确保 `.env` 的 `DATABASE_URL` 指向已有数据库，再执行：

```bash
pnpm db:migrate
pnpm db:status
```

开发新迁移时才使用 `pnpm db:migrate:dev`；部署已有迁移时始终使用 `pnpm db:migrate`。

## 4. 验证并启动 API

完整发布门禁必须显式连接本机隔离测试库。当前 `.env` 也可能指向共享 CloudBase 数据库；不要直接运行不带 `DATABASE_URL` 的测试或 `pnpm verify`。

```bash
DATABASE_URL=mysql://<local-user>:<local-password>@127.0.0.1:3307/efm_test pnpm verify
```

API 开发启动：

```bash
pnpm start:api
```

另开一个终端启动管理后台：

```bash
pnpm --filter @efm/admin-web dev
```

后台管理前端的启动、账号权限和完整验收见 [后台管理系统本地开发与验收](./admin-web-local-development.zh-CN.md)。联赛图片、赛季、球队绑定与小程序联动见 [联赛展示与管理员绑定验收手册](./league-presentation-verification.zh-CN.md)。联赛球队发布前必须按 [联赛球队迁移与回滚手册](./league-team-migration.zh-CN.md)完成干跑检查。

另开终端检查：

```bash
curl -i http://127.0.0.1:3000/v1/health

curl -sS http://127.0.0.1:3000/v1/auth/wechat \
  -H 'content-type: application/json' \
  -d '{"code":"test-code-local-user"}'
```

第二个请求会返回 access token 与 refresh token。不要把 token 提交到仓库或发到群聊。

## 5. 经营闭环演示数据与入口账号

需要演示数据时，在本地 `.env` 设置 `SEED_ECONOMY_DEMO=true`，并确保已配置
`LOCAL_ADMIN_USERNAME` 和有效的 `LOCAL_ADMIN_PASSWORD_HASH`，再执行种子命令。系统会幂等创建
“本地经营演示联赛”；重复执行不会把已经审核、转会或调整过的演示记录重置。演示内容包括：

- 正在开放的身价窗口和转会窗口；
- 一支身价完整的球队，以及一支含超限身价草稿的待审核球队；
- 正式球员身价、5% 交易手续费规则和最低手续费；
- 球队壳价值、工资、运营补贴与奢侈税财务明细。

后台入口为 `http://127.0.0.1:4173/login`。用户名取自
`LOCAL_ADMIN_USERNAME`，密码使用生成该 bcrypt 哈希时对应的本地明文；仓库不保存明文密码。

小程序使用假微信网关时，可分别用以下测试 code 登录两个演示球队老板：

```text
test-code-economy-demo-complete
test-code-economy-demo-review
```

进入“联赛 → 我的联赛 → 球队工作台”后，可打开“身价管理”“球队资产”“交易记录”和“球队财务”。完整队用于查看已生效身价和资产汇总；待审队用于查看超限草稿并在后台完成审核。

需要同步已获授权的 PESDATA 球员数据时，先完成基础迁移与种子数据，再按 [PESDATA 授权同步操作指南](./pesdata-sync.md)执行 2 条干跑和 100 条样本验收。同步签名材料只写入本地 `.env` 或部署平台密钥，不能放入小程序。

需要验收个人赛事的报名、赛程、比分确认与积分榜闭环时，按 [个人赛事闭环本地验收指南](./competition-loop.md)创建幂等的四人演示赛事。

### 分级联赛演示数据

需要验收首赛季分组时，在 `.env` 增加 `SEED_TIERED_LEAGUE_DEMO=true`，同时配置本地管理员账号，再重复执行种子命令：

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
set -a; source .env; set +a
pnpm --filter @efm/api exec prisma db seed
```

种子会幂等准备“本地分级联赛演示”、一个处于“分组审核”阶段的首赛季和 19 支已审核球队。重复执行不会创建重复球队、正式分组或比赛，也不会把已确认赛季退回审核状态。管理员在后台进入“联赛管理 → 分组与赛程”，依次执行：生成方案、必要时调整并填写原因、确认分组、为每个冠军组生成并发布赛程。

小程序使用 `test-code-tiered-demo-1` 至 `test-code-tiered-demo-19` 登录对应球队老板。打开“联赛 → 本地分级联赛演示”后，可查看“我的联赛工作台”；分组确认后显示所在组和积分榜，赛程发布后显示下一场比赛。未报名账号不会看到私有数据。

## 6. 导入微信小程序

1. 在微信开发者工具选择“导入项目”。
2. 目录选择仓库中的 `apps/miniprogram`，AppID 选择已注册的小程序。
3. 确认 `miniprogramRoot` 为 `miniprogram/`。
4. 启动本地 API 后重新编译小程序。开发者工具会自动请求 `http://127.0.0.1:3000/v1`，不需要手改地址。
5. 仓库已在被 Git 忽略的 `project.private.config.json` 中关闭合法域名校验；如果开发者工具覆盖了该设置，请在“详情 → 本地设置”中关闭校验。

体验版和正式版仍会校验服务器域名。请在微信公众平台的“小程序后台 → 开发管理 → 开发设置 → 服务器域名”中，将 `https://img.pesdata.net` 加入 `downloadFile` 合法域名，并保留现有 CloudBase 下载域名。球员市场头像会直接交给 `<image>` 渲染该 HTTPS 地址，不依赖二次下载；此白名单同时保障仓库中其他仍使用 `wx.downloadFile` 的图片场景。

运行时会按环境自动选择连接：

| 运行环境 | API |
| --- | --- |
| 微信开发者工具中的开发版 | 本机 `http://127.0.0.1:3000/v1` |
| 真机开发版、体验版 | CloudBase 测试服务 `efm-dev` |
| 正式版 | CloudBase 生产服务 `efm-api-production` |

### 本地代码与体验版共用测试数据库

如果需要让“本地 API 代码”和体验版读写同一批测试数据，本机 `.env` 必须连接 `efm-dev` 使用的测试数据库，而不是本地 Docker MySQL：

```dotenv
DATABASE_URL=mysql://<test-user>:<test-password>@<test-external-host>:<port>/<test-database>
WECHAT_GATEWAY_MODE=http
WECHAT_APP_ID=<小程序 AppID>
WECHAT_APP_SECRET=<小程序 AppSecret>
WECHAT_MINIPROGRAM_ENV_VERSION=develop
STORAGE_PROVIDER=cloudbase
CLOUDBASE_ENV_ID=cloud1-d0g1gwk2aefd9f1e8
CLOUDBASE_SECRET_ID=<仅保存在本机的 SecretId>
CLOUDBASE_SECRET_KEY=<仅保存在本机的 SecretKey>
PUBLIC_API_BASE_URL=http://127.0.0.1:3000
```

测试数据库的外网连接串从 CloudBase 控制台的 MySQL 直连服务获取，只能写入本机 `.env`，不得提交到仓库。本地 API 与 `efm-dev` 必须使用相同的小程序 AppID，开发者工具登录后才能映射到与体验版相同的微信用户。共享数据中包含 CloudBase 文件 ID，因此本地 API 也应使用同一 CloudBase 存储环境，避免把只有本机能访问的文件地址写入共享数据库。启动前先确认本地代码所需迁移已经部署到该测试库；不要对共享测试库运行演示 seed、清理脚本或开发态迁移命令。

首次从体验版切到开发者工具时，建议在开发者工具中清除缓存并重新登录，避免继续携带由 `efm-dev` 签发、但本地 API 无法验证的旧 token。

真机无法把 `127.0.0.1` 解释为 Mac，因此真机开发版会自动继续走 `efm-dev`，不会访问本机 API。

## 7. 手工验收路径

按顺序验证：

1. 微信登录后进入“我的”，确认能看到并复制 6 位用户编号。
2. 在后台用该编号绑定当前联赛球队；小程序“联赛 → 我的联赛”和“我的”下拉刷新后都应出现该球队。
3. 打开一支联赛球队，核对只读阵容、工资帽、财务流水和当前转会窗口，不应出现购买、转会或升级按钮。
4. 小程序不应出现个人资料保存、游戏账号维护、自助创建联赛或自助编辑球队入口。
5. 关闭 API 后刷新资料页，应显示错误态和“重新加载”；恢复 API 后可重试成功。
6. 分级演示联赛首赛季不得出现超级组；19 队应形成冠军 A/B 两组，发布赛程后两组边界清晰且积分独立更新。

自动验证分级联赛完整闭环：

```bash
pnpm --filter @efm/api test:e2e -- tiered-league.e2e-spec.ts --runInBand
```

旧 `/me/game-accounts` 与 `/me/team-profile` 的读取能力仅用于历史数据兼容；写接口会返回 `Deprecation: true` 响应头。新小程序流程不再调用这些写接口。

## 8. 常见问题

### 手动隐藏或恢复垃圾测试联赛

`leagues.is_deleted` 是联赛的逻辑删除标记。设为 `TRUE` 后，联赛本身以及其赛季、球队、赛事、赛程、阵容、财务和身价等下属数据都会从后台与小程序隐藏，但数据库记录不会被物理删除；改回 `FALSE` 后，原数据会直接恢复可见。

隐藏联赛：

```sql
UPDATE leagues
SET is_deleted = TRUE, updated_at = NOW()
WHERE id = '<league-id>';
```

恢复联赛：

```sql
UPDATE leagues
SET is_deleted = FALSE, updated_at = NOW()
WHERE id = '<league-id>';
```

请先用只读查询核对准确的联赛 ID，再执行更新。每次切换都会同步更新 `updated_at`。手动修改 `is_deleted` 后不需要重启 API、管理后台或小程序，下一次请求立即生效；只有首次部署包含数据库字段、迁移或 Prisma Client 变更的新代码时，才需要执行迁移并重启 API。

### 球队退出联赛与恢复

球队永久退赛使用 `league_teams.status = ARCHIVED`，恢复后为 `ACTIVE`。请在管理后台进入“联赛球队 → 球队详情”，填写原因并执行“退出联赛”或“恢复球队”。系统会记录操作者、原因和审计日志，并使用版本号与幂等键防止并发覆盖或重复操作。

退赛不会删除或解绑球队，也不会释放编号和队壳；阵容、财务、赛季报名、比赛、赛果和积分榜历史均保留。退赛球队会从现役列表、工作区、续赛季邀请和个人赛事待办中消失，且不能再执行球队壳、阵容、财务、身价、报名和赛果写操作。历史赛程和积分榜仍显示原快照名称，并标记“已退赛”。恢复后沿用同一球队 ID、编号、队壳及全部历史数据，重新进入现役流程。

不建议直接执行 SQL 修改球队状态：直接修改会绕过操作原因、权限校验、审计、幂等和并发控制。如果仅需清理整个垃圾测试联赛，请继续使用上方联赛级 `is_deleted` 逻辑删除。

- `ECONNREFUSED 127.0.0.1:3307`：MySQL 未启动或端口与 `.env` 不一致。
- `Environment validation failed`：`.env` 缺少必填项，或密钥长度不足 32 个字符。
- 微信开发者工具 CLI 提示服务端口关闭：打开“设置 → 安全设置 → 服务端口”，只在需要 CLI 自动化时开启。
- 修改了契约但运行时报 `ERR_MODULE_NOT_FOUND`：先执行 `pnpm --filter @efm/contracts build`，常规的 `pnpm verify` 和 API 启动脚本会自动处理。

停止 Docker MySQL：

```bash
pnpm dev:db:stop
```
