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
- 云上备案域名：`http://meiaoyuntai.com` 和 `http://www.meiaoyuntai.com`
- 备案网站名称：`杭州梅奥`
- ICP 备案号：`浙ICP备2026015528号-1`，只在首页底部展示并链接到 `https://beian.miit.gov.cn/`

## 工作原则

- 优先做最小正确方案，避免临时补丁式堆叠。
- 改功能时同步考虑日志、测试、用户隔离、版本管理和管理员排查信息。
- 不要默认 GitHub 就是线上真实版本。判断顺序是本地工作目录、当前 Git 状态、腾讯云服务器目录、GitHub 备份。
- 本项目主要应用在腾讯云线上环境；本地主要用于开发、测试、排障和备份。涉及线上行为时，先明确改动目标是“本地验证”还是“云上发布”，不要把本地通过误判为线上已生效。
- 云上发布是硬门禁：任何对腾讯云的代码/前端/服务端同步前，必须先做代码审查，检查本次 diff、数据隔离、公网资源 URL、日志/统计保留、权限边界和核心任务链路。未完成审查不得运行部署；部署脚本要求显式设置 `MEIAO_CODE_REVIEW_CONFIRMED=1`。
- GitHub 主要用于版本存储和备份，不作为默认 issue tracker 或线上真实状态来源。任务拆解、排障记录和阶段 PRD 优先写入本地 Markdown。
- 工作树可能有大量未提交改动。不要还原、覆盖或清理用户已有改动，除非用户明确要求。
- UI 和交互优先服务用户任务。不要为了技术结构牺牲可用性。
- 所有 prompt 新增或重写必须遵守 `docs/prompt-rtcfe-migration-map.md` 中的 RTCFE 结构：R Role、T Task、C Constraint、F Format、E Example。改 prompt 时必须保留既有输出字段、解析锚点和历史约束，并同步补防回归测试。
- 修复重复出现的问题时，必须先查 `docs/agents/repeated-issues.md`、相关测试和最近交接文档；修完后如果形成可复用经验，追加到 `docs/agents/repeated-issues.md`，避免同一类错误反复靠记忆重修。

## Agent skills

### Issue tracker

本项目使用本地 Markdown 记录任务、PRD、排障和拆票，GitHub 只作为版本存储/备份。见 `docs/agents/issue-tracker.md`。

### Triage labels

本地 Markdown issue 使用默认五状态标签：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。见 `docs/agents/triage-labels.md`。

### Domain docs

本项目是单上下文项目：先读根目录 `CONTEXT.md`，再按需读 `docs/adr/` 和 `docs/agents/repeated-issues.md`。见 `docs/agents/domain.md`。

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
node --test src/modules/OneClick/oneClickBehavior.test.mjs
node --test src/modules/XhsCover/xhsCoverUtils.test.mjs
```

## 代码地图

- `src/main.tsx`、`src/ShellMigratedApp.tsx`：前端入口、模块路由和新壳顶层状态接线。
- `src/shell/components/layout/SidebarNavigation.tsx`：侧边栏模块导航、系统入口和折叠状态。
- `src/types.ts`：跨模块状态、任务、模型、账号和日志类型。
- `server/index.mjs`：内部 API、账号、日志、状态、素材、任务和静态资源托管。
- `server/jobRuntime.mjs`、`server/jobManager.mjs`：任务运行时和队列。
- `server/providerGateway.mjs`：KIE、Veo、Responses、GPT Image 等 provider 收口。
- `src/services/internalApi.ts`：前端访问内部 API 的统一客户端。
- `src/services/loggingService.ts`：业务日志标签和字段映射。
- `src/shell/modules/Account/AccountManagement.tsx`：新壳账号管理、运行日志和统计。

## 发布与部署

- 本地发布脚本：`./scripts/deploy_tencent.sh`
- 云上发布必须先完成代码审查，再使用：`MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh`
- 腾讯云项目目录：`/www/wwwroot/meiao-internal`
- PM2 进程名：`meiao-internal`
- Node 服务端口：`3100`
- 详细步骤见 `docs/tencent-cloud-deploy.md`。

## 文档维护

- 新增 API：同步更新 `docs/project-overview.md` 的 API 速查和相关 runbook。
- 新增环境变量：同步更新 `.env.server.example`、`docs/tencent-cloud-deploy.md` 和 `docs/project-overview.md`。
- 新增大模块或改模块入口：同步更新 `README.md`、`项目交接上下文.md` 和 `docs/project-overview.md`。
- 完成重要阶段后，更新 `docs/release-and-handoff.md` 或相关交接文档。
