# 联赛基础本地验收指南

本文用于验证第一阶段闭环：长期球队档案 → 创建联赛 → 创建并开放赛季 → 新队报名与审核 → 关闭报名 → 创建下一赛季 → 老队确认续赛。

第一阶段的产品边界停在 `ALLOCATION_REVIEW`（分组确认）。超级组/冠军组分配、赛程、积分榜和杯赛属于后续阶段，不应在本轮验收中出现可执行入口。

## 1. 准备本地环境

要求 Node.js 24、pnpm 11.23.0、Docker Desktop、MySQL 容器和微信开发者工具。

```bash
cp .env.example .env       # 仅首次执行；已有 .env 时不要覆盖
pnpm install
pnpm dev:db
pnpm db:migrate
pnpm --filter @efm/api exec prisma db seed
pnpm db:status
```

本地 `.env` 至少确认以下项目：

```dotenv
NODE_ENV=development
DATABASE_URL=mysql://efm:efm_local@127.0.0.1:3307/efootball_management
WECHAT_GATEWAY_MODE=fake
DEV_WECHAT_OPEN_ID=local-league-manager
```

用 `openssl rand -hex 32` 分别生成 `JWT_ACCESS_SECRET` 与 `REFRESH_TOKEN_PEPPER`。两者必须不同，只写入被 Git 忽略的 `.env`。本文不需要真实微信 AppSecret 或第三方网站签名材料。

启动 API：

```bash
pnpm start:api
```

## 2. 只在本地授予平台管理员

先以 `DEV_WECHAT_OPEN_ID=local-league-manager` 在小程序点击一次微信登录，让 API 创建本地用户。然后只在本地 Docker 数据库执行：

```bash
docker compose exec -T mysql mysql -uefm -pefm_local efootball_management <<'SQL'
START TRANSACTION;
SET @local_openid = 'local-league-manager';
INSERT INTO user_role_bindings
  (id, user_id, role_id, scope_type, scope_id, starts_at, expires_at, granted_by_id, created_at)
SELECT UUID(), u.id, r.id, 'PLATFORM', NULL, NOW(), NULL, u.id, NOW()
FROM users u
JOIN roles r ON r.code = 'PLATFORM_ADMIN'
WHERE u.wechat_open_id = @local_openid
  AND NOT EXISTS (
    SELECT 1 FROM user_role_bindings b
    WHERE b.user_id = u.id AND b.role_id = r.id
      AND b.scope_type = 'PLATFORM' AND b.scope_id IS NULL
  );
COMMIT;
SQL
```

这段命令不包含生产凭据，重复执行不会重复绑定。它只能用于个人本地数据库；不得在 CloudBase、预发或生产数据库给普通账号临时提权。完成后退出并重新登录，以获得反映新权限的会话。

## 3. 微信开发者工具设置

1. 导入 `apps/miniprogram`，确认 `miniprogramRoot` 为 `miniprogram/`。
2. 确认 `miniprogram/config/api.ts` 指向 `http://127.0.0.1:3000/v1`。
3. 打开“详情 → 本地设置”，仅在本地开发时关闭合法域名校验。
4. 编译并登录；底部导航应为“球员｜联赛｜我的”。
5. 切换本地测试身份后，应清除小程序 Storage 或退出登录，并重启 API，避免沿用上一个身份的 token。

当前自动化环境无法调用微信开发者工具 CLI，因为工具的本地服务端口未开启。不要为了自动化验收更改该安全设置；以下模拟器步骤需要在已打开的开发者工具中手工执行并记录结果。

## 4. 管理员创建球队、联赛和首赛季

使用 `local-league-manager`：

1. “我的 → 游戏账号”新增一个账号。
2. “我的 → 我的球队”建立唯一的长期球队档案，并绑定默认游戏账号。
3. “我的 → 创建联赛”，填写联赛名称、简称、平台与区服；确认默认值为超级组 23 人、冠军组每组 18 人、升级建议 4 人。
4. 保存后进入“报名工作台”，创建 S1。人数默认继承联赛规则，可在本赛季覆盖。
5. 填写按顺序递增的四个 ISO 时间：报名开放、报名截止、开赛、结束。
6. 保存草稿并点击“开放报名”。确认弹窗应提示：规则锁定，并生成续赛邀请。
7. 返回联赛详情，应能看到当前公开赛季和管理员专属“进入报名工作台”入口。

