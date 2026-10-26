# 微信群成员发现与后台身份绑定实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理员后台关联微信成员与 User，成员无需验证码或私聊即可在群里查询个人赛程、参与拍卖。

**Architecture:** 在现有 Bridge 消息扫描中增加独立的成员观察数据流，本地持久化后通过设备鉴权接口上传。后台仅平台管理员写入设备级全局身份映射，联赛页面只读本联赛状态；复用原 User 身份消费链路。普通聊天正文不进入服务器，竞价和成员同步使用独立重试队列。

**Tech Stack:** Python 3.12 / SQLite / NestJS / Prisma / MySQL / Zod / React / Ant Design。

**Spec:** `docs/superpowers/specs/2026-10-26-wechat-private-admin-design.zh-CN.md`，重点第 3、4、8.1 节。此计划是第一项可独立验收的交付；管理员私聊报分、晋级、转会和拍卖控制仍是后续必做模块，不在本阶段冒充完成。

## Global Constraints

- 全部改动在 dev；不修改已有无关文档，不创建 codex 分支。
- User 编号使用现有六位 `publicUserNo` 字符串并保留前导零，唯一标识是设备及微信联系人标识，不是昵称。
- 不依赖完整群成员读取；只承诺授权群中实际观察到的可信发送者。
- 保持现有绑定有效，不产生双重身份数据库；停止新增验证码绑定，不向用户要求手工绑定。
- 平台管理员可绑定/换绑/解绑，联赛管理员只读本联赛；User 绑定不产生 Admin 权限。
- 所有 API 测试命令显式前置 `DATABASE_URL="$EFM_VERIFY_DATABASE_URL"`。执行前校验该任务变量 URL 主机仅 localhost/127.0.0.1/::1、数据库名包含 test 或 verify。未准备隔离库就不能执行写入测试；不得读取 .env 补齐。
- 目标环境先 db:status 再受控部署迁移；不运行共享库 seed、开发迁移或测试。测试残留清理复查。
- Windows 实机与本机自动测试分开验收；成员观察不阻塞竞价，普通聊天不自动回复。

## Review Focus

1. 同一设备服务多个联赛：联赛管理员不得借身份关联修改其他联赛权限（任务 3）。
2. 成员观察上传失败后游标已推进：重启仍能补传，普通正文不能落入观察队列（任务 2）。
3. 换绑已有拍卖记录的联系人：保留历史报价归属，不删除被引用的绑定记录（任务 3）。
4. 两个浏览器标签并发绑定/解绑：旧预览拒绝提交，重试不重复创建审计（任务 3、4）。
5. 未绑定者报价后才被绑定：只接受绑定后的新报价，绝不能重放旧报价（任务 5）。

---

### Task 1: 成员同步和管理接口契约

**Files:** Modify `packages/contracts/src/wechat-bot.ts`, `apps/api/prisma/schema.prisma`; create `packages/contracts/src/wechat-observed-members.spec.ts`, migration under `apps/api/prisma/migrations/<timestamp>_wechat_observed_members/migration.sql`.

**Interfaces:** 新增 `WechatObservedMemberInputSchema` = `{wechatGroupId, wechatContactId, displayName: string|null, observedAt: ISO}`；`WechatObservedMembersBatchSchema` = `{items: array(1..100)}`，所有对象 strict，拒绝 text/body。`AdminWechatIdentityMutationSchema` = `{observedMemberId, userId: UUID|null, expectedBindingId: UUID|null, expectedVersion: number|null, reason: string, idempotencyKey: UUID}`。返回绑定视图含 ID、version、User 的 publicUserNo/displayName、状态和时间。查询统一游标分页 limit 1..100，默认 30。

- [ ] 先写契约测试：拒绝正文、多余字段、101 项、非法标识/时间；`001234` 保持字符串；昵称可为空但不能充当标识。运行并确认新增契约缺失导致失败。
- [ ] 新增 `WechatObservedMember`，按 deviceId + wechatGroupId + wechatContactId 唯一，保存 nullable displayName、firstObservedAt/lastObservedAt，关联设备；查询必须通过当前群绑定限定范围。身份绑定增加 version（默认 1），沿用两个现有唯一约束，不改变已有绑定含义。
- [ ] 编写增量 SQL；Prisma validate/generate 及 contracts 测试通过。在已核验的本机隔离库 migrate deploy，验证存量绑定可读与唯一约束。
- [ ] 只提交该任务文件。

### Task 2: Bridge 独立发现与持久化同步

