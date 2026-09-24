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
- 最小实例数、CPU、内存和并发数：先采用最低可用规格，压测后调整。

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
| `WECHAT_GATEWAY_MODE` | `http` |

CloudBase 控制台配置优先于 Dockerfile 默认值，且环境变量属于具体服务版本。任何密钥调整都应创建新版本，不能写入 Dockerfile。

## 5. 发布前验证与切流

先让新版本不承接或只承接少量流量，验证：

```bash
curl -i https://<api-domain>/v1/health
```

预期 HTTP 200，响应包含 `{"status":"ok"}`。随后用微信开发者工具在真实微信登录模式下验证登录、资料保存和账号管理；检查云托管日志中没有连接串、AppSecret、access token 或 refresh token。

确认后再全量切流。将 `apps/miniprogram/miniprogram/config/api.ts` 的 `apiBaseUrl` 改为 `https://<api-domain>/v1`，在微信公众平台加入 `request` 合法域名，重新编译、预览并上传小程序。

## 6. 回滚

CloudBase 的服务版本不可变。出现故障时：

1. 进入“服务详情 → 部署记录”。
2. 选择最近一个健康版本并执行“回退”。
3. 用 `/v1/health`、微信登录和 `GET /v1/me` 再次验证。
4. 若本次发布包含数据库迁移，优先采用向前兼容修复；不要直接手工回滚数据。确需数据库回档时，按 CloudBase 备份策略单独执行并评估数据丢失窗口。

官方版本回退入口说明见[查看或删除版本](https://docs.cloudbase.net/run/deploy/managing/revisions)。
