# Repeated Issues Log

Use this file to stop the same problems from being rediscovered and re-fixed in slightly different ways.

Before debugging a recurring issue, search this file, related tests, and recent handoff/release docs. After fixing a repeated issue, append a concise entry.

## Entry Format

```markdown
## YYYY-MM-DD - Short issue name

- Symptom:
- Environment: cloud production / local development / local backup / GitHub comparison
- Root cause:
- Fix:
- Regression check:
- Files/tests:
- Avoid next time:
```

## Standing Lessons

## 2026-06-04 - Main-image planning must keep partial scheme counts visible

- Symptom: 云上账号“洛克”主图提交 10 张需求后，项目卡最终只显示 6 个策划任务。
- Environment: Tencent Cloud production one_click main_image / local development.
- Cloud evidence: 洛克账号 job `ca9bc58f30508c981065f4ce` 的 payload 和日志均为 `count:10`，Prompt 写明“策划 10 屏”；上游返回内容只有 7 个 `[SCHEME_START]`、6 个 `[SCHEME_END]`，第 7 屏停在“三档强风·强力降...”中途。项目 `proj-plan-1780556041028` 最终保存 `planCount=6`、`taskCount=6`。
- Root cause: 上游半截返回时，只有完整闭合的 6 个方案可用于后续生图；第 7 个未闭合方案不能安全生成任务卡。把整次策划判失败会浪费已经可用的 6 个方案，也不符合用户预期。
- Fix: `generateMarketingSchemes` 现在保留所有完整方案并生成对应任务卡；若完整方案数少于期望数，额外写入 `marketing_plan_partial_count` 诊断日志，记录期望数、实际数和缺口数。
- Regression check: `node --test src/services/arkService.test.mjs`.
- Files/tests: `src/services/arkService.ts`, `src/services/arkService.test.mjs`.
- Avoid next time: 所有“用户指定数量”的策划链路都要区分“完全无可用方案”和“部分完整方案”。有完整方案时优先让用户可用；数量缺口进入诊断日志和看板统计。排查同类问题先对比：请求 `count`、Prompt 里的屏数、返回文本里的 `[SCHEME_START]`/`[SCHEME_END]` 数、最终 `plans.length/taskCount`。

## 2026-06-03 - SKU new product upload must clear stale sku draft context

- Symptom: 云上账号“林一”制作 SKU 时，用户上传/进入新 SKU 项目后，策划和后续出图仍像之前的老产品；用户反馈“输入框上传新的内容，之前的数据就要被完全清楚，不要有残留”。
- Environment: Tencent Cloud production one_click SKU / local development.
- Cloud evidence: 林一账号最新 SKU 策划 job `25a482cf9de376e9b1402508` 的 payload 仍包含旧 SKU 文案 `曜石黑/星耀金/甜心粉...`；策划输入图为旧 H2O 加湿器产品图 `主图_6.jpg` 和旧 JISULIFE 风格参考图；最新项目没有对应的 `kie_image` SKU 生图任务，问题已在策划输入阶段复现。账号 `shellDraft.inputStateByScope['one_click:sku']` 仍保留旧 `skuCopyText_*` 和 `count`，`shellDraft.materials` 仍保留旧 SKU-scoped product/styleRef。
- Root cause: 上一次修复只阻止 SKU 继承“未标记 subFeature 的历史素材”，但没有处理“同一个 SKU 作用域里的旧产品、旧风格图、旧赠品和旧 SKU 文案”。`handleMaterialUpload` 一直 append 新上传素材，不会在新产品上传时重置 SKU 草稿输入，所以策划会继续读取旧 `skuCopyText_*` 和旧 SKU-scoped materials。
- Fix: 新增 `shellSkuUploadReset` 上传重置规则：一键 SKU 上传新产品时清理整个 SKU 素材上下文并清空旧 prompt、`skuCopyText_*`、`count` 等业务输入；上传风格参考/赠品时只替换同类型 SKU 素材，避免第二步补参考图时误删刚上传的新产品。`ShellMigratedApp` 的真实上传入口已接入该规则。
- Regression check: `node --test src/adapters/shellSkuUploadReset.test.mjs`; `node --test src/components/uiArchitecture.test.mjs`; `npm run build`.
- Files/tests: `src/adapters/shellSkuUploadReset.mjs`, `src/adapters/shellSkuUploadReset.test.mjs`, `src/ShellMigratedApp.tsx`, `src/components/uiArchitecture.test.mjs`.
- Avoid next time: SKU 是“新产品即新上下文”的工作流。排查 SKU 串图不要只看最终出图，要同时核对 shell draft 的 `materials`、`inputStateByScope`、planning job payload 和 image job payload；新产品上传必须切断旧 SKU 文案和同作用域旧素材。

## 2026-06-03 - SKU material scope must not inherit legacy unscoped assets

