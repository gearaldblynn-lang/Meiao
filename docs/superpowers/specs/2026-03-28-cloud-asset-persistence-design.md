# 云端资源持久化与 3 天清理设计

**目标**

在不改变现有业务模块功能逻辑、提交语义、轮询语义、结果语义的前提下，为全模块补上云端稳定资源承载层：

- 上传素材持久化到应用服务器本地目录
- 生成结果同步持久化到应用服务器本地目录
- MySQL 仅保存资源元数据与关联关系
- 资源默认保留 3 天，自动清理
- 前端刷新后可以恢复素材与结果，不再依赖浏览器内存 `File` 或第三方临时 URL

## 现状

- 当前 `/api/assets/upload` 与 `/api/assets/upload-stream` 最终仍调用 Kie 上传能力。
- 前端模块虽然已经通过内部 API 上传，但拿到的仍是第三方临时 URL。
- `app_state` 已经会持久化部分 URL 字段，也有 3 天资源保留常量，但没有真实的本地资源仓。
- 刷新页面后，如果浏览器中的 `File` 丢失，而状态里只有第三方临时 URL，就会出现“原始文件失效”“结果需要重新找回”等问题。
- 上传速度也会受到“先上传到第三方临时图床”的影响。

## 设计目标

1. 保持所有模块原有的业务行为和用户可见操作不变。
2. 把“上传素材”和“生成结果”都改为优先落到 MEIAO 自己的云服务器。
3. 对模块层保持兼容：模块仍读写 `uploadedProductUrls`、`sourceUrl`、`resultUrl` 等原字段。
4. 用户刷新页面后，工作台能恢复之前的原图、参考图、结果图。
5. 用户隔离、路径隔离、元数据隔离全部由服务端保证。
6. 资源默认 3 天自动清理，避免云服务器磁盘无限增长。

## 非目标

- 不改业务 prompt
- 不改 provider 任务创建、轮询、成功失败判定
- 不把二进制图片直接存入 MySQL
- 不引入对象存储作为首期依赖
- 不重做现有任务队列模型

## 方案概览

### 1. 资源文件落地

所有上传素材和生成结果统一落到服务端本地目录，例如：

- `server/data/assets/users/{userId}/source/...`
- `server/data/assets/users/{userId}/result/...`
- `server/data/assets/users/{userId}/temp/...`

对外访问通过内部静态资源路由暴露，例如：

- `/api/assets/file/:assetId`

或等价的受控静态资源 URL。首期推荐使用受控下载路由，而不是直接把磁盘目录裸露成公开目录，这样更方便做权限校验和后续清理。

### 2. 资源元数据表

新增 `stored_assets` 表，至少包含：

- `id`
- `user_id`
- `module`
- `asset_type`：`source` / `result` / `reference` / `video`
- `storage_key`
- `original_name`
- `mime_type`
- `file_size`
- `width`
- `height`
- `provider`
- `provider_source_url`
- `job_id`
- `public_url`
- `created_at`
- `updated_at`
- `last_accessed_at`
- `expires_at`
- `deleted_at`

数据库只存元数据，不存二进制本体。

### 3. 上传链路

前端保持现有内部上传入口，但服务端行为改为：

1. 接收浏览器文件流
2. 写入本地持久化目录
3. 创建 `stored_assets` 元数据记录
4. 返回内部稳定 URL

这样模块后续使用的 `uploadedProductUrls` 等字段仍是 URL，只是来源从第三方临时地址换成应用自己的稳定地址。

### 4. 生成结果回写链路

provider 生成成功后：

1. 服务端拿到第三方结果 URL
2. 服务端把结果抓取到本地持久化目录
3. 创建 `stored_assets` 结果记录
4. 将前端可见的 `resultUrl` 回写为内部稳定 URL
5. 保留 `providerTaskId` 与必要的第三方原始 URL 作为排障字段

这样用户下载、刷新恢复、重试查看都依赖内部 URL，而不是第三方临时 URL。

### 5. 前端兼容策略

不要求模块改数据结构。前端继续使用现有字段：

- `uploadedProductUrls`
- `uploadedReferenceUrl`
- `sourceUrl`
- `resultUrl`
- `lastStyleUrl`
- `whiteBgImageUrl`

仅要求这些字段逐步收敛为内部资源 URL。

旧记录兼容策略：

- 如果读到历史第三方 URL，仍允许展示与找回
- 新上传和新结果一律写内部稳定 URL
- 页面刷新恢复时，优先恢复内部稳定 URL

### 6. 自动清理

资源默认保留 3 天：

- `expires_at = created_at + 3d`

服务端增加定时清理循环：

1. 查找过期且未删除的资源
2. 如果资源仍被有效工作台状态或运行中任务引用，则延后清理
3. 删除磁盘文件
4. 逻辑删除或物理删除数据库记录
5. 清理 `app_state` 中对失效资源的引用

同时在以下动作更新 `last_accessed_at`：

- 获取用户状态
- 访问资源文件
- 任务恢复/结果查看

## 全模块接入范围

本期直接覆盖全模块：

- 出海翻译
- 一键主图
- 一键详情
- 产品精修
- 买家秀
- 视频

覆盖内容统一为：

- 上传素材改走内部持久化资源层
- 生成结果回写为内部稳定 URL
- 刷新后工作台继续恢复
- 3 天后自动清理

## 安全与隔离

- 文件路径按 `user_id` 隔离
- 资源访问接口统一鉴权
- 用户只能访问自己的资源
- 管理员只在必要排障页查看元数据，不直接暴露真实磁盘路径

## 日志与排障

资源相关日志新增：

- `asset_upload_started`
- `asset_upload_finished`
- `asset_persisted`
- `asset_fetch_result_started`
- `asset_fetch_result_finished`
- `asset_cleanup_deleted`
- `asset_cleanup_skipped`

下载的日志文件里应能看到：

- 内部资源 ID
- 对应 jobId
- providerTaskId
- 原始第三方 URL
- 内部稳定 URL
- 上传耗时 / 抓取耗时

## 测试要求

1. 任意模块上传素材后刷新页面，素材仍可恢复。
2. 任意模块生成结果后刷新页面，结果仍可查看与下载。
3. 原始图片不再依赖浏览器 `File` 存活。
4. 新任务不再把第三方临时 URL 当作长期资源来源。
5. 过期 3 天的资源能自动清理。
6. 未过期或仍被有效任务引用的资源不会误删。
7. 不同用户的资源路径和访问权限隔离生效。

## 风险与约束

- 首期仍使用单机本地目录，磁盘容量需要监控。
- 视频文件可能较大，需要对磁盘与清理节奏单独关注。
- 某些老数据仍是第三方 URL，短期内会出现“新旧并存”，需要兼容读取。
- 结果回写如果完全改成内部 URL，必须确保下载抓取失败时仍有明确回退错误，不得误报成功。
