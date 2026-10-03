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

完整发布门禁：

```bash
pnpm verify
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

## 6. 导入微信小程序

1. 在微信开发者工具选择“导入项目”。
2. 目录选择仓库中的 `apps/miniprogram`，AppID 选择已注册的小程序。
3. 确认 `miniprogramRoot` 为 `miniprogram/`。
4. 模拟器调试时，`miniprogram/config/api.ts` 的 `apiBaseUrl` 保持 `http://127.0.0.1:3000/v1`。
5. 本地 HTTP 调试可在开发者工具的“详情 → 本地设置”中临时关闭合法域名校验；该选项仅用于开发。

真机无法把 `127.0.0.1` 解释为 Mac。真机联调应改成同一局域网可访问的 Mac 地址，或直接填写已部署的 HTTPS API 域名，然后重新编译。正式发布前还需要在微信公众平台把该 HTTPS 域名加入 `request` 合法域名。

## 7. 手工验收路径

按顺序验证：

1. 微信登录后进入“我的”，确认能看到并复制 6 位用户编号。
2. 在后台用该编号绑定当前联赛球队；小程序“联赛 → 我的联赛”和“我的”下拉刷新后都应出现该球队。
3. 打开一支联赛球队，核对只读阵容、工资帽、财务流水和当前转会窗口，不应出现购买、转会或升级按钮。
4. 小程序不应出现个人资料保存、游戏账号维护、自助创建联赛或自助编辑球队入口。
5. 关闭 API 后刷新资料页，应显示错误态和“重新加载”；恢复 API 后可重试成功。

旧 `/me/game-accounts` 与 `/me/team-profile` 的读取能力仅用于历史数据兼容；写接口会返回 `Deprecation: true` 响应头。新小程序流程不再调用这些写接口。

## 8. 常见问题

- `ECONNREFUSED 127.0.0.1:3307`：MySQL 未启动或端口与 `.env` 不一致。
- `Environment validation failed`：`.env` 缺少必填项，或密钥长度不足 32 个字符。
- 微信开发者工具 CLI 提示服务端口关闭：打开“设置 → 安全设置 → 服务端口”，只在需要 CLI 自动化时开启。
- 修改了契约但运行时报 `ERR_MODULE_NOT_FOUND`：先执行 `pnpm --filter @efm/contracts build`，常规的 `pnpm verify` 和 API 启动脚本会自动处理。

停止 Docker MySQL：

```bash
pnpm dev:db:stop
```
