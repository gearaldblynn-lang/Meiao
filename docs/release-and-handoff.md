# 发布与接手说明

## 1. 项目真实位置
- 当前主工作目录：
  `/Users/feiyanglin/程序开发/电商视觉一键化/版本管理/梅奥MEIAO——260324a`

## 2. 标准版本流程
- 这个项目当前不是 GitHub 自动部署。
- 当前标准流程是：
  1. 本地修改并验证。
  2. 按版本规则保留一个本地版本目录。
  3. 在该版本目录对应仓库里提交 Git。
  4. 推送到 GitHub 作为备份。
  5. 再手动部署到腾讯云用于内部使用。

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
  - 服务器上会执行 `npm install`、`npm run build`。
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
- `项目交接上下文.md`
- `docs/tencent-cloud-deploy.md`
- `docs/release-and-handoff.md`
- `services/loggingService.ts`
- `modules/Account/AccountManagement.tsx`

## 8.1 接手时必须先继承的交互原则
- 所有新需求、改版、Bug 修复、管理后台、CLI、对话式交互、系统反馈，都先遵守 `项目交接上下文.md` 里的“全项目交互设计原则”。
- 如果技术实现、代码结构、开发习惯与用户体验冲突，优先保证用户体验。

## 9. 已知事实
- 当前项目面向公司内部多人使用，不是公网 SaaS。
- 已存在内部账号、用户隔离、日志系统。
- 当前部署模式是“手动确认后发布”，不是持续自动交付。

## 10. 维护要求
- 只记录长期有效的项目事实。
- 如果发布流程、GitHub 仓库、服务器地址、PM2 名称有变化，要直接更新本文件。
- 如果某次版本已经推 GitHub 但还没上云，或已经上云但还没推 GitHub，建议在提交说明或交接说明里明确写出。