- Symptom: 用户怀疑云上账号“林一”制作 SKU 时，新作图会带上之前产品图片数据，导致新出图像旧产品。
- Environment: Tencent Cloud production one_click SKU / local development.
- Cloud evidence: 林一账号最新 SKU 项目 `6月3日项目2` 的云端 state 和 `kie_chat` 策划 payload 只包含当前 SKU 的 `主图_6.jpg` 产品图和 `SKU图_4...` 风格参考图；截至排查时没有最新 SKU image generation job，因此没有证据表明最新生成任务已经把首图/主图旧素材 URL 一起提交给上游。
- Root cause: 代码存在可复发风险：`filteredMaterials` 用 `!item.subFeature || item.subFeature === activeSubFeature` 兼容旧素材，导致历史无 `subFeature` 标记的材料会被当成通用材料进入 SKU 策划/生图；SKU 是独立商品组合工作流，不应继承未标作用域的旧产品图。
- Fix: 新增 `isMaterialInActiveScope`，对 `one_click + sku` 启用严格隔离，只允许 `subFeature === 'sku'` 的素材进入 SKU；同样用于 SKU 赠品编号计算，防止旧未标记赠品影响新 SKU。
- Regression check: `node --test src/components/uiArchitecture.test.mjs`; `npm run build`.
- Files/tests: `src/ShellMigratedApp.tsx`, `src/components/uiArchitecture.test.mjs`.
- Avoid next time: 多子功能共用材料池时，SKU/首图等独立工作流必须显式定义材料作用域规则。不能用“未标记等于通用”覆盖 SKU，因为旧浏览器、导入、恢复和历史 state 都可能产生无 `subFeature` 素材；排查云上问题时要同时核对 app state、internal job payload 和实际 image generation job。

## 2026-06-02 - First-image replication generation must not submit sibling style references

- Symptom: 首图复刻策划里产品素材和复刻参考图角色看起来正确，但后续生图模型收到的 `imageUrls` 同时包含同项目多张风格/复刻参考图，导致模型把参考图里的包装当成商品素材，出图包装错误。
- Environment: Tencent Cloud production one_click first_image / local development.
- Root cause: Shell 批量生图层对一键主详非 SKU 直接把 `Object.values(input.materials).flat()` 全量提交给 provider；首图复刻每个方案虽然有自己的 `sourceReferenceUrl`，但提交时没有按方案过滤 `styleRef`，所以同项目其他参考图也被上传给生图模型。
- Fix: 新增 `shellOneClickMaterials` 过滤层；首图复刻每个方案只保留产品素材、当前方案对应的复刻参考图、logo/上一张结果（如有）。`runShellImageGeneration` 底层也按 `sourceReferenceUrl` 二次过滤 provider 输入 URL。
- Regression check: `node --test src/adapters/shellOneClickMaterials.test.mjs src/modules/OneClick/oneClickBehavior.test.mjs`; `node --test src/components/uiArchitecture.test.mjs`; `npm run build`.
- Files/tests: `src/adapters/shellOneClickMaterials.mjs`, `src/adapters/shellOneClickMaterials.test.mjs`, `src/ShellMigratedApp.tsx`, `src/adapters/shellWorkflow.ts`, `src/modules/OneClick/oneClickBehavior.test.mjs`, `src/components/uiArchitecture.test.mjs`.
- Avoid next time: 多参考图工作流不能把“项目级材料集合”直接当“单个方案的模型输入”。提交 provider 前必须按当前方案 role/filter 生成最终 input image list，并用真实历史 payload 回放验证。

## 2026-06-01 - Agent running chat tasks must be durable pending messages

- Symptom: 智能体中心正在执行的对话/生图任务，刷新页面后“思考中/生成中”消息消失；用户会误以为任务没提交，从而再次点击发送。原任务完成后又可能恢复，造成前端状态混乱和重复提交风险。
- Environment: Tencent Cloud production agent_center / local development.
- Root cause: 智能体对话接口只在 provider 成功返回后一次性插入 user/assistant 消息；执行期间的 pending 消息只存在 React 内存中。刷新会丢掉乐观消息，而且同一会话没有以持久化 pending run 为准的发送锁。
- Fix: 后端在调用模型前先持久化一组 pending user/assistant 消息，完成后原地更新为 completed，失败后原地更新为 failed；同一会话存在 pending assistant run 时拒绝新的发送。前端刷新后从历史消息识别 pending run，保持可见并轮询同步，同时锁住输入框。
- Regression check: `node --test server/agentConversationReliability.test.mjs src/modules/AgentCenter/agentConversationReliability.test.mjs server/agentImagePlan.test.mjs server/agent-image-retrieval.test.mjs server/providerGateway.test.mjs server/agentCenterSource.test.mjs`; `npm run build`; local browser load check at `http://localhost:3100/`.
- Files/tests: `server/index.mjs`, `src/modules/AgentCenter/AgentCenterModule.tsx`, `src/modules/AgentCenter/ChatComposer.tsx`, `server/agentConversationReliability.test.mjs`, `src/modules/AgentCenter/agentConversationReliability.test.mjs`.
- Avoid next time: 长耗时任务不能只靠前端乐观状态表示“正在运行”。任何会跨刷新、超时或断线的任务，都必须先落一个后端可查询的 pending 身份，并用同一个身份控制重复提交。

## 2026-06-01 - Agent image edits must resolve provider temporary analysis URLs back to selected references

