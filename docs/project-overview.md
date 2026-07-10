# 项目概览与接手速查

更新日期：2026-04-29

## 1. 项目定位

梅奥 AI 是公司内部多人使用的电商视觉工具。当前版本以本地开发和腾讯云内部部署为主，不按公网 SaaS 方式运维。

技术结构：
- 前端：React 19 + Vite 6 + TypeScript。
- 后端：Node.js 原生 HTTP 服务，入口为 `server/index.mjs`。
- 数据：本地模式使用 JSON 存储；内部版可连接 MySQL。
- 模型与素材：前端不直连第三方模型，统一走内部 API、任务队列和 provider gateway。

## 2. 当前模块

- 智能体中心：内部专家、知识库、会话、工作室测试和用量统计。
- 一键主详：首图、主图、详情页、SKU 子模块。
- 出海翻译：主图翻译、详情翻译、去文字。
- 买家秀：策划生成、图片生成、历史素材恢复。
- 产品精修：分析、生成、恢复、重试和中断。
- 短视频生成：长视频、Veo、分镜、视频诊断。
- 小红书封面：18 种风格封面生成。
- 系统设置：系统状态、队列和配置可见性。
- 账号管理：内部账号、运行日志、统计和日志导出。

`AppModule.PHOTOGRAPHY` 目前是预留入口，侧边栏会显示为即将开放，`src/ShellMigratedApp.tsx` 尚未接入对应业务页面。

## 3. 本地运行

推荐：

```bash
npm run local
```

常用入口：
- 前端开发页：`http://localhost:3000`
- 后端健康检查：`http://127.0.0.1:3100/api/health`
- 本地诊断：`npm run doctor`

手动分开启动：

```bash
npm run server
npm run dev
```

智能体多工具：
- 第4期 V2 对话复用 `OPENAI_COMPATIBLE_*` 中转站配置，responses 端点默认 `OPENAI_COMPATIBLE_RESPONSES_PATH=/v1/responses`。
- `AGENT_TOOL_MAX_ROUNDS` 控制单轮对话工具循环上限，默认 5，防止模型反复调用 `search_knowledge` / `generate_image`。
- `AGENT_IMAGE_PLAN_REPAIR_MAX_ROUNDS` 控制多图独立输出规划欠覆盖时的修复审查轮数，默认 2；仍不完整则快速失败，避免只执行一张却显示完成。

## 4. 关键 API 速查

账号与用户：
- `POST /api/auth/login`
- `GET /api/auth/me`
- `PATCH /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/users`
- `POST /api/users`

智能体与知识库：
- `GET /api/agents`
- `POST /api/agents`
- `GET /api/knowledge-bases`
- `POST /api/knowledge-bases`
- `GET /api/chat/agents`
- `GET /api/chat/sessions`
- `POST /api/chat/sessions`
- `POST /api/studio/test/sessions`
- `GET /api/agent-usage`
- `GET /api/agent-usage/summary`

日志与统计：
- `GET /api/logs`
- `GET /api/logs/meta`
- `POST /api/logs`
- `DELETE /api/logs`
- `GET /api/stats/usage`
- `POST /api/stats/backfill`

状态、系统配置与素材：
- `GET /api/state`
- `PUT /api/state`
- `GET /api/system/config`
- `PATCH /api/system/config`
- `POST /api/assets/upload`
- `POST /api/assets/upload-stream`
- `DELETE /api/assets/by-url`

任务队列与诊断：
- `POST /api/jobs`
- `GET /api/jobs`
- `POST /api/jobs/recover`
- `POST /api/video-diagnosis/probe`
- `POST /api/video-diagnosis/analyze`
- `GET /api/health`

## 5. 环境变量

