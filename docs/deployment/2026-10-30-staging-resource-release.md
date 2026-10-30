# 2026-10-30 体验环境资源优化发布记录

## 范围与授权

- 分支 `dev`，仅发布拍卖空闲调度、估值调度和连续暂停一小时取消相关 API 改动。
- 目标 `cloud1-d0g1gwk2aefd9f1e8` / `efm-dev`，正式环境不变。
- 用户同意短暂维护，以及最小实例从 0 改为 1；保持 0.5 核、1GB、最大 2。
- 用户指定验收联赛为 CELL；只读查询对应 `Cell国服联赛`，ID `0ede3dbe-a622-42f1-a660-c6d08a4fbc4d`。
- 源码包由 HEAD `97af7a4` 加本次优化文件组成，排除其他未提交的后台及合同改动。SHA256：`a9e67f7c2fcbfb8f8170ef76a6e8724f235641cfcb979df8971f5e4138b28ae9`。

## 发布前核对

- 运行配置和本地迁移连接的主机、端口、数据库一致：`sh-cynosdbmysql-grp-rishaugq.sql.tencentcdb.com:22460` / `cloud1-d0g1gwk2aefd9f1e8`。
- 70 个迁移中，仅 `20261030120000_auction_pause_timeout` 待应用；目标表尚无 `paused_at`。
- 发布前批次：7 个 COMPLETED、4 个 CANCELLED，无进行中或暂停批次。
- 专用受限文件 `/tmp/efm-release-verify/staging-before-pause-timeout.sql`：完整单事务备份，退出码 0，20,288,297 字节，有完成标记。不要上传或提交该备份。
- Pod API 发现 019 和 020 实例仍在 Running，即使 019 流量为零。迁移前必须确认旧实例全部停止。

## 验证

- 优化源码独立构建通过。
- 5 个单测套件，39 项通过。
- 拍卖和球队端到端：2 套件，6 项通过。
- 所有测试显式连接本机 `127.0.0.1:33316`、库名含 `verify`，未在共享库运行测试或 seed。
- 初次测试因模拟微信网关未显式设置失败；第二次因本机/测试进程时区不一致和失败测试残留失败。新建独立 e2e 库、统一 UTC、显式 fake 网关后通过。线上微信网关和时区未修改。

## 发布结果

- 021（构建 ID `2609974803`，任务 `2500630`）作为临时维护版本，仅启动 HTTP 维护响应，不启动业务任务。
- 确认 019、020 旧实例停止后应用 `20261030120000_auction_pause_timeout`，目标 `pnpm db:status` 确认全部迁移已应用；旧版本镜像和配置备份保留。
- 022 使用同一优化镜像恢复应用，CMD / ENTRYPOINT 恢复空数组，健康检查返回 HTTP 200 / `status: ok`，流量 100%。
- 021 临时维护版本已撤下且保留镜像；Pod API 最终仅返回一个 022 Running 实例。
- 配置核对：0.5 核、1GB、最小 1、最大 2。与发布前相比，唯一实质配置变化为授权的 MinNum 0→1；OpenAccessTypes 仅数组顺序不同，环境变量及其他配置相同。
- 实际体验后台为 `https://efm-admin-dev-cloud1-d0g1gwk2aefd9f1e8.webapps.tcloudbase.com`。文档旧静态域名不应继续作为体验后台入口。
- 用户在维护期间报告登录失败；恢复后通过实际页面登录成功，联赛目录正常。截图 `/tmp/efm-staging-login-verified.jpg`。
- CELL 现役球队（6 支）、已退出列表（空）、球队详情和拍卖列表均已在目标后台实际加载验证。
- 另有联赛/估值 e2e 2 套件 3 项、小程序 100 文件 468 项本机测试通过；这些不是体验小程序实机验收。

## 云端操作验收