- Symptom: 智能体“对话改图”中，分析结果明确是 `image_edit` / `image_to_image` 并要求参考图1、图2，但最终生图请求 `inputImageCount=0`，KIE payload 走 `gpt-image-2-text-to-image`，导致参考图被漏掉。
- Environment: Tencent Cloud production agent_center / local development.
- Root cause: provider gateway 会在分析模型调用前把内部素材 URL 转换成 provider 临时 URL；分析模型有时把这些临时 URL 写回 `inputImageUrls`。后端再用原始选图 URL 精确匹配时匹配失败，把输入图过滤成空。
- Fix: 新增 `agentImagePlan` 输入图解析层，按 `imageReferences.index` 映射回当前选中的原始参考图；当分析结果返回空输入或不可用 provider 临时 URL 时，按明确改图/参考意图恢复选中参考图；改图任务无可用输入时停止提交，不再静默降级为文生图。
- Regression check: `node --test server/agentImagePlan.test.mjs server/agent-image-retrieval.test.mjs server/agentConversationReliability.test.mjs server/providerGateway.test.mjs server/agentCenterSource.test.mjs`; `npm run build`; cloud health check after deploy.
- Files/tests: `server/agentImagePlan.mjs`, `server/agentImagePlan.test.mjs`, `server/index.mjs`, `server/agent-image-retrieval.test.mjs`, `server/agentCenterSource.test.mjs`.
- Avoid next time: provider 临时上传 URL 不能当作业务选图身份。提交生图的最终输入图必须由后端根据当前会话选图目录解析，LLM 返回的 URL 只能作为辅助线索。

## 2026-05-29 - Internal asset API URLs must not be sent directly to providers

- Symptom: KIE planning/image requests fail with `image download failed: HTTP 403: Forbidden` for URLs like `http://111.229.66.247/api/assets/file/...`, while the browser may still open the same image.
- Environment: Tencent Cloud production provider gateway / local development.
- Root cause: `/api/assets/file/...` is an internal managed asset route, not a provider-owned stable media URL. Browser reachability is not enough proof that KIE's downloader can fetch it. A previous optimization incorrectly treated non-local managed asset URLs as safe to pass directly, so provider submission skipped the local download + KIE file conversion step.
- Fix: Provider gateway now converts every managed asset URL before submission, including cloud absolute `/api/assets/file/...` URLs in image generation inputs, chat image/file attachments, and text labels. Only non-managed true public URLs are passed through directly.
- Regression check: `node --test server/providerGateway.test.mjs`
- Files/tests: `server/providerGateway.mjs`, `server/providerGateway.test.mjs`
- Avoid next time: Do not classify an `/api/assets/file/...` URL as model-readable just because it has a public host. Before provider submission, managed asset URLs must be converted to a provider-readable file URL, and tests must cover cloud absolute managed URLs, not only localhost or relative paths.

## 2026-05-26 - Asset persistence failures must log actionable detail

- Symptom: 云上日志只出现 `资产持久化失败`，meta 只有文件名和大小，没有可判断原因的 detail。
- Environment: cloud production frontend shell / local development
- Root cause: `persistGeneratedAsset` 的失败日志只记录 `error.message` 和极少 meta；部分上传失败会被错误归一化成空 detail，导致看板无法区分网络、鉴权、文件名、mime、数据库或存储服务问题。
- Fix: 失败日志统一写入 `errorDetail`，并补充 error name/code/status、原始/上传 mime、上传文件名、上传大小和耗时。
- Regression check: `node --test src/services/persistedAssetClient.test.mjs`
- Files/tests: `src/services/persistedAssetClient.ts`, `src/services/persistedAssetClient.test.mjs`
- Avoid next time: 诊断日志不能只写“失败”；必须带足够定位边界的字段，至少包括错误码、状态、输入文件名/mime/大小和耗时。

## 2026-05-26 - Archive files must be blocked before image generation

- Symptom: 云上日志出现 `File type not supported`，样本里 `.zip` 被带入 `kie_image` 图像生成链路。
- Environment: cloud production provider gateway / local development
- Root cause: 图像生成后端只转发 `imageUrls` 和 prompt 中的媒体 URL，没有前置拦截 zip/rar/7z/tar/gz/tgz 这类压缩包素材；供应商收到后才返回不支持文件类型。
- Fix: `runKieImageJob` 在提交 KIE 前检查 `imageUrls` 和 prompt 中提取出的 URL，发现压缩包扩展名直接返回 `provider_bad_request`，提示先解压并上传图片。
- Regression check: `node --test server/providerGateway.test.mjs`
- Files/tests: `server/providerGateway.mjs`, `server/providerGateway.test.mjs`
- Avoid next time: 供应商明确不支持的素材类型要在本地边界拦截；不要让用户等到 provider 创建任务后才失败。

## 2026-05-25 - Malformed URL paths must not crash static routing

- Symptom: PM2 云上日志出现 `URIError: URI malformed`。
- Environment: cloud production frontend static serving / local development
- Root cause: `tryServeFrontend` 对 `url.pathname` 直接调用 `decodeURIComponent`；畸形 `%` 编码路径会让 Node 抛 `URIError`，进入 PM2 error log。
- Fix: 新增 `safeDecodePathname`，畸形路径返回 `400 Malformed path`，不再抛出未捕获异常。
- Regression check: `node --test src/components/uiArchitecture.test.mjs`
- Files/tests: `server/index.mjs`, `src/components/uiArchitecture.test.mjs`
- Avoid next time: 所有来自 URL path/query 的 decode 都必须包在安全解析函数里；外部请求可能携带畸形编码，不能让它进入应用异常日志。

