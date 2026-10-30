# 管理员私聊晋级、转会和拍卖实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. 当前会话原地执行，最后独立审查。

**Goal:** 在管理员私聊中完成杯赛人工晋级、转会及准备好的拍卖批次控制/审核。
**Architecture:** 沿用设备绑定 AdminAccount、实时联赛权限和两分钟确认。新增通用管理操作回执与持久短号；所有业务效果和回执同事务提交。晋级使用显式无比分裁定；转会、拍卖复用现有事务服务。价格/费用预览调用事务内业务并回滚到 savepoint，确保预览与真实校验一致，确认费用变化回滚并要求重预览。
**Tech Stack:** NestJS / Prisma / MySQL / React / Python Bridge。
**Spec:** docs/superpowers/specs/2026-10-26-wechat-private-admin-design.zh-CN.md

## Global Constraints
- 在 dev 开发；保留当前移动后台与普通用户绑定未提交修改。
- 所有 API 测试显式 DATABASE_URL=mysql://efm:efm_local@127.0.0.1:3307/efm_wechat_verify，仅本机隔离库迁移与造数。
- 管理命令仅管理员私聊；群内竞价保持原渠道和资格；群管理命令明确拒绝。
- 新功能独立开关 WECHAT_BOT_PRIVATE_MANAGEMENT_ENABLED 默认 false，需先应用迁移；不部署共享库。
- AdminAccount 授权、设备锁和实时联赛授权复用录分；操作绑定设备/联系人/版本，权限撤销及换绑立即失效。

## Review Focus
- 业务提交但回复失败或重启：重放只返回持久回执，不重复转会/结算。
- 费用、赛季、提名首位、所有权和签表变化：确认必须拒绝陈旧预览。
- 人工晋级无比分：所有相关赛程展示明确裁定，不造比分，后轮结果锁定不能绕过。
- 拍卖故障恢复：独立“恢复拍卖 … 原因：已核对…”预览，检查设备和不确定发件；普通继续拒绝恢复态。
- 私聊公告对象：只写批次绑定群，验证同设备和群能力；群管理入口即使已有 User 管理权限也不能执行。

### Task 1: 通用回执、短号与无比分晋级
- [x] 新增 WechatAdminOperation / WechatEntityReference，比赛裁定字段和审计；迁移到隔离库。
- [x] CupProgressionService 增加 recordAdvancement(tx, matchId, winnerParticipantId, allowCorrection)；比分入口先转换胜者再复用。
- [x] ResultsService.applyAdministratorAdvancement 同事务写裁定/事件/审计，复用比赛与下游锁；录分更正清除裁定。
- [x] 赛程/签表契约及展示覆盖裁定；测试无假比分、下游锁、重放。

### Task 2: 转会及拍卖事务接口
- [x] 抽取 AdminPlayerAuctionsService.cancelWithClient / reviewLotWithClient，现有后台调用共享实现。
- [x] 新私聊服务调用 RosterTransactionsService.transferWithClient；以 savepoint 预览后回滚，提取双方、金额、手续费、工资/规则；确认相同结果才提交。
- [x] 拍卖开始/暂停/继续使用 state 的 tx 入口；恢复独立 tx 入口校验版本/故障；控制写群公告与审计。
- [x] 测试预览无持久写入、费用改变回滚、审核单次结算。

### Task 3: 命令和渠道
- [x] 查询：球队、阵容 T编号、拍卖列表、拍卖 A编号；持久 P/A/L 短号，T 使用联赛球队编号。
- [x] 写入：晋级 M编号 主队/客队 原因：…；转会 P编号 T来源 T目标 金额 原因：…；开始/暂停/继续/取消/恢复拍卖 A编号；审核成交/调整成交/作废成交 L编号。
- [x] 共享确认/取消/操作命令分流到通用回执；帮助完整；Bridge/API 同步白名单。
- [x] 管理员解绑/机器人换号取消新操作；群内管理命令只提示私聊。

### Task 4: 验证和交付
- [x] 覆盖解析、权限、竞态、幂等、晋级、转会与拍卖真实隔离数据库集成；自动清理。
- [x] API 相关测试、后台球队/详情/杯赛/拍卖、我的联赛与赛程、Bridge 回归；类型检查。
- [x] 独立审查与修复，受控部署/实机验收说明；本地 dev 提交，明确目标迁移和 Windows 未验收。

## 执行记录

- 实现与验证均在 dev；未修改共享数据库，未推送。
- 关键兼容性决定：MySQL 驱动 prepared 协议不支持保存点，使用 adapter 官方 useTextProtocol；仍由驱动参数转义。代价是所有 Prisma 查询使用文本协议，因此补测真实 API 契约及事务流程。
- 私聊管理独立开关，但新比赛字段要求目标环境先迁移再运行新版查询。
- 独立审查：发现恢复漏拦 PROCESS_RESTART_DURING_SEND / WECHAT_SEND_EXCEPTION，已用预览与确认两阶段用例复现后修复。卡片“未开始”问题按结果显示错误升级为必修，新增用例 RED→GREEN；无延期审查项。
- 测试：API 单元 229/229；真实隔离数据库集成 31/31（含新管理 8 项）；后台球队/详情/阵容/杯赛/拍卖 42/42；小程序我的联赛/球队详情/赛程/杯赛 48/48；契约 129/129；Bridge 92 通过、2 个 Windows PowerShell 专项在 macOS 跳过。
- 类型检查 API、后台、小程序通过。晋级签表返回结果实际通过契约解析；无官方比分时两个比分字段为空。
- 本机 efm_wechat_verify 测试记录自动清理并复查 users/admins/leagues/devices/operations/references/ledger 均为 0；临时测试编号序列与权限基础数据备份后按精确 ID 事务清理。
- 目标 pnpm db:status 返回 Schema engine error，目标迁移/接口与 Windows 微信端未验收；不能视为已上线。启用与实机步骤见 docs/wechat-private-management-setup.zh-CN.md。