**Files:** Modify `apps/wechat-bridge/src/efm_wechat_bridge/{models,wechatauto_receiver,transport,fake_transport,spool,api_client,runtime}.py`; tests `tests/{test_receiver,test_spool,test_runtime,test_api_client,test_transport_contract}.py`; API `apps/api/src/wechat-bot/wechat-bridge.controller.ts`; create `wechat-observed-members.service.ts` and `.spec.ts`; register in `wechat-bot.module.ts`.

**Interfaces:** `ObservedMember` 对应任务 1；receiver/transport `observed_members() -> list[ObservedMember]` 读取待持久化观察，明确仅在 spool 持久化成功后清除内存批次。spool 提供 `upsert_observed_members(items)`, `pending_observed_members(limit=100)`, `ack_observed_members(items)`；ack 必须匹配观察版本，不能清除期间更新的新观察。client `upload_observed_members(items)` 调用 `POST /v1/wechat-bot/bridge/observed-members`。service `accept(deviceId, input)` 对每项返回 accepted/ignored，重新检查当前授权群。

- [ ] 先写失败测试：普通群文本发现成员但不产生 InboundEvent；未知发送者、自发消息、非授权群、私人普通会话不采集；重名不同标识分别保存；昵称解析失败仍保留标识。
- [ ] 在消息正文命令过滤前，复用可信发送者解析采集成员；昵称只是展示信息。按群+成员合并批次，不修改原命令识别和竞价行为。
- [ ] 先写重启/失败测试：SQLite 仅保存成员字段；持久化失败不推进对应游标；服务端超时后重启补传；旧 ack 不删除新观察；群停用后不继续上传旧群观察。
- [ ] 实现独立成员 spool；每轮先持久化观察，再持久化游标。成员上传在独立低优先级循环执行，每批最多 100，退避并记录队列深度/最老年龄。已确认成员的昵称或观察时间变化可合并更新，不每条聊天新增记录。启动时兼容旧 SQLite。
- [ ] API 以设备凭证中的 deviceId 为准，不接收可伪造的设备字段；事务 upsert 只接受当前启用群。旧观察不得覆盖新昵称/时间，异常未来时间拒绝；群权限变化丢弃相应待上传元数据。
- [ ] Run `cd apps/wechat-bridge && uv run --group dev pytest`；API 使用显式隔离 URL 执行新 service 和既有 bridge/outbox 测试，全部通过后提交。

### Task 3: 后台绑定服务、权限与审计

**Files:** Create `apps/api/src/wechat-bot/admin-wechat-identities.service.ts`, `admin-wechat-identities.controller.ts` 及对应 `.spec.ts`；modify `wechat-bot.module.ts`, `wechat-binding.service.ts`。

**Interfaces:** 平台路由 `/v1/admin/wechat-bot/devices/:deviceId/members`（GET 分页，可按群、绑定状态筛选）、`/user-candidates?publicUserNo=001234`（GET 精确查询）、`/identity-bindings`（PUT 任务 1 请求）。service `listMembers(actorAdminId, deviceId, query)`, `findUser(actorAdminId, deviceId, publicUserNo)`, `saveBinding(actorAdminId, deviceId, input)`。联赛只读 `/v1/admin/leagues/:leagueId/wechat-bot/members`，从当前群绑定约束范围，不返回其他联赛成员。

- [ ] 写失败测试：普通用户和联赛管理员写入拒绝；跨设备候选拒绝；User 停用/缺失拒绝；缺少编号不做昵称猜测；相同联系人或同 User 已有效绑定时返回冲突，不覆盖。
- [ ] 新服务同时在 controller 与 service 内校验平台管理权限。绑定复用原映射，通过数据库事务与唯一约束防竞态；使用现有业务回执模式保证 idempotencyKey 重试结果稳定。expectedBindingId/version 在事务内比较，空预期只允许未绑定。
- [ ] 写换绑测试：旧拍卖记录保留原始身份/球队证据，不删除绑定记录；历史绑定与现有唯一约束冲突无法安全迁移时明确拒绝自动换绑。解绑使后续报价立即失效；更新+审计+回执同事务，reason 必填。
- [ ] 实现换绑前影响预览，展示设备级关联影响；强制账号切换时使原设备身份停用，不能静默让新机器人继承旧映射。确认外部报价历史引用方式后决定保留快照或新增身份历史表，禁止改写历史归属。
- [ ] 显式隔离 URL 运行新服务/控制器及现有绑定测试，补真实数据库并发唯一约束集成测试并自动清理，提交。

### Task 4: 高频后台成员管理界面