## 2026-05-25 - Provider task ids must fit local asset job id columns

- Symptom: 云上日志出现 `智能体生图失败：对话改图 Data too long for column 'job_id' at row 1`，错误码 `ER_DATA_TOO_LONG`。
- Environment: cloud production agent center / local development
- Root cause: 智能体生图结果持久化到 `stored_assets` 时，把 provider task id 直接作为 `job_id` 写入；部分供应商返回值可能超过 `stored_assets.job_id VARCHAR(120)`，导致资产持久化失败，并进一步让业务失败日志记录数据库异常而不是原始生成结果。
- Fix: 写入 stored asset 的 job id 先经过 `normalizeStoredAssetJobId`，统一 trim 并限制到 120 字符。
- Regression check: `node --test server/agentCenterSource.test.mjs`
- Files/tests: `server/index.mjs`, `server/agentCenterSource.test.mjs`
- Avoid next time: 外部 provider id、URL、message 等字段写入本地固定长度列前必须按列能力规范化；不要假设供应商 id 会符合本地数据库字段长度。

## 2026-05-25 - Agent retrieval chat must carry fallback models

- Symptom: 云上日志出现 `智能体对话失败：对话改图 Kie Responses 返回为空`，错误码为 `provider_bad_response`，集中在带知识库/检索的智能体对话路径。
- Environment: cloud production agent center / local development
- Root cause: 普通智能体聊天会计算并传入 `fallbackModels`，但 `runAgenticRetrievalLoop` 内部再次调用 `executeProviderJob` 时没有把备用模型传下去；GPT-5.4 Responses 返回空内容时，provider gateway 没有可用的显式 fallback，只能直接失败。
- Fix: `runAgenticRetrievalLoop` 接收 `fallbackModels` 并传给 provider payload；两个智能体入口在进入检索循环时都传入同一份 `resolveChatFallbackModels` 结果。
- Regression check: `node --test server/agentCenterSource.test.mjs`
- Files/tests: `server/index.mjs`, `server/agentCenterSource.test.mjs`
- Avoid next time: 新增“循环式/代理式”模型调用路径时，不能只传主模型；要同步传递 model options、fallback models、reasoning、web search 和附件能力，否则普通聊天修复不会覆盖检索/工具循环路径。

## 2026-05-25 - Image provider input limits should degrade before job failure

- Symptom: 云上日志出现 `GPT Image 2 最多支持 16 张输入图`，同一次一键主详批量出图可连续产生多条 `provider_bad_request` 和前端失败日志。
- Environment: cloud production backend provider gateway / local development
- Root cause: provider gateway 对 GPT Image 2 输入图数量超过 16 张直接抛错；一键主详在产品图、参考图、历史结果图、Logo 组合后可能超过模型上限，导致任务创建后立刻失败。
- Fix: GPT Image 2 请求在提交 provider 前按模型能力保留前 16 张输入图，继续执行有效请求。
- Regression check: `node --test server/providerGateway.test.mjs`
- Files/tests: `server/providerGateway.mjs`, `server/providerGateway.test.mjs`
- Avoid next time: provider 模型能力限制要尽量在进入 provider 前裁剪、降级或给用户前置提示；不要把可恢复的参数超限变成云上任务失败日志。

## 2026-05-25 - Static frontend routes must not read directories as files

- Symptom: PM2 云上日志出现 `Error: EISDIR: illegal operation on a directory, read`，堆栈指向 `serveStaticFile` -> `tryServeFrontend`。
- Environment: cloud production frontend static serving / local development
- Root cause: `tryServeFrontend` 只判断 `existsSync(targetPath)`，路径存在就调用 `serveStaticFile`；当请求命中 `dist` 下的目录路径时，`readFileSync` 会尝试读取目录并抛出 EISDIR。
- Fix: 静态文件读取前增加 `statSync(targetPath).isFile()` 检查；目录路径不再进入 `serveStaticFile`，非 assets 目录走 SPA fallback，assets 目录按缺失资源 404。
- Regression check: `node --test src/components/uiArchitecture.test.mjs`
- Files/tests: `server/index.mjs`, `src/components/uiArchitecture.test.mjs`
- Avoid next time: 所有静态资源服务逻辑都不能只用 `existsSync` 判断可读文件；必须区分 file/directory，特别是 SPA fallback 和 assets 404 分支。

## 2026-05-25 - MySQL pool closures are transient infrastructure failures

