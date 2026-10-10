# 后台管理系统本地开发与验收

## 启动

```bash
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
pnpm dev:db
pnpm db:migrate
pnpm --filter @efm/api exec prisma db seed
pnpm start:api
```

另开一个终端：

```bash
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
pnpm --filter @efm/admin-web dev
```

后台默认访问 `http://127.0.0.1:4173/login`，API 为 `http://127.0.0.1:3000/v1`。使用种子脚本创建的平台管理员账号登录；密码只保存在本地环境或密码管理器，不写入文档。

`.env` 中的 `LOCAL_ADMIN_USERNAME` 决定本地平台管理员用户名，`LOCAL_ADMIN_PASSWORD_HASH` 必须是预先计算的 bcrypt 哈希。修改两项后重新执行 `pnpm --filter @efm/api exec prisma db seed`。不要在仓库或文档中填写明文密码。

## 重启 API 和后台

先在原终端按 `Control + C`，再执行对应启动命令。如果终端已丢失且出现 `EADDRINUSE`，先确认占用进程，不要盲目结束其他服务：

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:4173 -sTCP:LISTEN
```

确认 PID 属于本项目后执行 `kill <PID>`，然后分别运行：

```bash
pnpm start:api
pnpm --filter @efm/admin-web dev
```

## 联赛图片本地存储

本地 `.env` 使用：

```dotenv
STORAGE_PROVIDER=local
LOCAL_STORAGE_DIR=.data/uploads
PUBLIC_API_BASE_URL=http://127.0.0.1:3000
```

图片文件写入 `LOCAL_STORAGE_DIR`，该目录不提交 Git。后台和 API 都只接受 JPG、PNG、WebP，大小不超过 2 MiB；API 还会检查真实文件签名，修改扩展名不能绕过校验。

## 完整验收路径

1. 平台管理员进入“联赛管理”，填写联赛图片、名称、说明，并必选“国服”或“国际服”。
2. 进入联赛的“赛季管理”，创建赛季并明确点击“设为当前赛季”。创建赛季本身不会自动设为当前赛季。
3. 让用户先登录一次小程序，在“我的”复制 6 位用户编号。
4. 联赛管理员按该编号查找用户，创建联赛专属球队并分配易记球队编号。创建成功会在同一事务中把球队报名到当前赛季。
5. 返回赛季管理，确认当前赛季参赛球队数增加；小程序下拉刷新后，“联赛”显示实时人数，“我的”显示管理员绑定的球队。
6. 设置工资帽和自动加点总评工资档次，先查看影响预览再发布。
7. 创建赛季转会窗口，并分别启用购买、出售、队间转会和卡片升级权限。
8. 在球队详情进入阵容管理：搜索球员，确认系统推荐的最高自动加点卡，也可展开查看其他卡。
9. 购买球员，核对 `当前人数/25` 和 `当前工资/工资帽`；同一真实球员不能被同联赛另一球队获得。
10. 在窗口内执行队间转会与卡片升级，确认工资重新计算；窗口关闭时按钮必须禁用。
11. 打开财务流水，确认记录只有查看能力，没有编辑或删除入口。

跨联赛访问、超 25 人、工资超帽、缺少自动加点结果和重复真实球员都必须由 API 拒绝。PESDATA 的 DT 值允许为空，不影响签约或升级资格。

联赛发布功能的逐项验收与异常路径见 [联赛展示与管理员绑定验收手册](./league-presentation-verification.zh-CN.md)。
