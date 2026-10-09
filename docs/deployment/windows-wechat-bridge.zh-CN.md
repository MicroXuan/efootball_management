# Windows 微信 Bridge 部署与验收

本文用于专用 Windows 10/11 电脑上的首次安装、测试群验收、停用和回滚。普通个人微信自动化不存在零风控保证；只应在成员知情的白名单群使用专用机器人小号。

## 固定环境

- 64 位 Python 3.12、`uv`、微信 Windows 版 `4.1.15.13`；升级微信前必须重新验收。
- 电脑需长期在线并关闭睡眠。接收可在后台继续，但 GUI 发送要求用户已登录、桌面未锁定、微信主窗口可见。
- 计划任务必须选择“仅当用户登录时运行”。不得配置 Windows 服务、Session 0 或“无论用户是否登录都运行”。
- 使用专用 Windows 用户和专用机器人微信号，不在该账号处理私人聊天。

## 1. 服务端准备

1. 在管理后台“微信群机器人”中创建设备，只展示一次的设备令牌立即保存到密码管理器。
2. 在 Windows 用户环境中设置令牌，令牌不得写入仓库、`bridge.toml`、计划任务参数或日志：

   ```powershell
   [Environment]::SetEnvironmentVariable("EFM_WECHAT_BRIDGE_TOKEN", "后台签发的令牌", "User")
   ```

3. 复制 `apps/wechat-bridge/config.example.toml` 为 `bridge.toml`，填写 HTTPS API 地址、设备 UUID 和仓库外或已忽略的本地状态目录。保持 `send_enabled = false`。

## 2. 安装和只读检查

在普通 PowerShell（无需管理员权限）执行：

```powershell
cd apps\wechat-bridge
.\scripts\install.ps1 -Config .\bridge.toml
uv run efm-wechat-bridge --config .\bridge.toml doctor
```

`doctor` 必须确认 Python、微信进程和版本、登录状态、本地数据库、交互桌面、API 设备鉴权、状态目录和群列表。输出不得包含令牌、数据库密钥、完整聊天正文或账号数据路径。

先用 `run.ps1` 默认 dry-send 运行：

```powershell
.\scripts\run.ps1 -Config .\bridge.toml
```

机器人观察到测试群后，在管理后台将该群绑定到一个联赛并选择赛程来源。下一次心跳会把唯一稳定群 ID 和当前群名下发给 Bridge；未下发的群消息不会上传，未授权目标不会发送。

## 3. 测试群验收记录

每项记录时间、Bridge Git 提交、微信版本、设备 ID、结果代码和操作人；不要记录令牌、数据库密钥或无关聊天正文。

- [ ] `doctor` 全部通过，微信版本为 `4.1.15.13`。
- [ ] 后台只出现预期测试群，群绑定和赛程来源正确。
- [ ] 用户私聊 `绑定 123456` 能完成一次性绑定，其他私聊不上传。
- [ ] 群内发送 `查询赛程`、`我的赛程` 后，在管理后台的微信发件箱中确认生成正确任务；dry-send 模式不会领取或操作这些任务。
- [ ] 将 `send_enabled = true` 后运行 `run.ps1 -EnableSend`，目标稳定 ID 和群标题均精确匹配。
- [ ] 发送后从本地数据库读回相同正文及消息 ID，服务端状态为 `SENT`。
- [ ] 重启 Bridge，不重复发送已读回确认的任务。
- [ ] 断开 API，入站事件保留在本地 SQLite；恢复网络后只上传一次。
- [ ] 锁屏或断开 RDP 后不领取新出站任务；恢复桌面后重新执行 `doctor`。
- [ ] 临时改群名时发送安全失败，不对模糊搜索结果发送。
- [ ] 制造一次回车后读回超时，任务进入 `AMBIGUOUS`、设备熔断且不自动重发。
- [ ] 拍卖模块完成后，用三名不同起拍价/加价的球员完成一次测试拍卖。

验收未全部完成前，把 `send_enabled` 保持为 `false`。

## 4. 启动项

先以 dry-send 注册：

```powershell
.\scripts\register-task.ps1 -Config .\bridge.toml
```

全部验收后才可重新注册发送模式：

```powershell
.\scripts\register-task.ps1 -Config .\bridge.toml -EnableSend
```

任务采用 `Interactive` 登录类型，只在当前用户登录后启动。关闭或锁定桌面会使发送门禁失败。

## 5. 故障、轮换和紧急停止

- 紧急停止：结束 `EFM WeChat Bridge` 计划任务，并在后台禁用设备或打开全局发送开关；随后把 `send_enabled` 改回 `false`。
- 熔断：先人工核对微信群中是否已经出现不确定消息，再处理后台失败任务；禁止直接重发 `AMBIGUOUS` 消息。
- 令牌轮换：后台撤销旧凭证，更新 Windows 用户环境变量，注销并重新登录该 Windows 用户，然后重新运行 `doctor`。
- 微信升级、群改名或更换机器人账号：保持发送关闭，重新完成整份验收；更换账号后原身份绑定需要重新建立。

## 6. 卸载与回滚

```powershell
.\scripts\unregister-task.ps1
```

该命令只移除计划任务，保留本地 SQLite 以便核对未确认消息。确认服务端无待处理消息并备份验收记录后，可手动删除配置指定的 `state_dir` 和 `.venv`。删除本地状态会失去水位及不确定发送证据，无法恢复；不要在排障期间删除。最后在后台禁用设备并撤销令牌。