- Symptom: PM2 云上日志出现 `Error: Pool is closed.`、`Connection lost: The server closed the connection.`，并伴随 `Reconciled N stale running jobs after restart.`。
- Environment: cloud production backend worker / local development
- Root cause: 连接池关闭、数据库断连或进程重启会让 worker 的查询抛出无业务含义的 MySQL 瞬时错误；如果只按 error code 判断，`Pool is closed.` 这种 message-only 错误会被漏掉。
- Fix: `isTransientMysqlConnectionError` 同时识别断连错误码和 `Pool is closed` / `Connection lost` / `server closed the connection` 文案；stale running job 继续回收到 `retry_waiting`，避免重启后直接变成最终失败。
- Regression check: `node --test server/jobRuntime.test.mjs`
- Files/tests: `server/jobRuntime.mjs`, `server/jobRuntime.test.mjs`, `server/jobManager.mjs`
- Avoid next time: worker 遇到数据库连接类错误时不要当供应商或任务逻辑失败处理；日志看板里若部署后仍高频出现，应重点查云上重启原因、MySQL idle timeout 和连接池生命周期，而不是只改业务流程。

## 2026-05-31 - Generated one-click media must not depend only on current plan ids

- Symptom: 洛克账号一键主详项目卡显示已生成，积分已消耗且可批量下载；打开详情后部分方案仍显示“待生成图”。
- Environment: cloud production frontend shell / one_click project detail modal
- Root cause: 详情页 `PlanEditor` 只按当前 `plan.id === result.planId` 匹配生成结果。一键主详历史项目和重复生成项目里，结果图片可能已经保存到 `schemes[].resultUrl` 并进入 `project.results`，但它的 `planId` 仍是旧策划批次或 provider 任务 id；此时批量下载按 `results` 可用，详情方案卡却因为 planId 错位显示待生成。
- Fix: 抽出 `findResultsForPlanDisplay`，先按 planId 精确匹配；精确匹配不到时，把未归属到当前任一方案的 orphan media results 按未匹配方案顺序兜底展示，避免已有图片被隐藏。
- Regression check: `node --test src/shell/components/planResultMatching.test.mjs`
- Files/tests: `src/shell/components/PlanEditor.tsx`, `src/shell/components/planResultMatching.ts`, `src/shell/components/planResultMatching.test.mjs`
- Avoid next time: 详情展示不能只以当前策划 id 判断是否“已出图”；只要结果有真实媒体 URL、backendJobId 或 provider task id，就必须有可见路径。排查同类问题先对比 `plans[].id`、`results[].planId`、`schemes[].resultUrl` 和批量下载列表。

## 2026-05-25 - Clipboard API must be treated as optional

- Symptom: 云上前端日志出现 `Cannot read properties of undefined (reading 'writeText')`，集中在复制提示词、复制文案、复制任务/图片链接等点击入口。
- Environment: cloud production frontend shell / local development
- Root cause: 多个业务组件直接调用 `navigator.clipboard.writeText`。部分浏览器、非安全上下文、权限受限环境或内嵌环境里 `navigator.clipboard` 可能不存在，点击后会变成前端异步错误。
- Fix: 新增共享 `copyTextToClipboard`，先尝试 Clipboard API，失败或缺失时降级到 textarea + `execCommand('copy')`；业务源码禁止直接访问 `navigator.clipboard`。
- Regression check: `node --test src/utils/clipboardFallback.test.mjs`
- Files/tests: `src/utils/clipboard.mjs`, `src/utils/clipboardFallback.test.mjs`, `src/shell/components/ProjectCard.tsx`, `src/shell/components/ResultCard.tsx`, `src/modules/Retouch/RetouchModule.tsx`, `src/modules/BuyerShow/BuyerShowModule.tsx`
- Avoid next time: 新增复制按钮时只调用共享 helper，不要在组件里裸调浏览器 Clipboard API；看板里再次出现 `writeText` 应按“已修复后复发”重点关注。

## 2026-05-25 - Backend-completed tasks must replace stale frontend failure placeholders

- Symptom: 前端项目卡显示失败或多个任务被压成单个，但 `/api/jobs` 后台任务已经成功并有真实 provider task id / 图片结果；管理员日志缺少项目、方案、批次等定位字段，排查需要反查多处数据。
- Environment: local development / cloud production frontend shell
- Root cause: 一键主详刷新水合时，非首图结果会按 `planId` 折叠，吞掉同一方案下不同 backend/provider 任务；后台成功结果和旧前端失败占位合并时，没有清掉“无 backend/provider 身份”的同 plan 失败占位，导致 `taskCount` 被抬高、项目继续显示 `error`。任务日志 meta 也只记录少量 job/provider 字段，不足以直接定位 shellProjectId、shellPlanId、subFeature 和批次。
- Fix: `normalizeOneClickProjectCard` 不再按 `planId` 折叠真实结果，`taskCount` 至少覆盖结果数；`mergeProjectResultsByIdentity` 在后台成功结果进入时，只移除同 plan 且无 backend/provider 身份、无媒体 URL 的旧失败/生成占位；新增统一 `buildJobRuntimeLogMeta`，创建/完成/失败日志都带 job、provider、shell 项目/方案、子功能、批次、耗时、积分和结果 URL 数量。
- Regression check: `node --test src/adapters/shellDataAdapter.test.mjs src/utils/shellProjectResults.test.mjs server/jobRuntime.test.mjs server/jobLoggingBehavior.test.mjs server/localJobStore.test.mjs server/jobManager.test.mjs`
- Files/tests: `src/adapters/shellDataAdapter.ts`, `src/adapters/shellDataAdapter.test.mjs`, `server/jobRuntime.mjs`, `server/jobRuntime.test.mjs`, `server/jobManager.mjs`, `server/localJobStore.mjs`, `server/index.mjs`, `server/jobLoggingBehavior.test.mjs`
- Avoid next time: 任务结果合并不能只看 `planId`；真实 backend/provider 身份优先。旧失败占位如果没有 backend/provider 身份，后台同 plan 成功结果应覆盖它而不是并存抬高 taskCount。新增任务日志必须统一走诊断 meta 构造器。

