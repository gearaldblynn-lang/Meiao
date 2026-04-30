# AGENTS.md

本文件给 Codex 或其他 AI 接手本项目时使用。先读本文件，再读 `项目交接上下文.md`、`docs/project-overview.md`、`docs/release-and-handoff.md`。

## 项目事实

- 当前项目根目录：`/Users/feiyanglin/程序开发/电商视觉一键化/版本管理/梅奥MEIAO-当前版本`
- 本地默认开发页：`http://localhost:3000`
- 本地后端健康检查：`http://127.0.0.1:3100/api/health`
- 推荐本地启动命令：`npm run local`
- 推荐本地排查命令：`npm run doctor`
- Git 远端：`https://github.com/gearaldblynn-lang/Meiao.git`
- 默认分支：`main`

## 工作原则

- 优先做最小正确方案，避免临时补丁式堆叠。
- 改功能时同步考虑日志、测试、用户隔离、版本管理和管理员排查信息。
- 不要默认 GitHub 就是线上真实版本。判断顺序是本地工作目录、当前 Git 状态、腾讯云服务器目录、GitHub 备份。
- 工作树可能有大量未提交改动。不要还原、覆盖或清理用户已有改动，除非用户明确要求。
- UI 和交互优先服务用户任务。不要为了技术结构牺牲可用性。
- 所有 prompt 新增或重写必须遵守 `docs/prompt-rtcfe-migration-map.md` 中的 RTCFE 结构：R Role、T Task、C Constraint、F Format、E Example。改 prompt 时必须保留既有输出字段、解析锚点和历史约束，并同步补防回归测试。

## 常用命令

```bash
npm run local
npm run doctor
npm run acceptance
npm run lint
npm run build
```

重点回归：

```bash
node --test server/jobRuntime.test.mjs
node --test server/providerGateway.test.mjs
node --test server/assetStore.test.mjs
node --test modules/OneClick/oneClickBehavior.test.mjs
node --test modules/XhsCover/xhsCoverBehavior.test.mjs
```

## 代码地图

- `App.tsx`：模块路由与顶层状态接线。
- `components/layout/moduleMeta.ts`：侧边栏模块名称、图标、色彩和文案。
- `types.ts`：跨模块状态、任务、模型、账号和日志类型。
- `server/index.mjs`：内部 API、账号、日志、状态、素材、任务和静态资源托管。
- `server/jobRuntime.mjs`、`server/jobManager.mjs`：任务运行时和队列。
- `server/providerGateway.mjs`：KIE、Veo、Responses、GPT Image 等 provider 收口。
- `services/internalApi.ts`：前端访问内部 API 的统一客户端。
- `services/loggingService.ts`：业务日志标签和字段映射。
- `modules/Account/AccountManagement.tsx`：账号管理、运行日志和统计。

## 发布与部署

- 本地发布脚本：`./scripts/deploy_tencent.sh`
- 腾讯云项目目录：`/www/wwwroot/meiao-internal`
- PM2 进程名：`meiao-internal`
- Node 服务端口：`3100`
- 详细步骤见 `docs/tencent-cloud-deploy.md`。

## 文档维护

- 新增 API：同步更新 `docs/project-overview.md` 的 API 速查和相关 runbook。
- 新增环境变量：同步更新 `.env.server.example`、`docs/tencent-cloud-deploy.md` 和 `docs/project-overview.md`。
- 新增大模块或改模块入口：同步更新 `README.md`、`项目交接上下文.md` 和 `docs/project-overview.md`。
- 完成重要阶段后，更新 `docs/release-and-handoff.md` 或相关交接文档。
