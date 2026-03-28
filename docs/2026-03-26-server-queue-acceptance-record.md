# 2026-03-26 服务端收口与任务队列真实验收记录

## 结论摘要

本轮基于 2026-03-26 当次实际命令执行结果，当前状态应标记为：

- **主体开发已完成**
- **自动化基础验证已通过**
- **服务端收口代码改造已完成**
- **真实端到端联调未完成**
- **暂不能标记为“完全验收通过”**

本轮已确认：

- 自动化测试、类型检查、构建均重新执行并通过
- 前端服务层已改为走内部接口，未再保留前端服务层直连第三方主链路
- 设置页已改为只读系统状态展示，不再显示真实密钥输入
- 管理页已接入内部任务 ID、外部任务 ID、provider、重试次数等排障字段

本轮未完成或发现异常：

- 当前实际运行中的后端健康返回模式仍为 `internal-v1`，不是正式验收目标所需的 `internal-mysql-v1`
- `npm run server` 二次启动时明确报 `EADDRINUSE: address already in use :::3100`，说明 3100 已有现成后端进程，但它当前是 **Local JSON mode**
- `npm run dev` 本轮实际启动到了 `http://127.0.0.1:3003/`，因为 `3000`、`3001`、`3002` 都已被占用
- 因此“默认开发页固定为 `http://localhost:3000`”这一项，本轮**不通过**
- `npm run doctor` 与 `lsof`/实际启动结果不一致，本轮只能记为“脚本存在误判，不可作为通过依据”
- 逐模块真实业务联调、本地浏览器 Network 安全检查、MySQL 下 `internal_jobs` 实表验证，本轮**未完成**

## 本轮实际执行记录

### 1. 基础环境

执行：

```bash
curl -s http://127.0.0.1:3100/api/health
```

结果：

- 返回 `{"ok":true,"mode":"internal-v1"}`
- 说明当前后端是 `Local JSON mode`，不是 `MySQL mode`
- 结论：**后端可运行，但不满足正式队列验收前提**

执行：

```bash
npm run doctor
```

结果摘要：

- 报告 `3000` 未就绪
- 报告 `3100` 未就绪
- 报告 `3000/api/health` 代理检查未就绪

说明：

- 同一轮里 `lsof` 已看到 `3000`、`3100` 被进程监听
- `npm run server` 再次启动时也明确因 `3100` 占用而失败
- 当前终端环境对本机端口连通性检查存在干扰，`doctor` 本轮出现误判
- 结论：**脚本已运行，但结果不能作为通过依据**

执行：

```bash
npm run dev
```

结果摘要：

- `Port 3000 is in use, trying another one...`
- `Port 3001 is in use, trying another one...`
- `Port 3002 is in use, trying another one...`
- 最终监听地址：`http://127.0.0.1:3003/`

补充检查：

```bash
lsof -nP -iTCP:3000 -sTCP:LISTEN
lsof -nP -iTCP:3001 -sTCP:LISTEN
lsof -nP -iTCP:3002 -sTCP:LISTEN
lsof -nP -iTCP:3003 -sTCP:LISTEN
```

结果摘要：

- `3000` 有监听进程
- `3001` 有监听进程
- `3002` 有监听进程
- 新启动的 Vite 监听在 `3003`

结论：

- “开发页能启动”这件事本身是**通过**
- “默认开发页固定为 `3000`”这件事本轮**不通过**

执行：

```bash
npm run server
```

结果摘要：

- 输出 `Meiao internal server listening on http://0.0.0.0:3100 (Local JSON mode)`
- 随后因 `EADDRINUSE: address already in use :::3100` 退出

结论：

- 当前 `3100` 的确已有服务占用
- 但当前运行模式不是本期正式验收要求的 `MySQL mode`
- 因此统一任务队列只能记为**未进入正式运行态验收**

### 2. 自动化验证

执行：

```bash
npm run acceptance
```

结果：

- 通过
- 结论：**通过**

执行：

```bash
npm run lint
```

结果：

- 通过
- 结论：**通过**

执行：

```bash
npm run build
```

结果摘要：

- 构建成功
- 输出 `dist/index.html` 和打包后的前端资源
- 存在 chunk 体积偏大的告警，但不影响本轮验收结论
- 结论：**通过**

执行：

```bash
node --check server/index.mjs
```

结果：

- 通过
- 结论：**通过**

执行：

```bash
node --test server/jobRuntime.test.mjs
```

结果：

- 6/6 通过
- 结论：**通过**