## 2026-05-25 - Pending card deletion must tombstone backend jobs

- Symptom: 用户删除前端“生成中/待同步”的结果卡后，刷新或 `/api/jobs` 轮询又把同一个后端任务完成结果恢复出来；表现为任务卡脏读、前端任务消失/复活、后端 API 仍正常完成但前端状态不稳定。
- Environment: local development / cloud production frontend shell
- Root cause: 删除结果卡时只记录了前端临时 `resultId`，没有把 `backendJobId` / provider task id 一起写入 tombstone；后端任务完成后可能以不同的 provider result id 合并回项目，绕过了只按 result id 的删除过滤。
- Fix: 结果删除时从当前 project/result 收集 backend/provider job ids 并传给 `persistDeletionToSharedState`；持久化 app state、runtime snapshot 和 shell hydration 都按 backend/provider job id 过滤项目/结果/任务。
- Regression check: `node --test src/utils/persistedDeletion.test.mjs src/utils/shellRuntimePrune.test.mjs src/adapters/shellDataAdapter.test.mjs src/shell/components/destructiveActions.test.mjs`
- Files/tests: `src/ShellMigratedApp.tsx`, `src/utils/persistedDeletion.ts`, `src/utils/shellRuntimePrune.mjs`, `src/adapters/shellDataAdapter.test.mjs`, `src/shell/components/destructiveActions.test.mjs`, `src/utils/persistedDeletion.test.mjs`, `src/utils/shellRuntimePrune.test.mjs`
- Avoid next time: 新增任务卡删除/清理入口时，删除键不能只用 UI id；必须同时记录 backend job id、provider task id 和对应 result id，并验证“后端稍后完成”不会重新水合已删除卡片。

## 2026-05-21 - Shell duplicate submit before visible feedback

- Symptom: 用户点击底部提交后短时间没有明显反馈，连续点击会创建多个生成任务卡片；已在白底精修/产品精修入口复现，同类问题会影响所有未纳入提交锁的底部生成入口。
- Environment: local development / cloud production frontend shell
- Root cause: 新版底部提交锁只覆盖 `video:generation`，白底精修等生成入口在素材上传和 job 创建前没有同步 ref 锁；后端 job 去重只能复用已创建的 active job，挡不住前端先创建多个独立项目占位。
- Fix: `shouldGuardGenerationSubmit` 覆盖所有可运行底部生成模块：`one_click`、`translation`、`buyer_show`、`retouch`、`video`、`xhs_cover`；`handleGenerate` 使用同步 ref 短锁保护“点击到任务卡/后端 job 创建确认”这段临界区，收到 `onJobCreated` 或已创建可见任务后立即释放提交按钮，不能用活跃任务状态把整个生成周期串行锁死。
- Regression check: `node --test src/shell/components/destructiveActions.test.mjs src/components/uiArchitecture.test.mjs`
- Files/tests: `src/ShellMigratedApp.tsx`, `src/shell/components/destructiveActions.test.mjs`, `src/components/uiArchitecture.test.mjs`
- Avoid next time: 新增任务入口时先确认“点击到可见项目卡片出现前”的同步锁，不要只依赖 React 状态、按钮 disabled 或后端 job dedupe。

### Cloud, local, and GitHub are different sources of truth

- Symptom: A change appears fixed locally or exists on GitHub, but cloud behavior is unchanged.
- Root cause: GitHub is version storage, not the running application. Local dev is for verification, not proof of cloud deployment.
- Avoid next time: State the target environment at the start of the task. For production issues, check Tencent Cloud state and deployment docs before claiming completion.

### Prompt changes must preserve parsing anchors

- Symptom: A prompt improvement breaks downstream parsing, output fields, or historical constraints.
- Root cause: Prompt text changed without preserving RTCFE structure, required fields, or parser assumptions.
- Avoid next time: Read `docs/prompt-rtcfe-migration-map.md` before prompt edits. Preserve existing output fields and add regression tests around parsing-sensitive behavior.

### One-click modules are related but not interchangeable

- Symptom: Fixing first image behavior changes main image, detail page, or SKU behavior unexpectedly.
- Root cause: Shared utilities or prompts were edited without checking each workflow's separate constraints.
- Avoid next time: Name the target workflow explicitly. Run focused tests for the touched workflow and smoke tests for neighboring one-click workflows.

### Model-readable image URLs must stay plain public URLs