核心服务：
- `NODE_ENV`
- `PORT`
- `MEIAO_ALLOWED_ORIGINS`
- `MEIAO_PUBLIC_BASE_URL`
- `MEIAO_JOB_MAX_CONCURRENCY`
- `MEIAO_PROVIDERLESS_RUNNING_STALE_MS`：默认代码兜底为 15 分钟；云上建议 `300000`，用于释放已 `running` 但尚未拿到上游 `providerTaskId` 的异常提交阶段任务，防止占满同账号并发。
- `MEIAO_SUBMITTED_RUNNING_STALE_MS`：默认 `21600000`（6 小时）；用于恢复已拿到上游 `providerTaskId` 但本地长时间未回写终态的 `running` 任务。到期后任务回到 `retry_waiting` 复查上游结果，并且不再继续占账号并发。
- `MEIAO_STALE_RUNNING_RECONCILE_INTERVAL_MS`：默认 `60000`；云上建议 `30000`，控制 stale running 任务回收检查间隔。
- `MEIAO_KIE_ASSET_UPLOAD_TIMEOUT_MS`：云上建议 `120000`；KIE 素材上传单次 HTTP 超时。分镜参考视频等较大素材需要更长上传预算；瞬时网络或上游 5xx 错误允许有限重试后释放并发。
- `MEIAO_KIE_MANAGED_ASSET_MODE`：默认 `auto`；仅当 `MEIAO_PUBLIC_BASE_URL` 是公网 HTTPS 时，我方 `/api/assets/file/` 托管素材直连优先。上游在无 `providerTaskId` 时明确读图失败，才转存 KIE 并重试同一模型。设为 `kie-only` 可无代码回滚到全部强制转存。
- `MEIAO_KIE_ASSET_UPLOAD_CONCURRENCY`：默认 `3`；真正进入 KIE file-stream-upload 时的进程级跨任务并发总上限，补足单任务素材解析限流无法约束多任务同时上传的问题。
- `MEIAO_KIE_ASSET_UPLOAD_RETRIES` / `MEIAO_KIE_ASSET_UPLOAD_RETRY_BASE_MS`：默认 `2` / `1000`；只用于文件上传 POST 的连接错误与 `429/500/502/503/504` 响应重试，不放宽 createTask/chat 等可能扣费的提交 POST。
- `MEIAO_KIE_ASSET_UPLOAD_CACHE_TTL_MS` / `MEIAO_KIE_ASSET_UPLOAD_CACHE_MAX_ENTRIES`：默认 `1800000` / `2000`；成功转存 URL 的进程内缓存与容量上限，并发上传同一素材会共享一个 Promise，失败不缓存。
- `MEIAO_KIE_HTTP_TRANSIENT_RETRIES`：默认 `2`；KIE HTTP 请求级瞬时重试次数（S2 G1）。`fetch failed`/`ECONNRESET` 等连接层错误（未收到任何 HTTP 响应）对所有请求重试；`502/503/504` 响应默认只对只读 GET（recordInfo 查询、素材/结果下载）重试，createTask/chat 等可能扣费的 POST 收到响应不重试。文件上传 POST 使用独立上传预算。
- `MEIAO_KIE_HTTP_RETRY_BASE_MS`：默认 `1000`；请求级重试指数退避基数（毫秒），第 n 次重试等待 `base*(2^n-1)`，默认即 1s、3s。
- `MEIAO_KIE_IMAGE_MEDIA_RESOLUTION_CONCURRENCY`：默认 `2`；单个 `kie_image` 任务提交 KIE 前解析/转存素材的并发。详情页批量生图建议保持保守默认，避免“任务数 × 素材数”打满 KIE 图床。
- `MEIAO_KIE_VIDEO_MEDIA_RESOLUTION_CONCURRENCY`：默认 `2`；单个 `kie_seedance_video` 任务提交 KIE 前解析/转存图片、视频、音频素材的总并发。分镜视频多素材建议保持保守默认，避免多张大图同时转存导致 `asset_upload fetch failed`。
- `MEIAO_CHAT_SSE_HEARTBEAT_MS`：默认 `15000`；智能体聊天 SSE 心跳间隔，避免长耗时多图生图期间代理或浏览器因连接空闲断流。
- `AGENT_IMAGE_GENERATE_TRANSIENT_MAX_RETRIES`：默认 `1`；智能体单次 `generate_image` 提交/读取遇到 `fetch failed`、502、超时等瞬时上游错误时的内部快速重试次数，避免把瞬时失败总结成“部分完成”。
- `AGENT_IMAGE_TOOL_CONCURRENCY`：默认 `2`，代码上限 `5`；智能体同一轮返回多条独立 `generate_image` 工具调用时受控并发执行。只在本轮全是生图工具时启用，混合检索/生图仍串行，避免状态交叉。
- `AGENT_MODEL_TRANSIENT_MAX_RETRIES`：默认 `1`；智能体规划/总结模型请求在尚未输出内容前遇到 `fetch failed`、超时等瞬时网络错误时的内部快速重试次数；已开始流式输出的请求不自动重试，避免重复文本。
- `MEIAO_ASSET_X_ACCEL`：默认 `0`；生产 Nginx 配好 `/__meiao_stored_assets/` internal alias 后可设为 `1`，让托管素材通过 `X-Accel-Redirect` 直出。
- `VITE_MEIAO_VIDEO_PLAYBACK_MIN_BUFFER_SECONDS`：默认 `3`；项目卡片视频点击播放前等待的最小预缓冲秒数。
- `VITE_MEIAO_VIDEO_PLAYBACK_BUFFER_TIMEOUT_MS`：默认 `5000`；项目卡片视频预缓冲最长等待毫秒数，超时后继续播放。