- 用户再次报告同一正确域名登录失败；直接在用户的 980898529 标签页使用原有已填凭据点击登录，成功进入 `/platform/leagues`。未更改地址、密码或刷新页面；未复现失败，也未获取到上一次失败请求证据，因此不能将该次失败确定归因于维护。截图 `/tmp/efm-user-tab-login-verified.jpg`。
- 用户明确授权仅调整新建验收拍卖的暂停时间并清理。通过后台创建 CELL 小程序渠道验收批次 `d4655afa-d513-424b-a435-ee7de7efba5f`，拍品 `9676a3a3-f094-4f6d-899f-d2b82b290ee8`，名称 `资源优化验收-20261030-临时`。
- 实际开始、暂停、继续、再次暂停均成功。首次暂停保存 21077ms，恢复后数据库 `deadline_at - started_at` 恰为 21077ms，`paused_at` 清空。
- 备份精确记录后，仅将该批次 `paused_at` 调整为数据库 UTC 当前时间前 61 分钟；云端任务于 `2026-10-30 09:37:13.473 UTC` 自动取消批次，拍品 VOID，审计 action 为 `player-auction.pause-timeout`。后台实际显示“已取消”，截图 `/tmp/efm-staging-timeout-verified.jpg`。
- 此项为加速时间条件的云端验收，并非真实等待一小时。未模拟机器人离线，异常暂停分支仍仅有本机自动化验证。
- 验收无出价、无审核、无成交；只读核对关联并备份 `/tmp/efm-release-verify/acceptance-before-cleanup.json` 后，事务定点删除本次 1 批次、1 拍品和 7 条关联验收审计。复查全部为 0；未更改既有拍卖、球队或资金。
- 本机两个专用 verify 测试库也已备份、事务清空并复查 0 行，本机专用 MySQL 已停止。

## 追加体验版与机器人验收

- 用户确认手机体验版的“我的 → 我的联赛 → CELL → 球队详情”、球员搜索、赛程和拍卖大厅均正常加载。这些是用户实机反馈，不是代理直接操作手机的结果。
- 公开 health、leagues、platform-presentation 接口分别返回 HTTP 200；单次请求约 119–151ms，不作为并发压测或 SLA 结论。022 单 Pod Running。
- 用户明确允许仅在 CELL 的“测试任务”群和“微信机器人测试机”验收通知及短暂中断。创建群渠道批次 `8d8bfe44-5aa9-40cc-b2bd-f9aed4db9ed0`、拍品 `f896671f-1c49-46bb-aacb-d61e038cb5a1`。
- 后台启动批次后短暂停用已有测试机，云端自动进入 RECOVERY_REQUIRED，原因 DEVICE_DISABLED，拍品 PAUSED，剩余 29397ms；恢复设备 ACTIVE 后拍卖仍保持待人工恢复。
- 备份后仅调整该验收批次 paused_at 至 UTC 当前时间前 61 分钟，云端自动进入 CANCELLED 并产生 pause-timeout 审计。截图 `/tmp/efm-robot-timeout-verified.jpg`。
- 测试机最终 ACTIVE / LOGGED_IN / CLOSED / screen_locked=0，心跳继续更新。截图 `/tmp/efm-robot-restored.jpg`。保留设备停用与恢复的运维审计。
- 无出价、无成交、无此批次的出站任务；精确备份 `/tmp/efm-release-verify/robot-before-cleanup.json` 后事务清理 1 批次、1 拍品、4 审计和 4 幂等回执，复查全部为 0。
- 上次手动暂停验收另有 7 条幂等回执，已按 result_json.id 精确识别、备份到 `acceptance-receipts-before-cleanup.json` 后事务清理并复查为 0。

## 验证边界

- 未模拟 Windows 实际断网、锁屏、微信退出，也未执行管理员私聊恢复命令；设备停用场景不能替代所有异常触发方式。
- 机器人页面“发送队列 5 条”来自 Bridge 心跳报告的本地 pending_outbox + ambiguous_outbox。服务端没有 PENDING/LEASED 消息，本次无新出站任务，故尚不能确认 Windows 本地这 5 条任务状态或群消息发送链路全部正常。
- 未做高并发压测；当前功能验收不能保证峰值负载下 0.5 核 / 1GB 的容量。
