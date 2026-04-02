# 内部多智能体中心设计

## 目标

在现有内部账号系统、日志系统、云端部署能力和模型调用能力基础上，新增一个可长期演进的内部多智能体中心，满足以下要求：

- 内部团队登录后使用多个不同业务智能体
- 各部门专家可自行创建、编辑、发布、回滚自己负责的智能体
- 总管理员可管理全部智能体和知识库
- 智能体可绑定独立知识库、SOP、FAQ、案例资料
- 模型调用支持按任务复杂度和模态选择不同模型
- 成本控制由服务端统一治理，而不是每次全量注入知识库
- 每个用户的会话、上下文、上传文件必须严格隔离
- 发布前必须先经过验证
- 智能体支持保留最近两个历史版本并快速恢复

## 现状

- 当前系统已经具备内部登录、账号管理、运行日志、MySQL 持久化、资源上传、生成任务与云端部署能力。
- 现有模型调用主要围绕图片生成、文案策划、视频等业务模块，没有统一的聊天型智能体平台。
- 当前权限模型主要是 `admin` / `staff` 两级，尚未细化到“只能管理自己资源”的智能体级权限。
- 现有日志体系已可记录用户、模块、动作、状态，适合扩展到智能体调用审计。

## 设计目标

1. 增加一个一级模块 `智能体中心`，位于现有功能列表最上方。
2. 首期支持内部多智能体聊天，不做对外开放平台。
3. 智能体与知识库解耦：知识库独立存在，智能体版本只绑定和配置检索策略。
4. 智能体配置版本化：编辑产生草稿，验证通过后发布。
5. 会话按用户隔离，知识库共享但会话记忆不共享。
6. 成本控制内建：固定系统提示词、受控上下文、按需检索、模型路由。

## 非目标

- 首期不做智能体之间互相调用
- 不做复杂工作流编排器
- 不做自动长期记忆学习
- 不做知识库完整发布版系统
- 不引入对外开放的第三方租户模型

## 方案概览

### 1. 信息架构

新增一级模块 `智能体中心`，下设：

- `智能体列表`
- `智能体编辑`
- `知识库管理`
- `知识库详情`
- `智能体测试台`
- `使用统计`

普通使用者通过单独的聊天入口使用已发布智能体，不进入管理配置页。

### 2. 权限模型

首期复用现有登录体系，不强制重构全局角色系统。在智能体资源层做额外校验：

- 总管理员：可管理全部智能体、知识库、版本、统计
- 部门专家管理员：可创建和管理自己名下智能体与知识库，不能删除或发布别人的资源
- 普通员工：只能使用已发布智能体，只能访问自己的会话与消息

首期实现建议：

- 保留现有 `admin` / `staff`
- 在用户记录上增加一个总管理员标识，或使用固定管理员白名单
- 智能体与知识库查询统一校验 `owner_user_id`

### 3. 智能体与知识库关系

知识库不随智能体版本复制。正确关系为：

- `knowledge_bases` 是长期独立资产
- `knowledge_documents` / `knowledge_chunks` 归属于知识库
- `agent_versions` 存放版本化配置
- `agent_version_knowledge_bases` 维护版本与知识库的绑定关系

这样发布新版本时，只更新：

- prompt
- 模型策略
- 上下文策略
- 检索策略
- 绑定哪些知识库

不复制知识库内容本体。

### 4. 发布与回滚

已发布智能体不能直接原地修改。标准流程：

1. 基于当前发布版本创建新草稿
2. 在测试台完成至少一次验证
3. 验证通过后发布
4. 发布后更新当前线上版本
5. UI 展示最近两个历史版本，支持快速恢复

数据库中保留全部版本记录；界面重点展示最近三个可切换版本：

- 当前发布版本
- 上一个版本
- 上上个版本

回滚本质上是“将历史版本重新设为当前发布版本”，不是修改旧版本内容。

## 页面设计

### 1. 智能体列表

显示当前用户可管理的智能体，字段包括：

- 名称
- 部门
- 创建人
- 当前状态
- 当前发布版本
- 默认模型
- 绑定知识库数量
- 最近 7 天调用次数
- 最近更新时间

