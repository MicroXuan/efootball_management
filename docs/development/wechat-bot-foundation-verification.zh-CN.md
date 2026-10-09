# 微信群机器人基础验收与运维

本文用于验收目前已经完成的服务端、小程序绑定页和后台配置页。当前版本能可靠处理身份绑定、`帮助`、`查询赛程`、`我的赛程`，但还没有启用真实 Windows 微信收发，也没有自动拍卖状态机。

## 当前安全边界

- 一个微信群只能绑定一个联赛；一个联赛配置从机器人已观察到的群中选择。
- 设备令牌只在平台管理员创建或轮换设备时展示一次，数据库只保存 bcrypt 摘要。
- 用户在小程序获取六位验证码后，必须私聊机器人发送 `绑定 123456`。验证码五分钟过期、只能使用一次，新验证码会使旧验证码失效。
- Bridge 请求使用设备令牌认证，并对 `METHOD\nPATH\nTIMESTAMP\nNONCE` 做 HMAC-SHA256 签名。时间戳允许误差五分钟，nonce 只能使用一次。
- 入站消息按“设备 + 微信消息 ID”去重；出站回复按业务键去重。只有收到微信侧回读消息 ID 后才能确认 `SENT`。
- 当前不会根据群消息改变资金、工资或阵容。以后拍卖成交仍由管理员人工审核，`下一位`也由管理员手动确认。

无法承诺任何个人微信自动化绝对不会触发微信风控。正式 Bridge 必须使用专用微信号、真实交互式 Windows 会话、串行低频发送、严格群白名单和失败即停策略；不要加入绕过检测、批量加好友、营销群发等行为。

## 环境变量

从 `.env.example` 创建本地 `.env`，至少设置数据库、JWT、刷新令牌 pepper 和微信登录参数。机器人新增参数如下：

```dotenv
WECHAT_BOT_OUTBOX_LEASE_MS=30000
WECHAT_BOT_OUTBOX_MAX_ATTEMPTS=3
WECHAT_BOT_HEARTBEAT_TIMEOUT_MS=60000
WECHAT_BOT_COMMAND_RETENTION_HOURS=24
```

含义：

- `WECHAT_BOT_OUTBOX_LEASE_MS`：Bridge 领取一条待发送消息后的租约时长。
- `WECHAT_BOT_OUTBOX_MAX_ATTEMPTS`：连续发送失败达到此次数后打开设备熔断。
- `WECHAT_BOT_HEARTBEAT_TIMEOUT_MS`：后台判断设备心跳过期的阈值。
- `WECHAT_BOT_COMMAND_RETENTION_HOURS`：已处理命令的保留时长。
- `REFRESH_TOKEN_PEPPER`：同时用于验证码 HMAC 摘要；生产环境必须是至少 32 字符的随机秘密，不可提交到 Git。

设备令牌不属于 API 环境变量。它应只保存在对应 Windows 电脑的 `EFM_WECHAT_BRIDGE_TOKEN` 中。

## 初始化和自动验收

```bash
pnpm dev:db
pnpm db:migrate
pnpm --filter @efm/api test:e2e -- wechat-bot.e2e-spec.ts --runInBand
```

端到端测试会自动完成以下闭环并清理自己的数据：

1. 创建平台管理员、联赛、赛季、比赛和机器人设备。
2. 用签名心跳上报一个已观察微信群。
3. 把该群绑定到联赛并选择“甲级联赛”作为赛程来源。
4. 用小程序用户身份签发验证码，再通过私聊命令完成身份绑定。
5. 上传 `查询赛程` 和 `我的赛程`，领取三个回复并逐条回执。
6. 原样重传入站批次，确认仍只有三条 inbox 和三条 outbox，避免网络重试造成重复回复。

全仓验收使用：

```bash
pnpm verify
pnpm db:status
git diff --check
```

## 签名请求格式

真实 Bridge 每次请求都必须生成新的 UTC 时间戳与 nonce。以下 Node.js 片段展示签名算法，示例值不能用于生产：