执行：

```bash
node --test scripts/local-dev-utils.test.mjs
```

结果：

- 3/3 通过
- 结论：**通过**

执行：

```bash
node --test scripts/acceptance-report.test.mjs
```

结果：

- 1/1 通过
- 结论：**通过**

### 3. 代码侧收口核对

执行：

```bash
rg -n 'api\.kie\.ai|ark\.cn-beijing\.volces\.com|runninghub\.cn|kieai\.redpandaai\.co|import\.meta\.env|VITE_[A-Z0-9_]*KEY' services modules utils vite.config.ts types.ts App.tsx index.tsx server
```

结果摘要：

- 第三方域名命中仅出现在 `server/providerGateway.mjs`
- 前端 `services/`、`modules/`、`utils/` 未发现第三方域名直连
- 未发现前端 `import.meta.env` 或 `VITE_*KEY` 形式的真实密钥注入

补充核对：

- `services/internalApi.ts` 已统一调用 `/api/*`
- `services/kieAiService.ts`、`services/arkService.ts`、`services/runningHubService.ts` 已改为内部任务提交 / 查询模式
- `modules/Settings/GlobalApiSettings.tsx` 已改为只读系统状态页
- `utils/appState.ts` 已将 `kieApiKey`、`arkApiKey`、`rhApiKey` 等持久化字段清空
- `modules/Account/AccountManagement.tsx` 已显示 `jobId`、`providerTaskId`、`provider`、`retryCount`
- `server/index.mjs` 已接入 `/api/jobs`、`/api/jobs/:id`、`/api/jobs/:id/cancel`、`/api/jobs/:id/retry`、`/api/jobs/recover`、`/api/system/config`、`/api/assets/upload`

结论：

- **代码结构层面的服务端收口已完成**
- **浏览器 Network 面板的真实流量安全验收仍待人工验证**

## 按验收项记录

### 基础环境验收

- `http://localhost:3000` 可以打开：**未通过**
  - 原因：本轮真实验证中，Vite 因端口占用改绑到 `3003`
- `http://127.0.0.1:3100/api/health` 返回正常：**部分通过**
  - 可返回健康数据，但当前模式为 `internal-v1`，不是正式队列验收所需的 `internal-mysql-v1`
- MySQL 模式下 `internal_jobs` 表创建并写入记录：**未验证**
- 设置页只显示只读系统状态：**代码已完成，待手工验证**
- 浏览器开发者工具里不再出现前端直连第三方请求：**代码已收口，待浏览器手工验证**
- 浏览器请求头里不再出现第三方 Bearer Key：**代码已收口，待浏览器手工验证**

### 通用任务队列验收

- 内部任务状态流转：**未做真实业务触发验证**
- 超过并发进入 `queued`：**未验证**
- 瞬时错误重试 / 鉴权错误直接失败：**仅单元逻辑验证通过，真实流程未验证**
- 刷新页面后恢复：**未验证**
- 找回功能走内部恢复接口：**代码已接入，真实流程未验证**
- 取消任务状态收敛：**未验证**
- 重试任务日志痕迹：**未验证**
- 当前服务运行模式是否支持完整任务队列：**不满足正式验收前提**
  - 原因：本轮健康返回为 `internal-v1`，且 `server/index.mjs` 明确规定本地模式不支持完整内部任务队列

### 逐模块业务验收

- 一键主图 / 一键详情：**未验证**
- 出海翻译：**未验证**
- 产品精修：**未验证**
- 买家秀：**未验证**
- 短视频：**未验证**
- 素材上传：**未验证**

### 管理与排障验收

- 管理员日志页筛选：**代码已存在，未手工验证**
- 日志显示内部任务 ID / 外部任务 ID / provider / 重试次数 / 错误摘要：**代码已接入，未手工验证**
- 员工账号不可见真实密钥：**代码已接入，未手工验证**
- 环境变量缺失时报明确错误：**未验证**
- 本地模式访问任务队列接口返回明确提示：**代码已接入，待接口实测**

## 当前最准确结论

到 2026-03-26 这一轮为止：

- **自动化与结构层面：通过**
- **服务端收口代码改造：通过**
- **正式 MySQL 队列运行态：未进入验收**
- **本地默认入口稳定性：未通过**
- **真实业务联调：未完成**

所以“把外部 API Key 和模型调用收回服务端、补任务队列与稳定性机制”这两项当前应记录为：

**已完成主体开发与基础验证，待 MySQL 正式环境联调验收。**
