# Windows Bridge 稳定性与状态验收

## 本次变更

- 接收数据库、会话或消息读取失败不再视为“无新消息”。日志记录错误码和异常类型，不写消息正文、令牌或异常原文。
- 数据库读取失败自动重新创建读取器，重试间隔为 5、10、20、40、60 秒，之后保持 60 秒；真实接收检查成功后恢复正常间隔。
- 保留 SQLite 收件箱、扫描游标、待确认发送记录。网络恢复后继续提交未确认收件，沿用服务端去重机制；不自动重发发送结果不确定的消息。
- 同一 Windows 用户只允许一个标准 CLI Bridge 进程运行。重复启动或运行 doctor 返回 `BRIDGE_ALREADY_RUNNING`，应先停止旧进程。独立诊断脚本不受此锁保护，运行前同样应停止 Bridge。
- 自动记录日志到配置 `state_dir` 下的 `logs/bridge.jsonl`，单文件约 5 MB，保留 5 个历史文件。默认配置对应 `apps/wechat-bridge/state/logs/`。
- 心跳上报接收状态、错误码和最近成功检查时间；后台每 10 秒刷新。超过 60 秒未收到心跳或成功接收检查，不显示为正常。没有新消息不等于异常：空轮询成功也更新检查时间。
- 后台“未熔断”仅表示发送保护开关状态；本地待发送/待确认数量不是服务端实时队列数量。

## 发布顺序

1. 核对目标主机、库名以及 `pnpm db:status`，按受控发布流程执行 `pnpm db:migrate`，应用 `20261030170000_wechat_receiver_health`。
2. 发布 API 和后台前端，再更新 Windows Bridge。API 向后兼容旧 Bridge，旧客户端会显示“接收状态未上报”。新 Bridge 可连接旧 API，但旧后台不会显示新增诊断字段。
3. 不要复制本地数据库或覆盖 Windows 的 `bridge.toml`、令牌、`state` 目录。

本次代码提交不代表 CloudBase 已部署；目标接口和 Windows 实机需按下方步骤验收。

## Windows 更新

关闭原 Bridge 窗口，确认旧进程已结束。PowerShell 执行：

```powershell
cd D:\workspace\efootball_management
git -c http.version=HTTP/1.1 pull --ff-only origin dev
```

仅在拉取成功后继续：

```powershell
cd D:\workspace\efootball_management\apps\wechat-bridge
uv run --extra windows --frozen efm-wechat-bridge --config .\bridge.toml doctor
```

仅在 `passed: true` 后启动，保留窗口：

```powershell
uv run --extra windows --frozen efm-wechat-bridge --config .\bridge.toml run --enable-send
```

日志已自动保存，无需 PowerShell 管道或修改执行策略。启动失败时不要反复启动多个进程。

## 验收

1. 私聊发送一条“当前设置”，确认仅回复一次。后台应显示新心跳和“接收正常”。
2. 群里发送一条“帮助”，确认目标群回复一次，其他群没有回复。
3. 短暂断开 Windows 网络，再恢复；确认心跳恢复、待接收消息不重复回复。检查 `heartbeat_failed` / `heartbeat_ok` 日志。
4. 停止 Bridge 超过 60 秒，后台应显示“心跳超时”，不能继续显示正常。重新启动后应恢复。
5. 保持运行一晚，次日重复步骤 1、2，留存日志。不得仅凭 doctor 通过或一条回复宣布长期稳定。

数据库暂时不可读时应出现 `receiver_unhealthy`、`receiver_recovery_started`，重新创建后出现 `receiver_reopened`；仅真实接收检查成功后记录 `receiver_recovered`。

自动恢复不绕过微信账号变更、锁屏、发送熔断或发送结果不确定的保护。Windows 原生调用永久阻塞、微信退出或系统休眠仍可能需要人工处理；后台超时用于暴露这些情况，不承诺所有故障都能无人值守恢复。