**Files:** Create `apps/admin-web/src/platform/wechat-bot-members-panel.tsx` and `.spec.tsx`; modify `platform/wechat-bot-devices-page.tsx`, `leagues/wechat-bot-page.tsx` and related tests; create shared read-only member list component only if both need reuse.

**Interfaces:** `WechatBotMembersPanel({deviceId, api})`；使用任务 3 路由及契约解析。平台设备页进入成员管理；联赛机器人页展示本联赛成员状态及“由平台管理员维护身份关联”。

- [ ] 先写用户行为测试：群筛选和分页、显示缺失昵称/最近观察时间、输入六位编号查用户、确认预览后绑定；按钮忙碌时防双击。
- [ ] 实现列表：微信昵称+稳定标识、所在群、最近观察、关联用户编号/名称、绑定状态；说明“已观察成员，非完整成员名单”。将设备离线和成员为空作为不同状态展示。
- [ ] 实现绑定/换绑/解绑弹窗，显示旧/新用户、机器人、影响范围、球队上下文和必填原因；用户选取使用 ID 提交，编号仅查找。冲突时刷新，不保留可误提交的旧预览。
- [ ] 测试快速切换设备/分页时迟到响应不能覆盖当前列表；错误可重试，成功更新本行且不群发通知；同名成员显示身份区别。
- [ ] Run `pnpm --filter @efm/admin-web test` 和 `pnpm --filter @efm/admin-web typecheck`；浏览器验证真实布局、窄窗口可读及长昵称，提交。

### Task 5: 无验证码入口与既有命令回归

**Files:** Modify `apps/api/src/wechat-bot/{wechat-bindings.controller,wechat-binding.service,wechat-command-router.service,wechat-message-formatter}.ts`, `apps/api/src/player-auctions/player-auction-message.formatter.ts` and tests; update `apps/miniprogram/miniprogram/pages/wechat-bot-binding/` and corresponding tests, profile entry copy if needed; `apps/api/test/wechat-admin-identities.e2e-spec.ts`.

- [ ] 先写测试：后台绑定后“我的赛程”和新报价无需验证码；未绑定提示“请联系管理员在后台关联账号”；绑定前拒绝的报价不会因绑定而重放；解绑、用户停用、失去球队后立即拒绝相关操作。
- [ ] 停止新验证码签发和消费，兼容路由返回明确业务错误 `WECHAT_BINDING_ADMIN_MANAGED`。保留旧映射及 GET 状态/主动解绑；修改群帮助、拍卖错误文案和小程序绑定页为状态查看与联系管理员，移除生成验证码按钮。
- [ ] 使用隔离 URL 验证新集成场景及 API 全单元测试；执行 admin-web 和 miniprogram 完整测试。小程序实际预览正常/禁用态、窄屏/常见宽度；无法启动开发者工具时列未验收项，不声称通过。
- [ ] 回归后台现役/已退出球队、球队详情、小程序我的联赛、原群赛程查询和原拍卖通道；明确记录每项证据，提交。

### Task 6: 高频与故障验收、部署说明

**Files:** Modify `docs/deployment/windows-wechat-bridge.zh-CN.md`, `docs/development/player-auction-bot-verification.zh-CN.md`; create `docs/development/wechat-admin-identities-verification.zh-CN.md`。

- [ ] 增加混合负载测试：连续群聊天、赛程查询、多队报价下观察队列合并有界且不丢成员，报价顺序不被改变；网络断开/重启后补传无重复操作。记录入站/观察/发送积压，不以单元测试耗时替代端到端延迟。
- [ ] 更新部署顺序：目标 db:status → 受控迁移 → API/后台 → Bridge；旧 Bridge 不调用新接口仍可工作，新 Bridge 遇旧 API 失败需可见且不阻断原竞价。禁止沿用旧手册的未指定数据库测试命令。
- [ ] 专用 Windows 电脑验证真实发送者标识、昵称缺失处理、改名、多人同名、跨群同人、后台绑定后查询/报价、离线恢复及锁屏。未取得该机器访问时仅交付代码与待验收清单，不启用真实发送。
- [ ] 运行 `git diff --check`、受影响构建及类型检查；新鲜独立代码审阅后修复实质问题。汇报本机结果与目标未验收项，明确私聊管理后续模块未在本阶段实现。

## 后续模块顺序

本阶段完成后继续按总体设计制定并执行管理员身份配置与私聊确认框架、比分/晋级、转会、拍卖私聊控制/审核的计划。每项共享同一套用户身份与设备状态，不另建重复机器人。全模块完成前，不以“无感绑定完成”代替用户原始机器人需求已全部交付。
