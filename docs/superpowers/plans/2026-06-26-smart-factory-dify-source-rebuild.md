# 智能工厂 Dify 源码迁移重构 Plan

## 目标

把当前智能工厂从轻量 Dify-like 壳重构为“Dify 源码迁移/适配”的智能体工作室。前端重做成 Dify 工作室 + Agent 编辑器交互结构，后端补齐智能体配置字段持久化，并保留知识库 RAG、模型中转、工具/CLI 的真实调用链路。

## 阶段与验收

### 阶段 1：迁移边界和源码证据

- 建立 spec 和 source map，明确 Dify commit、路径、迁移方式。
- 前端代码暴露 `DIFY_APP_STUDIO_SOURCE_PATHS`，测试断言来源路径。
- 验收：测试能证明智能工厂不是无来源仿写，文档能追溯每个能力来源。

### 阶段 2：配置模型补齐

- Agent 增加 `variables`、`metadataFilters`、`vision` 配置。
- `normalizeSmartFactoryConfig`、`getSmartFactoryPublicConfig`、`create/update agent`、runtime inputs 同步处理。
- 验收：server 单测覆盖变量、元数据过滤、视觉持久化和 public config 暴露。

### 阶段 3：前端重构

- 重写 `SmartFactoryPanel.tsx`：
  - home surface：Dify 工作室式应用列表、筛选、搜索、创建入口。
  - studio surface：Dify 应用详情式左侧 nav。
  - edit tab：Prompt editor、变量、知识库、元数据过滤、工具、视觉、右侧 Debug & Preview。
  - api/logs/monitor tabs：真实 endpoint、run logs、指标。
- 状态条默认收起，避免上方一堆验收状态破坏工作区。
- 验收：源码测试断言关键功能项；浏览器截图确认不堆页面、不溢出。

### 阶段 4：联调验证

- 跑前端 source tests。
- 跑 server smart factory tests。
- 跑 build。
- 用浏览器截图验收首页和编辑页。

## 禁区

- 禁止把 Dify 源码迁移降级成“参考 Dify 思路”。
- 禁止把未真实接入的外部系统写成“已接入”。
- 禁止改旧智能体功能来冒充智能工厂。
- 禁止只改 DB 模式或只改本地 JSON 模式相关配置契约。