数据库：
- `MEIAO_DB_HOST`
- `MEIAO_DB_PORT`
- `MEIAO_DB_USER`
- `MEIAO_DB_PASSWORD`
- `MEIAO_DB_NAME`

管理员：
- `MEIAO_ADMIN_USERNAME`
- `MEIAO_ADMIN_PASSWORD`
- `MEIAO_SUPER_ADMIN_USERS`

模型与网关：
- `KIE_API_KEY` 或 `MEIAO_KIE_API_KEY`
- `APIPORTS_API_KEY` 或 `MEIAO_APIPORTS_API_KEY`
- `APIPORTS_BASE_URL` 或 `MEIAO_APIPORTS_BASE_URL`，默认使用奇点图像生成入口 `https://apiports.com/v1/api/generate`
- `ARK_API_KEY`
- `KIE_CHAT_MODEL`
- `MEIAO_DEFAULT_CHAT_MODEL`
- `MEIAO_DEFAULT_ANALYSIS_MODEL`
- `MEIAO_PLANNING_ANALYSIS_MODEL`
- `MEIAO_AGENT_ANALYSIS_MODEL`
- `MEIAO_SPIDER_GATEWAY_URL` 或 `SPIDER_GATEWAY_URL`
- `MEIAO_SPIDER_API_KEY` 或 `SPIDER_API_KEY`

环境模板维护在 `.env.server.example`，腾讯云部署说明维护在 `docs/tencent-cloud-deploy.md`。

## 6. 验证入口

基础验证：

```bash
npm run acceptance
npm run lint
npm run build
```

重点回归：

```bash
node --test server/jobRuntime.test.mjs
node --test server/providerGateway.test.mjs
node --test server/assetStore.test.mjs
node --test src/services/kieAiService.test.mjs
node --test src/services/arkService.test.mjs
node --test src/modules/Account/accountManagementUtils.test.mjs
node --test src/modules/OneClick/oneClickBehavior.test.mjs
node --test src/modules/XhsCover/xhsCoverUtils.test.mjs
```

正式发布前还需要人工验证浏览器 Network：
- 前端不出现第三方模型域名直连。
- 请求头不暴露第三方 Bearer Key。
- 任务刷新后能恢复状态和结果。
- 管理员日志能看到内部任务 ID、外部任务 ID、provider、重试次数和错误摘要。

## 7. 发布事实

- GitHub 仓库：`https://github.com/gearaldblynn-lang/Meiao.git`
- 默认分支：`main`
- 腾讯云目录：`/www/wwwroot/meiao-internal`
- PM2 进程：`meiao-internal`
- 发布脚本：`./scripts/deploy_tencent.sh`

GitHub 主要是备份和历史留档，不会自动更新线上服务。线上事实以腾讯云服务器目录和 PM2 进程为准。
