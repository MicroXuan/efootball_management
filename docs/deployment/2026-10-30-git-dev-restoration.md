# 2026-10-30 体验环境恢复 Git dev 部署

用户要求 API 和后台恢复关联 Git 的 `dev` 分支，并沿用之前成功的配置。后续不得使用本地文件夹、ZIP 或本地构建产物上传替代 Git 发布。

## 目标与来源

- 环境：`cloud1-d0g1gwk2aefd9f1e8`（微信体验版）。正式环境未操作。
- 仓库：`https://github.com/MicroXuan/efootball_management`，分支 `dev`。
- 本次应用代码：`e8a1840f33c78150dd8212b1e3a745ea469e7fcc`，包含手机工作台及退群显示修复。
- 后台失败版本 `efm-admin-dev-015` 的日志显示本地 ZIP 上传、Node.js 20、安装命令 `true`，被构建平台拒绝。恢复配置依据是此前成功的 Git 版本 `efm-admin-dev-012`。

## 保留的配置

| 项目 | API `efm-dev` | 后台 `efm-admin-dev` |
| --- | --- | --- |
| 来源 | Git / dev | Git / dev |
| 构建目录 | `.` | `./`（仓库根目录） |
| 运行环境 | `Dockerfile.api` 内 Node.js 24 | Node.js 24 |
| 安装 | Dockerfile 内原配置 | `npx --yes pnpm@11.23.0 install --frozen-lockfile` |
| 构建 | Dockerfile 内原配置 | `npx --yes pnpm@11.23.0 --filter @efm/admin-web... build` |
| 构建产物 | Docker 镜像 | `./apps/admin-web/dist` |
| 端口／部署路径 | 服务端口 3000，访问端口 80 | `/` |
| 资源 | 0.5 核 / 1 GB | 原配置 |

API 原环境变量、网络和运行设置保持不变。后台环境变量 `VITE_API_BASE_URL` 保持为 `https://efm-dev-330149-5-1495246258.sh.run.tcloudbase.com`。

后台云端 Git 流水线内部执行 `tcb hosting deploy ./apps/admin-web/dist /` 是原有云端构建发布步骤；不允许在本机运行上传命令来代替这条 Git 流水线。历史文档中的本地上传指令、`staging-release.mjs` 不能用于后续发布。

## 数据库

发布前核对目标主机 `sh-cynosdbmysql-grp-rishaugq.sql.tencentcdb.com:22460`、库名 `cloud1-d0g1gwk2aefd9f1e8`。

`pnpm db:status` 确认仅缺 `20261030160000_wechat_group_availability`；执行受控 `pnpm db:migrate` 后再次检查，72 个迁移全部已应用。未运行测试 seed、清理业务数据或开发态迁移。

## 发布与验收

- 后台 `efm-admin-dev-016`，构建 ID `2610034792`：成功。日志确认 `BUILD_TYPE=GIT`，依赖安装、构建和发布退出码均为 0。
- 回读后台“更新服务”：Git 个人仓库部署、GitHub 已授权、`MicroXuan/efootball_management`、`dev`，以及上表构建配置均已保存。
- API `efm-dev-027`：正常，100% 流量、1 个实例；镜像构建和容器就绪检查均成功。回读“更新服务”确认公开 Git 仓库地址和 `dev` 分支持久化，3000 端口未变。
- API `/v1/health` 发布后返回 `status: ok`，时间 `2026-10-30T15:10:52.717Z`。
- 后台首页、`/platform/wechat-bot`、手机工作台深层链接 HTTP 200，均使用 `/assets/index-CcQGtQ_w.js`。
- 线上登录会话加载新版手机工作台，显示“办理转会”，CELL S1 的 10 场已发布赛程正常读取。
- 后台 CELL 联赛“现役球队”显示 6 支球队，“已退出”正常空态，阿哈尔球队详情正常读取阵容、工资帽、现役状态。
- 新 API 上线后刷新微信群配置页面，页面读取正常，但“静安青年体育公园散客群（2）”仍显示。退群修复还依赖 Windows Bridge 新版的成员过滤及完整群快照上报；本次仅恢复发布 API 和后台，未更新 Windows Bridge，不能宣布退群问题已端到端解决。
- 小程序“我的联赛”及 Windows Bridge 实机链路未在本次部署中验收；未执行真实转会、晋级或其他业务写入。
