<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# 梅奥 AI 本地开发说明

当前项目本地默认开发入口是 `http://localhost:3000`。

## 项目定位

梅奥 AI 是面向公司内部多人使用的电商视觉工具，不是公网 SaaS。当前代码采用 React + Vite 前端、Node.js 内部 API 服务，第三方模型调用、素材上传、任务队列、账号、日志和系统配置都通过 `server/index.mjs` 收口。

当前主要模块：
- 智能体中心
- 一键主详：首图、主图、详情、SKU
- 出海翻译
- 买家秀
- 产品精修
- 短视频生成
- 小红书封面
- 系统设置
- 账号管理与运行日志

## 本地启动

前置条件：已安装 Node.js，并已在项目目录执行过 `npm install`。

推荐直接使用一键本地启动：

```bash
npm run local
```

启动成功后：
- 开发页：`http://localhost:3000`
- 后端健康检查：`http://127.0.0.1:3100/api/health`

## 本地健康检查

如果你怀疑“网页打不开”或“接口没联通”，先执行：

```bash
npm run doctor
```

这个命令会检查：
- `3000` 是否有 Vite 开发页在监听
- `3100` 是否有本地后端在监听
- `3000/api/health` 是否能代理到 `3100`

## 手动启动方式

如果你需要手动分开启动，也可以这样做：

```bash
npm run server
```

另开一个终端再执行：

```bash
npm run dev
```

说明：
- `3000` 是默认开发页，浏览器应优先打开这个地址
- `3100` 是本地后端接口和一体服务端口，不作为默认开发页入口
- 如果只启动了 `3100` 没启动 `3000`，浏览器打开 `localhost:3000` 会出现 `ERR_CONNECTION_REFUSED`

## 常见排查

1. 浏览器打不开 `localhost:3000`
   先运行 `npm run doctor`，通常是前端开发服务器没启动。
2. `3000` 已经启动，但页面数据异常
   检查 `http://127.0.0.1:3100/api/health` 是否正常。
3. 启动时报端口占用
   先释放被占用的 `3000` 或 `3100`，再重新运行 `npm run local`。

## 常用验证

```bash
npm run acceptance
npm run lint
npm run build
```

针对服务端任务队列、素材和 provider 网关的重点回归，可以按需执行：

```bash
node --test server/jobRuntime.test.mjs
node --test server/providerGateway.test.mjs
node --test server/assetStore.test.mjs
```

## 关键文档

- `AGENTS.md`：AI 接手本项目时必须先读的项目约定。
- `项目交接上下文.md`：长期协作偏好、产品定位、日志和版本规则。
- `docs/project-overview.md`：当前架构、模块、API、环境变量和验证入口速查。
- `docs/release-and-handoff.md`：发布、GitHub 备份和腾讯云接手说明。
- `docs/tencent-cloud-deploy.md`：腾讯云内部版部署 runbook。