支持操作：

- 新建
- 编辑
- 测试
- 发布
- 回滚
- 归档

### 2. 智能体编辑

按页签拆分，避免大表单过长：

- 基础信息
- Prompt 与回复规则
- 模型与成本策略
- 知识库与检索策略
- 发布与权限

### 3. 知识库管理

支持：

- 新建知识库
- 上传文档
- 查看解析状态
- 删除文档
- 查看被哪些智能体绑定

知识库建议按业务层次组织：

- 规则库
- SOP 库
- FAQ 库
- 案例库

### 4. 智能体测试台

发布前必须使用。至少展示：

- 最终选择的模型
- 是否触发知识库检索
- 命中的知识库、文档和片段数量
- 估算 token 与成本
- 响应耗时
- 错误或降级原因

### 5. 聊天页

聊天页面向普通使用者，结构保持简单：

- 左侧：智能体列表、最近会话
- 中间：消息区
- 底部：文本输入、图片上传、文件上传
- 顶部：当前智能体简介与能力标签

普通使用者不暴露高级策略开关，模型、检索、成本策略由后台统一配置。

## 数据模型

### 1. `agents`

智能体主表，仅存稳定字段：

- `id`
- `name`
- `description`
- `department`
- `owner_user_id`
- `visibility_scope`
- `status`
- `current_version_id`
- `created_at`
- `updated_at`

### 2. `agent_versions`

智能体版本表，存放版本化配置：

- `id`
- `agent_id`
- `version_no`
- `is_published`
- `system_prompt`
- `reply_style_rules_json`
- `model_policy_json`
- `context_policy_json`
- `retrieval_policy_json`
- `tool_policy_json`
- `validation_status`
- `validation_summary_json`
- `created_by`
- `created_at`

首期允许使用 JSON 字段保存策略，降低实施复杂度。

### 3. `agent_version_knowledge_bases`

智能体版本与知识库关系表：

- `id`
- `agent_version_id`
- `knowledge_base_id`
- `priority`
- `created_at`

### 4. `knowledge_bases`

知识库主表：

- `id`
- `name`
- `description`
- `department`
- `owner_user_id`
- `status`
- `created_at`
- `updated_at`

### 5. `knowledge_documents`

知识文档表：

- `id`
- `knowledge_base_id`
- `title`
- `source_type`
- `storage_asset_id`
- `raw_text`
- `parse_status`
- `chunk_count`
- `created_by`
- `created_at`
- `updated_at`

### 6. `knowledge_chunks`

知识切片表：

- `id`
- `document_id`
- `knowledge_base_id`
- `chunk_index`
- `content`
- `token_estimate`
- `embedding_json`
- `created_at`

首期允许先做轻量文本检索，`embedding_json` 作为后续向量检索预留字段。

### 7. `chat_sessions`

会话表：

- `id`
- `user_id`
- `agent_id`
- `agent_version_id`
- `title`
- `status`
- `created_at`
- `updated_at`

### 8. `chat_messages`

消息表：

- `id`
- `session_id`
- `user_id`
- `role`
- `content`
- `attachments_json`
- `metadata_json`
- `created_at`

### 9. `agent_usage_logs`

调用审计表：

- `id`
- `user_id`
- `agent_id`
- `agent_version_id`
- `session_id`
- `request_type`
- `selected_model`
- `used_retrieval`
- `retrieval_summary_json`
- `prompt_tokens`
- `completion_tokens`
- `total_tokens`
- `estimated_cost`
- `latency_ms`
- `status`
- `error_message`
- `created_at`

## 接口设计

### 1. 智能体管理

- `GET /api/agents`
- `POST /api/agents`
- `GET /api/agents/:id`
- `PATCH /api/agents/:id`
- `DELETE /api/agents/:id`
- `POST /api/agents/:id/draft`
- `POST /api/agents/:id/publish`
- `POST /api/agents/:id/rollback`

### 2. 智能体版本

- `GET /api/agents/:id/versions`
- `GET /api/agent-versions/:versionId`
- `PATCH /api/agent-versions/:versionId`
- `POST /api/agent-versions/:versionId/validate`
- `GET /api/agent-versions/:versionId/validation-logs`

