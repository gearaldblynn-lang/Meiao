# Gemini 3.5 Flash KIE 接入设计

## 背景

梅奥 AI 现有 Provider 网关已经通过 KIE 接入多种聊天模型，其中 `gemini-3-flash-openai` 使用 KIE 的 OpenAI-style 流式接口。用户提供的新 KIE 文档是 `Gemini 3.5 Flash` 的 Gemini-native 接口，路径为 `/gemini/v1/models/gemini-3-5-flash:streamGenerateContent`，请求体使用 `contents`、`tools.googleSearch` 和 `generationConfig.thinkingConfig`。

本次目标是新增 `Gemini 3.5 Flash` 可选模型，不替换现有 `Gemini 3 Flash`，并继续复用现有 KIE key。

## 范围

- 在公共系统配置的聊天模型目录中新增 `gemini-3-5-flash`。
- 在 Provider 网关新增 Gemini-native 请求适配器。
- 复用 `KIE_API_KEY` / `MEIAO_KIE_API_KEY`，不新增环境变量；该 endpoint 按 KIE cURL 示例和 Request 鉴权说明使用 `Authorization: Bearer <KIE key>`。
- 维持现有 `gemini-3-flash-openai`、`gemini-3.1-pro-openai`、`gpt-5-4-openai-resp` 和 Claude 路由不变。
- 更新测试覆盖模型目录和 Provider 请求契约。

## 架构

`server/jobRuntime.mjs` 继续负责暴露模型目录和默认模型解析。新增模型沿用当前 Gemini 模型能力：provider 为 `kie`，media transport 为 `public_url`，支持图片输入、文件输入、Google Search 和 `low/high` reasoning level。视频分析模型列表仍由 Gemini 模型过滤得出，因此新模型会自然进入视频分析候选，但默认视频分析模型保持现有 `gemini-3-flash-openai`。

`server/providerGateway.mjs` 新增 `gemini-3-5-flash` 专用分支。该分支不复用 OpenAI-style `chat/completions` 请求体，而是按 KIE 文档构造 Gemini-native 请求：

- 内部 `messages` 转为 Gemini `contents`。
- `system` 文本合并到首条 user 内容前，避免 Gemini role 不支持 system。
- `assistant` role 映射为 `model`，其他 role 映射为 `user`。
- 文本 part 使用 `{ text }`。
- 图片和文件 URL part 使用 `{ file_data: { mime_type, file_uri } }`，URL 继续通过现有 Gemini provider media resolver 转成外部可访问地址。
- `webSearchEnabled` 映射为 `tools: [{ googleSearch: {} }]`。
- caller function tools 映射为 `tools: [{ functionDeclarations: [...] }]`。
- `reasoningLevel` 映射为 `generationConfig.thinkingConfig.thinkingLevel`，只传 `low` 或 `high`。
- 鉴权 header 使用 `Authorization: Bearer <KIE key>`，不把 key 放入 URL 或请求体。

## 响应处理

接口可能返回 `text/event-stream` 或普通 JSON。网关需要同时支持：

- SSE: 逐块解析 `data:` 行，累积 `candidates[].content.parts[].text`。
- JSON: 直接提取 `candidates[].content.parts[].text`。
- `responseId` 作为 providerTaskId。
- `credits_consumed` 和 `usageMetadata` 写入 result，供日志和统计继续消费。
- 如果返回 function call 而没有文本，按 bad response 处理，因为当前策划链路需要纯文本内容。

## 错误处理

新增适配器复用现有 `fetchKieWithTimeout`、`mapHttpError`、`createProviderError` 和 fallback 机制。超时、鉴权、限流、服务端错误仍按现有 provider 错误码分类，保证任务队列和日志看板不需要额外分支。

## 测试

新增或更新以下测试：

- `server/jobRuntime.test.mjs`：公共配置暴露 `gemini-3-5-flash`，该模型 provider 为 `kie`，reasoning levels 为 `low/high`，且默认视频分析模型不改变。
- `server/providerGateway.test.mjs`：执行 `kie_chat` 且 model 为 `gemini-3-5-flash` 时，请求发往 Gemini-native endpoint，`Authorization: Bearer` 使用同一个 KIE key，请求体包含 `contents`、`tools.googleSearch` 和 `generationConfig.thinkingConfig`。
- `server/providerGateway.test.mjs`：JSON 响应可提取 content、responseId、credits 和 usage metadata。

## 非目标

- 不改默认全局分析模型。
- 不把旧 `gemini-3-flash-openai` 替换为 3.5。
- 不新增前端 UI 组件；现有设置页和模型选择器会从公共配置自动读取新增模型。
- 不新增或迁移 KIE key 配置。
