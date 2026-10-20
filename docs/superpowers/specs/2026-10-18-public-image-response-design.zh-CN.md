# 公开图片地址统一输出设计

## 背景

CloudBase 上传后返回稳定的 `cloud://` 文件 ID。它适合持久化，但浏览器不能直接显示；如果各业务 Service 自行转换，球队队壳、联赛标志、赛季快照、赛程等新接口很容易遗漏。

## 决策

- 数据库、赛季快照和内部领域对象继续保存 `cloud://`，不写入会过期的 HTTPS 地址。
- API 在控制器响应的最外层统一遍历 JSON，只转换明确属于公开图片的字段。
- 转换结果继续使用已有 `publicImageUrl()`：签名地址有效期 10 分钟，服务端缓存 5 分钟并合并并发请求。
- 私有比赛凭证、对象键、上传授权、审计元数据以及显式保留的 `leagueCenterBannerCloudFileId` 不参与转换。
- 小程序通用 `entity-artwork` 组件使用统一图片缓存方法；即使旧接口或缓存数据仍返回 `cloud://`，也能通过 `wx.cloud.downloadFile` 显示。

## 公开字段白名单

采用精确字段名而非“所有 URL 字段”，避免把回调地址、上传地址或私有资源误当图片处理。首批覆盖：

- `logoUrl`
- `storedLogoUrl`
- `teamLogoUrl`
- `leagueLogoUrl`
- `teamLogoUrlSnapshot`
- `leagueCenterBannerUrl`
- `bannerUrl`
- `imageUrl`
- `cardImageUrl`
- `avatarUrl`
- `userAvatarUrl`
- `ownerAvatarUrl`
- `portraitUrl`
- `badgeUrl`
- `teamBadgeUrl`
- `coverUrl`
- `coverImgUrl`
- `packCoverUrl`

只有字段值以 `cloud://` 开头时才会转换，普通 HTTPS、空值及其他值原样返回。

## 错误策略

如果一个公开 `cloud://` 文件无法签名，API 请求失败并暴露配置或文件问题，而不是把浏览器无法显示的地址静默下发。客户端图片组件在下载失败时显示现有文字占位。

## 验证

- 单元测试覆盖嵌套对象、数组、白名单、私有字段、普通 HTTPS 与非普通对象。
- 应用装配测试确认全局拦截器已启用。
- 小程序集成测试确认通用图片组件同时支持 HTTPS 和 `cloud://` 缓存下载。
