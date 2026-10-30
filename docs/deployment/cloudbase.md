# CloudBase 云托管部署指南

目标架构：微信小程序调用 CloudBase 云托管中的 API；API 通过私有网络连接 CloudBase MySQL。生产环境不得使用 fake 微信网关，也不得把数据库、JWT 或微信密钥编译进小程序或镜像。

CloudBase 官方要求服务监听平台注入的 `PORT`，本项目已遵守；环境变量与云托管版本绑定，修改后需要发布新版本。参考：[服务开发说明](https://docs.cloudbase.net/run/develop/developing-guide)、[环境变量](https://docs.cloudbase.net/run/deploy/configuring/environment/envs)。

## 1. 准备生产 MySQL

1. 在 CloudBase 控制台初始化 MySQL 数据库，并创建权限最小化的应用账号。
2. 在“数据库设置 → 直连服务”获取连接地址。
3. 生产 API 使用内网地址；外网地址只用于迁移和临时调试，用完应关闭。
4. 若使用小租户 MySQL，在云托管服务“网络配置”中开启私有网络，并选择数据库所在 VPC。

连接串格式：

```text
mysql://<username>:<password>@<internal-host>:3306/<database>
```

相关官方说明：[MySQL 直连服务](https://docs.cloudbase.net/database/configuration/db/tdsql/direct-connection)、[云托管 MySQL 集成](https://docs.cloudbase.net/run/develop/resource-integration/mysql)。

## 2. 执行数据库迁移

先在本地或受控 CI 中临时使用数据库外网连接串，不要把它写进仓库：

```bash
export DATABASE_URL='mysql://<user>:<password>@<external-host>:<port>/<database>'
pnpm install --frozen-lockfile
pnpm db:migrate
pnpm db:status
```

迁移完成后清除当前终端变量，并按需关闭数据库外网直连。生产容器启动时不会自动修改表结构，从而避免多个实例并发迁移。
如果 `pnpm db:status` 仍列出待应用迁移，不要发布依赖这些字段的新 API 或后台页面；本地测试库已迁移不代表 CloudBase 目标库已迁移。

## 3. 构建并推送镜像

CloudBase 云托管当前运行 x86 架构；Apple Silicon Mac 必须显式构建 `linux/amd64` 镜像。镜像地址和登录命令以腾讯云容器镜像服务（TCR）控制台提供的“快捷指令”为准。

```bash
git rev-parse --short HEAD
docker buildx build \
  --platform linux/amd64 \
  -f apps/api/Dockerfile \
  -t <registry>/<namespace>/efm-api:<git-sha> \
  --push .
```

不要使用可变的 `latest` 作为唯一发布标识。CloudBase 支持从 TCR、Docker Hub 等仓库部署容器，详见[部署容器镜像](https://docs.cloudbase.net/run/deploy/deploy/deploying-image)。

## 4. 创建云托管服务版本

在 CloudBase 控制台进入“云托管 → 从容器部署”：

- 镜像：填写上一步带 Git SHA 的完整镜像地址。
- 服务端口：`3000`。
- 公网访问：开启；若控制台提供小程序访问类型，同时启用 `MINIAPP`。
- 私有网络：选择生产 MySQL 所在 VPC。
- 球员拍卖等容器内定时任务需要常驻实例：承接拍卖的 API 服务将最小实例数设为 1；若依赖单实例定时调度，将最大实例数也设为 1。不能以最小实例数 0 运行并期待 30 秒倒计时自动结算。拍卖大厅和后台详情查询会对已到期的小程序拍卖执行幂等补偿结算，但无人访问时仍需常驻实例推进。

为该版本配置以下环境变量：

| 变量 | 生产值要求 |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | 由平台注入；不要硬编码覆盖 |
| `DATABASE_URL` | CloudBase MySQL 内网连接串 |
| `JWT_ACCESS_SECRET` | 独立随机值，至少 32 字符 |
| `REFRESH_TOKEN_PEPPER` | 另一个独立随机值，至少 32 字符 |
| `WECHAT_APP_ID` | 生产小程序 AppID |
| `WECHAT_APP_SECRET` | 生产小程序 AppSecret |
| `WECHAT_MINIPROGRAM_ENV_VERSION` | `release`；测试服务应配置为 `trial` |
| `WECHAT_GATEWAY_MODE` | `http` |

CloudBase 控制台配置优先于 Dockerfile 默认值，且环境变量属于具体服务版本。任何密钥调整都应创建新版本，不能写入 Dockerfile。

## 5. 发布前验证与切流

先让新版本不承接或只承接少量流量，验证：

```bash
curl -i https://<api-domain>/v1/health
```

预期 HTTP 200，响应包含 `{"status":"ok"}`。随后用微信开发者工具在真实微信登录模式下验证登录、资料保存和账号管理；检查云托管日志中没有连接串、AppSecret、access token 或 refresh token。

确认后再全量切流。小程序会根据版本自动选择 CloudBase 服务：体验版使用 `efm-dev`，正式版使用 `efm-api-production`；发布前核对 `apps/miniprogram/miniprogram/config/api.ts` 中的环境 ID 与服务名，然后重新编译、预览并上传小程序。

切流前后都要用目标环境的管理员账号复测既有路径：联赛球队“现役球队 / 已退出”列表、球队详情，以及小程序“我的联赛”；若任一路径加载失败，暂停切流并检查接口错误与目标库迁移状态。

## 6. 回滚

CloudBase 的服务版本不可变。出现故障时：

1. 进入“服务详情 → 部署记录”。
2. 选择最近一个健康版本并执行“回退”。
3. 用 `/v1/health`、微信登录和 `GET /v1/me` 再次验证。
4. 若本次发布包含数据库迁移，优先采用向前兼容修复；不要直接手工回滚数据。确需数据库回档时，按 CloudBase 备份策略单独执行并评估数据丢失窗口。

官方版本回退入口说明见[查看或删除版本](https://docs.cloudbase.net/run/deploy/managing/revisions)。

## 7. 部署测试后台

后台是 Vite 单页应用，使用 CloudBase 静态网站托管，不需要额外创建容器服务。

1. 在 API 服务的新版本中设置后台允许来源：

   ```dotenv
   ADMIN_WEB_ORIGINS=https://cloud1-d0g1gwk2aefd9f1e8-1495246258.tcloudbaseapp.com
   ```

   环境变量属于具体服务版本，修改后必须部署新版本并把流量切换到该版本。

2. 使用测试模式构建后台。`apps/admin-web/.env.staging` 只保存公开的 API 地址，不包含密钥：

   ```bash
   pnpm --filter @efm/admin-web build:staging
   ```

3. 上传构建产物：

   ```bash
   pnpm --package=@cloudbase/cli dlx tcb hosting deploy \
     apps/admin-web/dist \
     -e cloud1-d0g1gwk2aefd9f1e8 \
     --verify --safe
   ```

4. 在静态网站托管设置中将错误页面配置为 `index.html`，保证直接刷新
   `/platform/data-sync` 等 React Router 路由时仍返回应用入口。

5. 打开测试后台并验证登录、令牌刷新、数据同步和批次发布：

   ```text
   https://cloud1-d0g1gwk2aefd9f1e8-1495246258.tcloudbaseapp.com
   ```

测试后台与微信小程序必须访问同一个 `efm-api-staging`，禁止使用本地后台发布云端数据。

## 7. 资源消耗优化与验收

后台空闲检查已做降频，业务时间和接口契约保持不变：

- 拍卖：活跃批次仍每 500 ms 检查；空闲时每 5 秒兜底扫描。启动、恢复操作在修改状态后为本进程保留 120 秒高频检查，覆盖最长 60 秒的事务提交及空读竞态。必须保留常驻实例；不要直接缩容至 0。
- 估值快照：空闲时每 30 秒检查并查询下一开窗时间，到开窗边界恢复检查。创建/修改窗口后短期恢复每秒检查，保留请求时补偿和阵容变更前的事务保护。后台检查串行执行，退出时等待在途任务。
- 以上只减少数据库工作，不能等比例减少按实例规格和运行时长计费的云托管 CPU/内存费用。

上线前确认镜像版本、正常运行的服务/旧版本数量、实例规格及扩缩容范围；不根据总账单直接降配。对比上线前后相同时段的 CCU、查询量、P95 响应时间、CPU/内存峰值、错误率；至少观察一次无人访问时段与一次实际拍卖。

线上验收包含：小程序拍卖启动/短时暂停恢复/无人访问自动结算/下一名球员推进、估值窗口开窗和改期、后台球队“现役球队 / 已退出”及详情、小程序“我的联赛”。本地测试通过不代表这些线上入口已验收。

流量优化应先按请求路径统计请求次数及响应字节总量，确认图片是否走 API、响应是否已被网关压缩，再决定 CDN、缩略图、缓存或压缩配置。涉及鉴权的比赛凭证不能直接改为公开缓存。

### 连续暂停 1 小时自动取消：受控发布

`20261030120000_auction_pause_timeout` 新增 `player_auction_batches.paused_at` 和 `(status, paused_at)` 索引。手动暂停、机器人异常暂停共用连续暂停起点；手动暂停转异常暂停不重置。达到 1 小时后拒绝恢复，后台每 5 秒扫描并在数据库锁内复核后取消批次，作废当前和排队拍品；保留已结束、待审核和已审核记录，不改动资金或阵容。服务重启后也会扫描补偿。

此次发布不能让新旧版本同时写拍卖状态：

1. 核对目标主机、数据库和 `pnpm db:status`，备份目标数据库。
2. 在迁移前暂停拍卖控制入口的写入，并停止旧版本的拍卖后台任务，等待在途事务结束。旧版本在迁移后继续暂停/恢复会漏写或沿用旧 `paused_at`，可能导致漏取消或提前取消。
3. 执行迁移；确认状态无待应用迁移后，切换到全部使用新代码的服务实例，再恢复控制入口。不能只迁移后长期混跑旧镜像。
4. 验收手动/异常暂停、1 小时内恢复、超时拒绝恢复、自动取消、已结束拍品仍可审核，以及既有小程序入口。

迁移对历史手动暂停使用 `updated_at` 作为保守起点（历史编辑可能使取消延后），异常暂停优先使用 `recovery_detected_at`。已超过 1 小时的历史暂停批次会在新服务启动后被取消，因此发布前应列出这些批次供核对。回滚也不能直接让旧版本继续写新增暂停状态，应先阻断拍卖控制写入并采用受控前向修复。