- Symptom: KIE image tasks fail with `File type not supported`, or generated tasks receive strings like `[https://...jpg](https://...jpg)` instead of plain URLs.
- Root cause: Public image URLs can pass through model text, Markdown rendering, history messages, and retry flows; checking only upload/display code misses these second-hop paths.
- Avoid next time: Before provider submission, always normalize media references back to plain model-readable URLs. Tests must cover historical attachments, model-produced `inputImageUrls`, and final `image_input`/`input_urls` payloads.

### Restarted cloud jobs are not final failures

- Symptom: Refresh/crash/restart leaves one-click cards marked failed or disappearing even though KIE may still be processing the provider task.
- Root cause: Cloud MySQL job reconciliation marked `running` jobs as `failed/service_restarted`, and the shell UI treated recoverable KIE timeout/restart responses as final failed history.
- Avoid next time: Reconcile restarted jobs back to `retry_waiting` when a provider task may still be recoverable. In the frontend, any KIE result with a recoverable task id should remain `generating`/pending sync until the backend explicitly returns a terminal failure.

### Long-running planning jobs must persist their project card immediately

- Symptom: A one-click planning task is visible as running in `internal_jobs`, but after browser crash/refresh the project card is gone.
- Root cause: The shell created the planning project only in React state and waited until planning success/failure to write `/api/state`; if Chrome crashed while `kie_chat` was running, the backend job survived but the project card had no stable shared-state record. Completed planning jobs are text-only, so they were also dropped by job hydration when no image URL existed.
- Avoid next time: Persist the planning project as soon as it is created, then persist again when the backend `jobId` is known. Running jobs can hydrate as fallback cards from `/api/jobs`; completed one-click `kie_chat` jobs may parse their text result back into selectable plans only when they match an existing persisted project placeholder. Never synthesize unpersisted completed planning jobs from `/api/jobs`, even if they are the newest one, or refresh will resurrect old策划 as ghost "处理中" cards. When a user deletes a job-backed card, persist the deleted backend `jobId` as a tombstone so `/api/jobs` history cannot rehydrate it on the next refresh.
- Every one-click planning `kie_chat` job must carry its shell project binding in the job payload (`shellPlanningPurpose`, `shellProjectId`, `subFeature`). This covers the crash window where the project placeholder has been saved but the later `backendJobId` write has not completed; hydration can reconnect by `shellProjectId` instead of creating an orphan job card.
- Terminal failed one-click jobs with no result URL must not be synthesized from `/api/jobs` unless they match an existing persisted project placeholder. Historical failed image jobs are logs, not project cards; otherwise refreshing can repopulate the workspace with old "图片结果待同步" failure cards.
- Refresh hydration should never open a project detail/plan modal by itself. Planning cards can show "打开确认生图", but `ProjectCard` must not auto-run `setDetailOpen(true)` just because restored data has `plans`; otherwise the latest recovered planning job becomes a random popup on page load.
- Deletion must be a real remote prune, not a draft-only write. `persistDeletionToSharedState` has to save the pruned state with replace semantics and keep `deletedProjectIds` / `deletedResultIds` / `deletedJobIds`; draft autosave must preserve those tombstones. Server-side state merge should apply tombstones before merging arrays, or old `shellProjects` / one-click branch projects will reappear after refresh.

### Shared state must not store recursive project history or inline images

- Symptom: `/api/state` grows into multi-MB or tens-of-MB payloads, making refresh slow and increasing Chrome out-of-memory risk.
- Root cause: One-click branch objects were copied into individual project records, nesting `projects` inside each project; translation history also stored `data:image/...base64` source previews.
- Avoid next time: Compact shared state before storage and client return. One-click saved projects must exclude branch-level `projects`, `activeProjectId`, and runtime flags; translation files must store remote URLs or lightweight metadata, not inline base64 previews.

### Browser-local recovery caches need size guards

- Symptom: A cloud account has a small `/api/state`, but Chrome can still show `Out Of Memory` while loading or running a long task.
- Root cause: The shell reads account-scoped `localStorage` runtime/draft snapshots synchronously before cloud hydration. If an older build left oversized or corrupted browser-local recovery data, the cloud database can look clean while the user's current browser still crashes.
- Avoid next time: Put byte limits in front of every browser-local recovery parse, discard oversized local snapshots, and log startup diagnostics with localStorage key sizes and JS heap figures so the next cloud investigation has evidence instead of guesses. Browser OOM cannot be logged at the exact crash moment; keep a local session heartbeat and report `frontend_previous_session_interrupted` on the next successful load when the previous session was not cleanly closed.

### Model submission must wait for uploaded material URLs

- Symptom: After uploading a material, generation immediately says the material has no model-readable public URL.
- Root cause: The shell optimistically adds a local `blob:` preview first and uploads the public URL in the background. Some generation paths submitted before the background upload had filled `remoteUrl`, or reused stored generation context that still contained only local draft material data.
- Avoid next time: Every generation entry point must run uploaded-material normalization immediately before provider submission. If a material only has `localAssetId`, load the draft blob from IndexedDB and upload it first; only pass remote/public URLs into `shellWorkflow` and model services.

### Cloud deployment requires code review every time

- Symptom: A fix reaches cloud without a fresh review of diff, data isolation, URL handling, logs/statistics, permissions, or task-chain impact.
- Root cause: Deployment was treated as a mechanical copy step instead of a guarded production release.
- Avoid next time: Do not deploy unless code review is complete. Use the deploy script only with `MEIAO_CODE_REVIEW_CONFIRMED=1`; the script intentionally blocks unconfirmed cloud releases.