首赛季按产品规则只有冠军组，但本阶段尚未执行正式分组。

## 5. 玩家自主报名

1. 把本地 `.env` 的 `DEV_WECHAT_OPEN_ID` 改为 `local-league-player`，重启 API。
2. 清除小程序本地登录状态并重新登录。
3. 新增游戏账号，再建立玩家自己的长期球队档案。
4. 打开“联赛”，进入刚创建的联赛，选择游戏账号并点击报名。
5. 页面应显示“等待审核”，同一赛季不能重复报名。

## 6. 管理员审核并关闭报名

1. 把身份切回 `local-league-manager`，重启 API、清除小程序登录状态并重新登录。
2. 进入联赛详情 → 报名工作台。
3. 队列计数应显示 1 个新报名；“待审核”筛选能找到玩家球队。
4. 点击“通过”。如测试“拒绝”，必须输入拒绝原因；空原因不能提交。
5. 点击“关闭报名”并确认。状态进入“分组确认”，页面只显示“下一阶段：分组确认”说明卡，不出现开始赛季、排赛或杯赛操作。
6. 关闭后普通玩家不能再申请、确认续赛或撤回。

## 7. 下一赛季续赛

1. 管理员点击“创建下一赛季草稿”，确认 S2 继续继承联赛默认规则。
2. 开放 S2 报名。系统会为 S1 中已通过的球队生成 `INVITED` 续赛邀请。
3. 切回 `local-league-player` 并重新登录。
4. 进入该联赛的 S2，选择游戏账号并确认续赛。
5. 管理员工作台的“续赛待确认”应减少，“续赛已确认”应增加；老队确认后直接进入正式资格，无需再次审核。

## 8. 数据所有权与历史快照

- `User` 是微信登录身份；第一阶段每名用户最多拥有一个 `TeamProfile`。
- `TeamProfile` 是跨赛季长期球队档案，可更名、换队徽和更换默认游戏账号。
- `SeasonEntry` 是某一赛季的参赛资格，属于一个 `LeagueSeason`，并记录报名当时的队名、简称、队徽、平台、区服、玩家名和 UID 快照。
- 历史页面应读取 `SeasonEntry` 快照，而不是回读后来被修改的 `TeamProfile` 或 `GameAccount`。
- 修改联赛默认容量不会改变已创建赛季；每个 `LeagueSeason` 持有自己的规则快照。
- 管理权限由平台、联赛或赛季作用域绑定决定，小程序只按 API 返回的 capability 显示管理入口。

## 9. 自动化检查

```bash
export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
pnpm --filter @efm/contracts test
pnpm --filter @efm/api test -- leagues
pnpm --filter @efm/api test:e2e -- leagues.e2e-spec.ts
pnpm --filter @efm/miniprogram test
pnpm verify
pnpm db:status
git diff --check
```

验收时应特别确认：跨联赛权限被拒绝；重复幂等请求不会产生重复数据；版本冲突会刷新页面；原有个人赛事、比赛和比分流程仍通过测试。

## 10. 第一阶段已知限制与二期入口

第一阶段暂不实现：

- 超级组、冠军 A/B/C 正式分配和管理员调整；
- 系统分组建议、升降级建议与升级附加赛名单；
- 组内单循环赛程、轮空与 Stage 积分榜；
- 足总杯小组赛/淘汰赛和其他杯赛；
- 资产表、财务、身价、工资帽、收藏；
- 比赛截图 OCR、申诉、处罚和订阅消息。

下一阶段从“报名关闭后的分组确认”开始，详见 [联赛赛季体系实施路线图](superpowers/plans/2026-09-26-league-season-pyramid-roadmap.md)。

## 11. 回滚与数据保护

本阶段数据库变更均为新增表、枚举、权限和索引。代码可以回滚到旧版本，并让新增表暂时保留；旧个人赛事仍可继续运行。

不要直接删除已经包含球队档案、赛季或报名记录的表，也不要用 `prisma migrate reset` 处理共享、预发或生产数据库。若未来必须下线功能，应先导出并核对 `team_profiles`、`leagues`、`league_seasons`、`season_entries` 及其状态历史，再通过单独评审的数据迁移处理。
