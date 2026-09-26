# 非概念实况赛事管理

面向 eFootball 玩家与联赛管理员的 Native 微信小程序。当前仓库包含：

- 微信登录、个人资料与多平台游戏账号；
- 球员卡目录与受控数据导入；
- 个人单循环赛事、报名、赛程、比分确认与积分榜；
- 长期联赛、球队档案、多赛季报名、新队审核与老队续赛；
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
- [联赛赛季体系实施路线图](docs/superpowers/plans/2026-09-26-league-season-pyramid-roadmap.md)

当前联赛基础阶段止于“关闭报名 → 分组确认”。超级组/冠军组正式分配、单循环赛程、积分榜、足总杯，以及资产、财务、身价、工资帽和收藏均按路线图在后续阶段实现。
