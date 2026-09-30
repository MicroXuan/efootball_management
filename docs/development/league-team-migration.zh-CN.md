# 联赛球队迁移与回滚手册

## 迁移前

1. 停止旧版本写入并备份 MySQL；记录备份文件、Git 提交和迁移编号。
2. 在备份恢复出的临时数据库执行 `pnpm db:migrate`。
3. 执行 `pnpm league-teams:migrate --dry-run`，保存 JSON 报告。

报告必须满足：`unresolvedNumbers = 0`、`invariantViolations = []`。`linkedSeasonEntries` 应与迁移前的赛季报名总数一致。`createdTeams` 在当前结构迁移已完成后通常为 0。

历史球队缺少编号时，由联赛管理员在后台分配；工具不会猜测编号。处理后重新干跑，直到报告无未决项，再执行：

```bash
pnpm league-teams:migrate --apply
```

生产环境还需显式确认：

```bash
NODE_ENV=production pnpm league-teams:migrate --apply --confirm-production
```

重复执行 `--apply` 必须得到相同计数，不创建重复球队或报名关联。

## 发布与回滚

发布前执行 `pnpm verify && pnpm db:status && git diff --check`。上线后按后台完整验收路径抽查一支球队。

需要回滚时停止新版本写入，恢复迁移前备份并部署对应 Git 提交。首个发布周期保留旧 `TeamProfile` 表和页面文件；删除旧表属于破坏性变更，必须另开评审计划，不能在本迁移中执行。