## 2026-05-26 - Completed planning jobs must recover stale planning-failure cards

- Symptom: 多桑账号 2026-05-26 的“项目3/项目4”后台 `kie_chat` 策划 job 均已 `succeeded` 且 `result_json.content` 包含 `[SCHEME_START]... [SCHEME_END]`，但前端项目卡显示“共 1 张参考图，其中 1 张策划失败。”
- Environment: Tencent Cloud production, one-click first-image planning.
- Root cause: `waitForInternalJob` 轮询链路的瞬时查询失败被 `generateFirstImageReplicationSchemes` 包装成单参考图策划失败，丢掉了 backend job 已成功的信息；随后 shell hydration 又因为项目已有 error result 占位，拒绝用成功的 text-only `kie_chat` job 恢复 plans。
- Browser overwrite: 旧浏览器本地 `AIGC_APP_STATE` 可能在刷新后再次 PUT 回 stale error card，直接手工修库会被旧本地状态覆盖。
- Fix: `requestAnalysisResponseDetailed` 在非中断错误后用 `fetchInternalJob(job.id)` 做最终恢复查询；若 backend job 已成功，直接返回 content/credits/taskId，若仍在 running/queued/retry_waiting，则抛 `job_timeout` 让项目保持可同步状态。`shellDataAdapter` 允许成功的 planning job 替换无 backend 身份、无媒体 URL 的 stale 策划失败占位，并清空该占位 results。`mergeAppStateForStorage` 也必须保护“已有 plans 的 planning 项目”不被同 backendJobId 的旧策划失败占位覆盖。
- Regression check: `node --test server/appStateMerge.test.mjs src/services/arkService.test.mjs src/adapters/shellDataAdapter.test.mjs src/adapters/shellPersistence.test.mjs src/adapters/shellRuntimeMerge.test.mjs src/modules/OneClick/oneClickRecoveryBehavior.test.mjs src/components/uiArchitecture.test.mjs`
- Data repair: 已备份并修复多桑账号项目3/4，备份文件 `/www/backup/meiao-state-repair/duosang-planning-2026-05-26T03-01-57-986Z.json`。
- Follow-up repair: 旧浏览器覆盖后再次备份并修复，备份文件 `/www/backup/meiao-state-repair/duosang-planning-second-2026-05-26T03-09-26-281Z.json`。
- Avoid next time: 对 text-only planning job，前端轮询失败只能代表“同步失败”，不能代表“策划失败”。任何成功的 backend planning job 都必须能按 `shellProjectId`/`backendJobId` 回填 plans，即使前端此前已写入 stale error placeholder；服务端状态合并层也要防止旧浏览器本地快照反向覆盖云端恢复结果。

## 2026-05-26 - SKU planning backfill must survive replace-mode state writes

- Symptom: 多桑账号“5月26日项目6”SKU 策划后台 `kie_chat` 已输出 2 条 `[SCHEME_START]`，但前端生成后只显示 1 张图，项目计数为 `1/1`。
- Environment: Tencent Cloud production, one-click SKU planning + image generation.
- Root cause: 第一张 SKU 出图成功后，项目已有 completed result，前端 hydration 早退，不再用成功的 text-only planning job 回填缺失的第 2 条 plan；同时 `/api/state` 的 `mode: replace` 写入会绕过服务端深度合并，把云端已修复的 `plans: 2` 又覆盖回旧的 `plans: 0/taskCount: 1`。
- Fix: `shellDataAdapter` 对已存在部分出图结果的 completed `kie_chat` job 继续解析并回填全部 plans，所有解析出的 SKU plans 默认 selected；项目状态根据“是否还有 selected plan 没有 terminal result”回到 planning。`server/index.mjs` 不再让 replace-mode 直接覆盖 `/api/state`，统一走 `mergeAppStateForStorage`；`mergeArrayByStableKeys` 对重复 scheme/result 保留 incoming 的同时补齐 existing 的 `planId` 等身份字段。
- Regression check: `node --test server/appStateMerge.test.mjs src/adapters/shellDataAdapter.test.mjs src/services/arkService.test.mjs src/adapters/shellPersistence.test.mjs src/adapters/shellRuntimeMerge.test.mjs src/modules/OneClick/oneClickRecoveryBehavior.test.mjs src/components/uiArchitecture.test.mjs`; `npm run build`.
- Data repair: 已备份并修复多桑项目6，最终备份文件 `/www/backup/meiao-state-repair/duosang-sku-project6-2026-05-26T04-01-25-682Z.json`；恢复后 shell 项目为 `taskCount: 2/completedCount: 1/planCount: 2`，SKU 分支为 2 条 scheme：第 1 条 completed、第 2 条 planning。
- Avoid next time: 不能用“已有一个 completed result”判断 planning job 不需要回填；SKU/批量策划的 text job 是任务总数来源。所有全量保存路径即使叫 replace，也必须保护云端已恢复的 backend-bound plans/results，删除应依赖 tombstone，而不是直接信任旧浏览器快照。
