# 发布与接手说明

## 1. 项目真实位置
- 当前主工作目录：
  `/Users/feiyanglin/程序开发/电商视觉一键化/版本管理/梅奥MEIAO-当前版本`

## 2. 标准版本流程
- 这个项目当前不是 GitHub 自动部署。
- 当前标准流程是：
  1. 本地修改并验证。
  2. 发布时只保留两个本地目录：`梅奥MEIAO-当前版本` 和 `梅奥MEIAO-备份版本-版本号`。
  3. 用当前工作目录生成或覆盖当次发布对应的备份目录，不额外堆历史版本文件夹。
  4. 在当前工作目录对应仓库里提交 Git。
  5. 推送到 GitHub 作为备份。
  6. 再手动部署到腾讯云用于内部使用。

## 3. GitHub 信息
- Git 远端仓库：
  `https://github.com/gearaldblynn-lang/Meiao.git`
- 默认分支：
  `main`
- 说明：
  - GitHub 当前主要用途是代码备份和历史留档。
  - 推送到 GitHub 不会自动更新线上服务。

## 4. 腾讯云发布信息
- 服务器地址：
  `111.229.66.247`
- 服务器项目目录：
  `/www/wwwroot/meiao-internal`
- 服务端环境变量文件：
  `/www/wwwroot/meiao-internal/.env.server`
- PM2 进程名：
  `meiao-internal`
- Node 服务端口：
  `3100`

## 5. 发布命令
- 本地发布脚本：
  `./scripts/deploy_tencent.sh`
- 如需显式指定密钥或服务器：
  `MEIAO_SSH_KEY=~/.ssh/MEIAO.pem MEIAO_SERVER_HOST=111.229.66.247 ./scripts/deploy_tencent.sh`
- 说明：
  - 该脚本会把本地代码同步到腾讯云目录。
  - 服务器上会执行 `npm install`、`npm run security:audit`、`npm run build`。
  - 若依赖树仍有 high/critical 级别漏洞，发布会在构建和 PM2 重启前停止。
  - 然后用 PM2 重启 `meiao-internal`。

## 6. 发布后验证
- 健康检查：
  - `http://111.229.66.247/api/health`
  - `http://111.229.66.247:3100/api/health`
- 如果要确认系统配置接口是否正常：
  - 先登录后再访问 `/api/system/config`
- 若健康检查返回 `{"ok":true,"mode":"internal-mysql-v1"}`，说明服务基本在线。

## 7. 当前接手判断规则
- 不要默认以 GitHub 为线上真实版本。
- 当前应优先按下面顺序判断版本事实：
  1. 本地当前工作目录
  2. 当前 Git 提交与未提交改动
  3. 腾讯云服务器目录实际代码
  4. GitHub 远端备份是否已追平
- 如果发现“云端比 GitHub 新”，优先补齐 GitHub 备份，而不是假设线上出了问题。

## 8. 新会话接手时必读文件
- `AGENTS.md`
- `项目交接上下文.md`
- `docs/project-overview.md`
- `docs/tencent-cloud-deploy.md`
- `docs/cloud-update-data-cleanup.md`
- `docs/release-and-handoff.md`
- `src/services/loggingService.ts`
- `src/modules/Account/AccountManagement.tsx`

## 8.1 接手时必须先继承的交互原则
- 所有新需求、改版、Bug 修复、管理后台、CLI、对话式交互、系统反馈，都先遵守 `项目交接上下文.md` 里的“全项目交互设计原则”。
- 如果技术实现、代码结构、开发习惯与用户体验冲突，优先保证用户体验。

## 9. 已知事实
- 当前项目面向公司内部多人使用，不是公网 SaaS。
- 已存在内部账号、用户隔离、日志系统。
- 当前部署模式是“手动确认后发布”，不是持续自动交付。
- 3001 壳前端同步到云上前，必须按 `docs/cloud-update-data-cleanup.md` 巡检并清理历史垃圾卡，尤其是默认 `idle` 视频诊断被误显示为项目卡、测试账号残留项目、切账号后的前端内存态残留。