### 3. 知识库管理

- `GET /api/knowledge-bases`
- `POST /api/knowledge-bases`
- `GET /api/knowledge-bases/:id`
- `PATCH /api/knowledge-bases/:id`
- `DELETE /api/knowledge-bases/:id`

### 4. 知识文档

- `GET /api/knowledge-bases/:id/documents`
- `POST /api/knowledge-bases/:id/documents`
- `GET /api/knowledge-documents/:id`
- `DELETE /api/knowledge-documents/:id`
- `POST /api/knowledge-documents/:id/reparse`

### 5. 聊天

- `GET /api/chat/agents`
- `POST /api/chat/sessions`
- `GET /api/chat/sessions`
- `GET /api/chat/sessions/:id/messages`
- `POST /api/chat/sessions/:id/messages`

### 6. 统计与审计

- `GET /api/agent-usage`
- `GET /api/agent-usage/summary`
- `GET /api/agent-usage/:agentId`

## 执行链路

一次消息请求的标准执行链路：

1. 用户选择智能体
2. 服务端读取当前已发布版本
3. 校验使用权限
4. 读取该用户自己的会话上下文
5. 做问题分类
6. 判断是否需要知识库检索
7. 如需检索，按策略召回少量相关片段
8. 组装最终上下文
9. 根据策略选择模型
10. 调用模型
11. 写入消息、日志、token、耗时、成本
12. 返回结果

服务端不得直接将整个知识库全文注入 prompt。

## 检索策略

每个智能体版本配置一套 `retrieval_policy`，至少包含：

- `enabled`
- `top_k`
- `max_chunks`
- `similarity_threshold`
- `source_priority`
- `max_context_chars`
- `fallback_mode`

推荐检索顺序：

1. 先判断是否为知识型问题
2. 优先查 FAQ / 规则库
3. 不足时查 SOP
4. 仍不足时查案例库
5. 最终仅注入少量相关片段

## 成本控制策略

每个智能体版本配置一套 `cost_policy`，至少包含：

- `default_model`
- `cheap_model`
- `advanced_model`
- `multimodal_model`
- `max_history_rounds`
- `summary_trigger_threshold`
- `knowledge_lookup_enabled`
- `complex_query_upgrade_enabled`
- `daily_budget_limit`
- `per_user_limit`
- `per_session_limit`

推荐运行策略：

- 简单问题：不查库，走便宜模型
- 知识型问题：查库后走便宜模型
- 复杂分析：查库后升级强模型
- 图片或文件问题：直接走多模态模型
- 长会话：定期摘要，仅保留摘要和最近几轮

## 会话隔离

会话隔离为硬约束，必须做到三层：

1. 数据隔离：`chat_sessions` 和 `chat_messages` 强制带 `user_id`
2. 上下文隔离：模型调用只读取当前用户当前会话数据
3. 文件隔离：上传资源绑定 `user_id` 与 `session_id`

不同用户共享的是：

- 已发布智能体版本
- 绑定知识库

不同用户不共享的是：

- 会话历史
- 会话摘要
- 上传文件
- 临时上下文

## 验证与发布规则

- 草稿版本未验证不得发布
- 首期“验证通过”至少要求完成一次成功测试对话
- 测试结果写入 `validation_summary_json`
- 发布动作必须记录操作者、时间、版本号

## 测试要求

1. 普通用户只能看到已发布智能体
2. 部门专家只能管理自己创建的智能体与知识库
3. 总管理员可管理全部资源
4. 编辑已发布智能体会生成新草稿，而不是直接改线上版本
5. 未验证版本不能发布
6. 历史版本可以恢复
7. 同一知识库可绑定多个智能体版本，不产生内容副本
8. 简单问题不会全量注入知识库
9. 不同用户的会话、消息、附件不能串读
10. 审计日志能看到模型、检索、token、成本和错误信息

## 实施范围建议

第一阶段优先落地：

- 智能体列表
- 智能体编辑
- 知识库管理
- 聊天页
- 测试台基础版
- 使用统计基础版

第二阶段再考虑：

- 向量检索增强
- 知识库发布版
- 更复杂的工作流和工具编排
