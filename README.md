<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# 梅奥 AI 本地开发说明

当前项目本地默认开发入口是 `http://localhost:3000`。

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