```js
import { createHmac, randomUUID } from 'node:crypto';

const method = 'POST';
const path = '/v1/wechat-bot/bridge/heartbeat';
const timestamp = new Date().toISOString();
const nonce = randomUUID();
const token = process.env.EFM_WECHAT_BRIDGE_TOKEN;
const signature = createHmac('sha256', token)
  .update(`${method}\n${path}\n${timestamp}\n${nonce}`)
  .digest('hex');
```

请求必须同时包含：

```text
Authorization: Bridge <一次性设备令牌>
X-Bridge-Device: <设备 UUID>
X-Bridge-Timestamp: <UTC ISO 时间>
X-Bridge-Nonce: <每次请求唯一值>
X-Bridge-Signature: <64 位小写十六进制 HMAC>
```

可用接口：

| 接口 | 用途 |
| --- | --- |
| `POST /v1/wechat-bot/bridge/heartbeat` | 上报登录、锁屏、队列和已观察群 |
| `POST /v1/wechat-bot/bridge/messages` | 批量上传经过本机白名单过滤的文本命令 |
| `POST /v1/wechat-bot/bridge/outbox/claim` | 租赁待发送回复 |
| `POST /v1/wechat-bot/bridge/outbox/:id/ack` | 回读成功后确认，或报告明确失败 |

## 人工验收顺序

1. 平台管理员进入“机器人设备”，创建设备并立即安全保存令牌。
2. 模拟或真实 Bridge 上报心跳；后台应显示在线、微信版本、最后心跳和发送队列。
3. 联赛管理员进入“微信群机器人”，选择一个已观察群和允许查询的赛事，保存配置。
4. 用户在小程序“我的”页面点击“绑定群机器人”，复制私聊指令并在五分钟内发送。
5. 机器人应私聊回复“绑定成功。”；小程序刷新后显示设备名和绑定时间。
6. 群内发送 `查询赛程`，应返回全部配置来源中的未完成比赛；发送 `我的赛程`，只返回该用户球队相关比赛。
7. 对同一个微信消息 ID 再上传一次，响应应为 `DUPLICATE`，群内不应出现第二份回复。
8. Bridge 领取 outbox 后必须先在微信本地记录中确认发送结果，再提交带 `readbackMessageId` 的 `SENT` 回执。

## 数据库排查

只检查元数据，不复制真实聊天内容到工单或日志：

```sql
SELECT id, name, status, login_status, circuit_status, last_heartbeat_at
FROM wechat_bot_devices;

SELECT device_id, wechat_group_id, display_name, enabled, league_id
FROM wechat_group_bindings;

SELECT device_id, message_id, processing_status, result_code, received_at
FROM wechat_inbound_messages
ORDER BY received_at DESC LIMIT 20;

SELECT device_id, target_type, status, attempt_count, failure_code, created_at
FROM wechat_outbox_messages
ORDER BY created_at DESC LIMIT 20;
```

如果设备熔断：先检查 Windows 是否解锁、微信是否仍登录、版本是否匹配及目标群是否准确；处理根因后由平台管理员点击“复位熔断”。不要在结果不确定时反复点击发送。

## 清理与令牌泄露处置

- 测试夹具由端到端测试自动清理；不要对共享数据库运行无条件 `DELETE`。
- 设备退役时先在后台停用，再清除 Windows 端环境变量和本地 Bridge 状态目录。
- 令牌疑似泄露时立即在后台“轮换令牌”；旧令牌随数据库更新立即失效。新令牌只配置到目标 Windows 电脑。
- 验证码无需人工清理，使用后即失效；用户也可在小程序主动解除身份绑定。

## Windows Bridge 状态

本阶段只完成 API、数据模型、小程序与管理后台。`apps/wechat-bridge` 尚未实现，因此真实读取或发送微信消息必须保持关闭。后续严格按 `docs/superpowers/plans/2026-10-09-windows-wechat-bridge-implementation-plan.md` 实施，并通过 `doctor`、`--dry-send` 和目标电脑验收门禁后，才允许显式启用真实发送。
