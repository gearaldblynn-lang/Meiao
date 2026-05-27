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