## 10. 维护要求
- 只记录长期有效的项目事实。
- 如果发布流程、GitHub 仓库、服务器地址、PM2 名称有变化，要直接更新本文件。
- 如果某次版本已经推 GitHub 但还没上云，或已经上云但还没推 GitHub，建议在提交说明或交接说明里明确写出。

## 11. 当前发布状态
- 当前待发布版本：
  `V260516-frontend-shell-upgrade`
- 当前本地版本目录：
  - `梅奥MEIAO-当前版本`
  - `梅奥MEIAO-前端壳迁移版`
  - `梅奥MEIAO-备份版本-前端升级前-20260516`
- 本次发布重点：
  - `梅奥MEIAO-当前版本` 已由原全栈当前版本复制而来，并同步 `梅奥MEIAO-前端壳迁移版` 的 3001 前端壳代码。
  - `server/`、`scripts/deploy_tencent.sh`、`.env.server`、腾讯云部署文档和数据清理记录继续保留在当前版本内。
  - `梅奥MEIAO-备份版本-前端升级前-20260516` 是本次前端升级前的完整回滚点。
  - `梅奥MEIAO-前端壳迁移版` 继续保留，作为 3001 前端壳源备份。
  - 旧 `梅奥MEIAO-备份版本-260430A` 已清理，不再作为有效备份。
- 状态说明：
  - 本地验证已完成：`npm run build`、`npm run lint`、`node --test src/utils/appState.test.mjs src/modules/Video/videoDiagnosisUtils.test.mjs src/components/uiArchitecture.test.mjs` 均通过。
  - 本地新依赖树已执行 `npm audit fix`，`npm audit --json` 返回 0 个漏洞。
  - 云上现行 `260430A` 版本只读执行 `npm audit --json` 返回 0 个漏洞；云上仍是旧 3000 构建，尚未同步本次 3001 前端壳升级。
  - 本地当前版本服务已重新启动：前端 `http://127.0.0.1:3000/`，后端 `http://127.0.0.1:3100/api/health` 返回 `{"ok":true,"mode":"internal-v1"}`。
  - 腾讯云尚未执行本次前端升级发布；发布前必须先按 `docs/cloud-update-data-cleanup.md` 做数据巡检和垃圾卡清理。

## 12. 2026-06-08 首图策划失败可见性热修

- 触发问题：云上账号“天琪”的一键主详首图项目“6月8日项目3”提交 5 个参考图策划后，5 个 `kie_chat` 策划任务均以 `provider_submit_stale` 失败，但界面最终只显示 2 张失败策划卡，且失败文案可能继续作为正常方案提交出图。
- 修复范围：
  - `src/adapters/shellDataAdapter.ts`：按每个失败参考图生成 `planningFailed` 失败方案卡，保留 `shellReferenceIndex`，真实失败替换旧占位，不重复抬高 `taskCount`。
  - `src/ShellMigratedApp.tsx`：出图入口拦截失败策划卡，全失败时提示重新策划，混选时跳过失败项。
  - `src/adapters/shellDataAdapter.test.mjs`、`src/components/uiArchitecture.test.mjs`：增加 5 个首图策划全部失败和失败文案不得进入出图链路的回归覆盖。
- 本地验证：
  - `node --test src/adapters/shellDataAdapter.test.mjs`
  - `node --test src/components/uiArchitecture.test.mjs --test-name-pattern "one click generation refuses to turn planning error text"`
  - `npm run build`
- 云上发布：已通过 `MEIAO_CODE_REVIEW_CONFIRMED=1 ./scripts/deploy_tencent.sh` 发布到腾讯云 `/www/wwwroot/meiao-internal`，服务器端 `npm audit --audit-level=high`、`npm run build` 通过，PM2 `meiao-internal` 已重启并保存。
- 后续观察：诊断看板继续观察同类 `provider_submit_stale` / provider task id 缺失场景；这类上游提交超时仍可能发生，但前端必须完整显示失败数量并阻止错误文案进入出图。
