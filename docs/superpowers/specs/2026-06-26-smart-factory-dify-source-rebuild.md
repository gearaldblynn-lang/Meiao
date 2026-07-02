# 智能工厂 Dify 源码迁移重构 Spec

## 硬约束

- 本次重构不是 Dify-like 仿写。所有迁移能力必须标注 Dify 源码路径、commit、迁移方式和验收方式。
- 禁止私自降级：任何未迁移能力必须在本文件标为 `deferred` 并写清原因，不能在界面中伪装成真实可用。
- 旧智能体功能不替换、不作为实现参考；智能工厂作为旧智能体下方的新主功能独立存在。
- 前端不用 Dify 原 web 视觉品牌，但交互结构必须迁移 Dify 工作室/应用编辑的成熟分层。
- 当前项目是 Vite + 本地 Node 服务，不直接嵌入 Dify Next.js 全前端、plugin daemon、sandbox、Docker Compose、完整租户权限。

## Dify 源码基线

- Repository: `https://github.com/langgenius/dify.git`
- Local source: `/tmp/meiao-dify-audit`
- Commit: `599d92ef6b59adcaffc82f5231391749fa1ef94c`
- License notice: `server/ai-engine/difySourceNotice.mjs`

## 源码迁移映射

| 能力 | Dify source path | 迁移方式 | 本项目落点 | 验收 |
| --- | --- | --- | --- | --- |
| 工作室应用列表 | `web/app/components/apps/*`, `web/app/components/app-sidebar/app-info/*` | adapted port | `src/modules/AgentCenter/SmartFactoryPanel.tsx` home surface | 应用卡片、创建入口、类型筛选、搜索存在 |
| 应用内侧栏 | `web/app/components/app-sidebar/app-detail-section.tsx` | adapted port | `SmartFactoryPanel.tsx` app detail shell | 编辑 / 访问 API / 日志与标注 / 监测四个入口存在 |
| Agent 编辑主结构 | `web/app/components/workflow/nodes/agent-v2/panel.tsx` | adapted port | `SmartFactoryPanel.tsx` edit tab | 左编辑、右调试预览，配置块分层，不堆单页 |
| Prompt 编辑器交互 | `web/app/components/workflow/nodes/agent-v2/components/agent-task-field.tsx`, `web/app/components/base/prompt-editor/*` | adapted port | `DifyPromptTaskEditor` | 提示词大编辑器、字符计数、插入变量提示 |
| 变量 | Dify `PromptEditor` variable block / Agent task field | adapted port | agent config `variables` | 可新增变量、持久化、public config 暴露 |
| 知识库绑定 | `api/core/rag/*`, `web/app/components/workflow/nodes/knowledge-retrieval/*` | adapted backend + adapted UI | `server/ai-engine/knowledgeIngestion.mjs`, `SmartFactoryPanel.tsx` | 文本/文件上传、训练、检索、绑定 agent |
| 工具/CLI | `api/core/tools/*`, `dify-agent/src/*` | adapted backend + adapted UI | `server/ai-engine/toolRegistry.mjs`, `cliToolRunner.mjs`, `SmartFactoryPanel.tsx` | 工具注册、授权、测试、绑定 agent |
| 模型中转配置 | `api/core/app/app_config/easy_ui_based_app/model_config/manager.py` | adapted backend + adapted UI | `modelRelayRegistry.mjs`, `SmartFactoryPanel.tsx` | Base URL、credentialRef、模型列表、默认/备用模型 |
| 调试预览 | `web/app/components/workflow/panel/debug-and-preview/index.tsx` | adapted port | `DifyDebugPreviewPanel` | 右侧 Debug & Preview、会话、运行证据、输入框 |
| 发布 | Dify app detail publish/config snapshot pattern | adapted port | `publishSmartFactoryAgent` | 发布按钮、发布就绪检查、发布后会话可用 |
| 访问 API | `web/app/components/app-sidebar/app-detail-section.tsx` develop nav | adapted port | API tab | 显示当前内部 API endpoint 和 payload |
| 日志与标注 | Dify logs/annotations nav | adapted port | logs tab | 显示 run logs、trace、标注入口说明 |
| 监测 | Dify overview nav | adapted port | monitor tab | 显示调用量、知识引用、工具调用、错误数 |
| 视觉 | Dify text generation `VisionSettings` | adapted config | agent `vision` | 可开关、限制大小/来源持久化 |

## 非目标

- 不迁移 Dify 整个 web frontend。
- 不迁移完整租户/权限体系。
- 不迁移完整 plugin daemon。
- 不迁移 sandbox。
- 不引入完整 Docker Compose 服务栈。
- 不迁移 Dify 完整数据库迁移体系。

这些非目标不是能力降级，而是当前项目边界内的源码适配迁移范围；界面必须如实呈现哪些能力真实可用、哪些外部系统尚未接入。

## 产品验收标准

- 用户进入智能体主功能后，侧边栏下方可进入“智能工厂”。
- 智能工厂首页类似 Dify 工作室：应用筛选、搜索、创建应用、导入 DSL 入口、应用卡片。
- 进入智能体后，页面不是卡片堆叠，而是 Dify 应用详情结构：左侧应用信息与二级导航，中间编辑配置，右侧调试预览。
- 编辑页必须有：Prompt、变量、知识库、元数据过滤、工具、视觉、模型选择、Agent 设置、发布。
- 知识库必须支持：创建知识库、文件读取、训练、检索测试、绑定智能体。
- 工具必须支持：CLI 工具注册、schema、授权状态、测试、绑定智能体；飞书未接真实 API 时必须明确标识为本地 executor。
- 模型必须支持：中转 provider、baseUrl、credentialRef、模型列表、默认模型、备用模型、连接测试。
- 调试预览必须真实调用 `/api/smart-factory/chat`，并显示引用来源、工具结果、trace。
- 访问 API、日志与标注、监测不是摆设，必须展示当前 agent 的真实 endpoint、run log 和指标。
- 浏览器截图验收必须覆盖首页和编辑页。
