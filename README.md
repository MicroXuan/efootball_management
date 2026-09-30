# 非概念实况赛事管理

面向 eFootball 玩家与联赛管理员的 Native 微信小程序。当前仓库包含：

- 微信登录、个人资料与多平台游戏账号；
- 球员卡目录与受控数据导入；
- 个人单循环赛事、报名、赛程、比分确认与积分榜；
- 长期联赛、联赛专属球队、多赛季报名、工资帽、转会窗口与只读小程序球队档案；
- 独立后台管理系统：平台管理员、联赛管理员、阵容交易、卡片升级和不可变财务流水；
- NestJS API、Prisma/MySQL 数据层和微信原生小程序。

## 本地启动

要求 Node.js 24、pnpm 11.23.0、Docker Desktop 和微信开发者工具。

```bash
cp .env.example .env
pnpm install
pnpm dev:db
pnpm db:migrate
pnpm --filter @efm/api exec prisma db seed
pnpm start:api
```

不要把 `.env`、微信密钥、JWT 密钥或第三方同步签名材料提交到 Git。微信开发者工具导入目录为 `apps/miniprogram`，本地 API 默认为 `http://127.0.0.1:3000/v1`。

## 验证

```bash
pnpm verify
pnpm db:status
git diff --check
```

- [联赛基础本地验收指南](docs/league-foundation-local-verification.zh-CN.md)
- [个人赛事闭环本地验收](docs/development/competition-loop.md)
- [后台管理系统本地开发与验收](docs/development/admin-web-local-development.zh-CN.md)
- [联赛球队迁移与回滚手册](docs/development/league-team-migration.zh-CN.md)
- [联赛赛季体系实施路线图](docs/superpowers/plans/2026-09-26-league-season-pyramid-roadmap.md)

当前版本已完成联赛球队、阵容与工资帽管理基础。超级组/冠军组正式分配、单循环赛程、积分榜、足总杯，以及资产表、身价管理和收藏仍按路线图继续扩展。
