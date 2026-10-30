# 手机管理员工作台

入口：后台顶栏「手机工作台」，或直接访问后台同域名的 `/mobile`。
使用现有管理员账号，未登录时登录后返回原手机页面；不新增账户、数据库模型或 API。
平台管理员可选择所有可管理联赛，联赛管理员仅显示已授权联赛。浏览器按管理员账号记住最近选择的联赛。

## 第一版范围

- 工作台：所选赛季已发布比赛的待录比分数量，以及此联赛全部赛季的待审核转会数量；各显示前三条并提供完整列表入口。
- 赛程／比分：选择赛季、轮次、比分状态，按球队名称或编号搜索。默认选择进行中赛季，没有则使用后台返回的第一个赛季。只展示已发布赛程。一次展示 20 条，可继续显示。
- 比分：0—99 的整数，主客队顺序明确；新录入与修正均要求原因。先核对，再提交官方比分。沿用后台服务的赛事状态、争议阶段、淘汰赛胜负、乐观锁、幂等与审计规则。
- 转会：待审核、待对方确认、全部记录；查看球员、双方、报价、申请说明和处理记录。只有待管理员审核的申请可批准／驳回，审核理由必填。
- 手机界面独立于桌面侧栏，但沿用登录会话及 API 客户端。页面中的比赛时间使用项目既有北京时间格式。

比分使用已发布赛事列表和比赛接口读取，使用联赛管理员比分接口写入。转会复用现有申请查询及审核接口。赛季和赛事列表处理游标分页。任一赛事读取失败会显示错误，不将部分赛程当成完整结果。
切换联赛或赛季时清除旧内容，忽略已过期的异步响应。重复点击提交被锁定，网络失败后重试相同提交沿用幂等键；编辑内容后生成新键。服务端版本冲突时提示关闭窗口并刷新核对。

## 本地验证

```sh
pnpm --filter @efm/admin-web exec vitest run src/mobile
pnpm --filter @efm/admin-web build
pnpm --filter @efm/miniprogram exec vitest run miniprogram/pages/my-league-teams/my-league-teams.viewmodel.spec.ts miniprogram/pages/league-team-detail/league-team-detail.viewmodel.spec.ts miniprogram/pages/league-team-detail/league-team-detail.template.spec.ts
```

浏览器检查脚本：`apps/admin-web/scripts/mobile-browser-check.mjs`。需要可用的 Playwright 与 Chromium；可通过 `EFM_PLAYWRIGHT_MODULE` 指向已安装的 Playwright ESM 入口，不修改项目依赖。

```sh
VITE_API_BASE_URL='' pnpm --filter @efm/admin-web exec vite --host 127.0.0.1 --port 4187 --strictPort
# 在另一个终端执行，若 Playwright 不在模块搜索路径，显式指定 EFM_PLAYWRIGHT_MODULE。
node apps/admin-web/scripts/mobile-browser-check.mjs
```

脚本拦截所有 `/v1/` 请求，只使用浏览器内存中的模拟数据，未知接口直接失败，绝不回源写入数据库。
覆盖 320 / 375 / 390 / 768px 下的登录返回、赛程、比分二次确认及保存、转会审核、刷新、禁用态、导航和卡片内部按钮边界；保留截图。默认输出到 `/tmp/efm-mobile-verification`，可用 `EFM_MOBILE_OUTPUT` 指定目录。

## 发布与验收边界

本次仅修改后台前端，无新增数据库迁移。不需要更改小程序或群机器人。
部署新版后台后，检查同域 `/mobile` 的 SPA 回退规则及深链接刷新。生产验收还需用真实管理员账号核对授权联赛、实际赛程与转会记录，并经授权对指定比赛／申请完成写入验收。
浏览器模拟数据测试与本地组件回归不代表生产环境已经验收；本次未部署，未在共享数据库造数或写入真实业务记录。

### 本次验证结果（2026-10-27）

- 后台完整 Vitest：59 个文件、265 项测试通过（含手机页新增 12 项）。
- 小程序“我的联赛”及球队详情：3 个文件、11 项测试通过。
- 后台 TypeScript 与生产构建通过；构建仍提示依赖注释及较大分包警告。
- Chromium：320 / 375 / 390 / 768px 全部通过；窄屏下轮次选择文案也检查了实际可用宽度。
- `git diff --check` 通过。
- 本次截图位于 `output/mobile-workbench/`；全部是浏览器模拟业务数据，不代表真实联赛记录。
