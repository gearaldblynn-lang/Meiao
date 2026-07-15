# 图片升级与产品还原功能设计

> 2026-07-15 修订：本文件中“整批共用 `sharedRestorationPrompt`”的分析输出、持久化和逐图生成约定，已由 [`2026-07-15-product-restore-per-target-prompts-design.md`](./2026-07-15-product-restore-per-target-prompts-design.md) 的 V2 逐图提示词协议取代。其他已确认的产品范围、上传限制、重点还原项、模型、分辨率、比例、状态和开放策略继续有效。

日期：2026-07-14

## 状态与交付边界

本设计已经过逐段确认。下一阶段先在本地当前版本实现并测试，不自动发布腾讯云，不修改线上配置，也不开放给线上普通用户。

本次将现有用户界面名称“产品精修”改为“图片升级”，但内部模块 ID 继续使用 retouch。新增 product_restore 子功能，原图精修、白底精修、历史项目、日志、积分和持久化合同继续复用现有 retouch 边界，不做数据库迁移。

## 背景与问题

用户已经通过 AI 生成一组主图、详情图或其他电商图片。这组图片的版式、文案、人物、背景和营销内容已经满足要求，但产品本体可能出现下列偏差：

- 产品形态、结构、比例或轮廓错误；
- 材质、纹理、颜色或光泽与实物不一致；
- Logo、标签、包装文字、关键部件或工艺细节失真；
- 多张套图中的产品表现不一致，存在消费者投诉风险。

产品还原的目标不是重新设计图片，也不是把产品替换成另一个产品，而是在严格保护现有画面与版式的前提下，让每张图中的同一 SKU 恢复为产品参考图所描述的真实产品。

## 目标

1. 将用户可见的一级功能名称改为“图片升级”。
2. 在图片升级下新增“产品还原”，并保留原图精修、白底精修和待制作的智能增强。
3. 一次任务只处理同一款产品或同一 SKU。
4. 一次上传最多 10 张待还原套图和 5 张产品参考图。
5. 先让系统设置中的分析模型查看全部两组素材，生成一份整批共用的结构化产品分析和通用还原提示词。
6. 分析成功后，为每张待还原图创建一个独立生图任务；N 张输入产生 N 个结果。
7. 每张结果自动继承对应待还原图的画面比例，不提供全局比例选择。
8. 产品还原最低提供 2K，模型支持时可选 4K，不显示或接受 1K。
9. 严格保护非产品区域；单张失败不阻断其他结果，并支持恢复、单张重试和批量下载。

## 非目标

- 不支持一次任务内混合多个 SKU，也不提供产品分组或图片到产品组的映射界面。
- 不允许产品参考图驱动新的构图、背景、人物、版式或营销设计。
- 不为产品还原增加用户可选的分析模型；分析模型继续跟随系统设置。
- 不增加出图后的第二个 AI 质检模型。视觉效果由用户通过原图与结果对比验收。
- 不重写现有原图精修、白底精修、万物替换或通用任务状态系统。
- 本地实现和测试完成后不自动部署云上；云上灰度需要后续明确授权。

## 已确认的产品决策

| 决策 | 结果 |
| --- | --- |
| SKU 范围 | 一次任务只允许同一 SKU |
| 还原选项语义 | 所有产品身份信息始终受保护；勾选项只决定重点修复方向 |
| 素材上限 | 待还原图最多 10 张，产品参考图最多 5 张 |
| 画面比例 | 每张结果自动跟随对应待还原图，不提供比例选择 |
| 分辨率 | 默认 2K；模型支持时可选 4K；隐藏并拒绝 1K |
| 默认重点项 | 默认勾选“形态与结构”“材质与纹理” |
| 分析后行为 | 分析成功后自动创建全部生图任务，不增加人工确认门 |
| 非产品区域 | 严格保护，只允许为自然融合修改必要的接触阴影、反射和遮挡边缘 |
| 实现方式 | 在 retouch 内建立隔离的 product_restore 工作流，不复用产品替换语义 |

## 用户界面

### 子功能与名称

图片升级下按以下顺序显示：

1. 原图精修；
2. 白底精修；
3. 产品还原；
4. 智能增强，继续标记为待制作。

所有用户可见的模块标题、空状态、导航名称和日志模块标签使用“图片升级”。内部路由、持久化和业务模块 ID 仍为 retouch。

### 产品还原专属素材角色

新增两个明确的素材类型，避免借用“风格参考”等相近但错误的业务语义：

- restoreTarget：待还原套图，一张输入对应一张结果；
- productReference：产品参考图，多张共同描述同一 SKU。

两个素材类型继续使用现有上传、草稿资产、托管素材和子功能作用域机制。它们必须带 subFeature=product_restore，不能出现在原图精修、白底精修或其他模块的素材集合中。

### 上传交互与上限

待还原套图最多 10 张，产品参考图最多 5 张。

上传前：

- 鼠标悬浮待还原图上传按钮时显示“最多 10 张，一图生成一个结果；画面比例按每张原图继承”。
- 鼠标悬浮产品参考图上传按钮时显示“最多 5 张，必须属于同一 SKU；建议包含正反面、多角度、局部细节和材质特写”。

上传时：

- 如果本次文件选择会超过剩余名额，拒绝本次整组选择。
- 提示“当前已有 X 张，还可上传 Y 张”。
- 不静默截取文件，避免用户误以为全部素材都已加入。

上传后：

- 两组标题持续显示“已上传 X/10”和“已上传 X/5”。
- 待还原图支持预览、删除和调整顺序，结果按该顺序展示。
- 产品参考图支持预览、删除和调整顺序；顺序仅决定发给模型的参考顺序，不改变结果数量。

### 重点还原项

首版包含六项：

- 形态与结构，默认勾选；
- 比例与轮廓；
- 材质与纹理，默认勾选；
- 颜色与光泽；
- Logo、标签与包装文字；
- 关键部件与工艺细节。

界面固定显示说明：“未勾选不代表允许改变。所有产品身份信息始终受保护，勾选项只决定本次重点修复方向。”

至少保留一个重点项。用户取消到零项时，最后一个已选项不允许被取消，并显示原因。

### 模型、分辨率与补充要求

- 生图模型来自现有图片模型目录，但只显示支持图片编辑、至少 6 张输入图且最高分辨率不低于 2K 的模型。
- 默认分辨率为 2K。
- 当前模型支持 4K 时显示 2K、4K；只支持 2K 时只显示 2K。
- 任何旧草稿或恢复数据中的 1K 在进入 product_restore 时归一为 2K，提交边界再次拒绝 1K。
- 不显示画面比例控件。每张任务使用当前待还原图作为第一输入，并以 auto 比例及原始宽高元数据约束模型。
- 不对生成结果做会改变画面内容的二次裁切或拉伸。结果页展示实际返回尺寸；模型不完全遵从输入比例时保留真实结果和实际尺寸，不伪造“像素级完全一致”的承诺。
- 补充要求为选填，例如“瓶盖透明度必须与产品图一致”。补充要求不能解除固定保护规则。

### 提交与项目显示

提交前必须满足：

- 至少 1 张 restoreTarget；
- 至少 1 张 productReference；
- 两组素材均已获得稳定云端地址；
- 当前分析模型支持图片输入；
- 当前生图模型满足多图编辑和 2K 下限；
- 至少一个重点还原项。

提交后项目卡依次显示：

- planning：用户文案“正在分析整套产品”；
- generating：用户文案“正在还原 X/N”；
- completed：全部成功；
- error 且有成功结果：用户文案“部分完成 X/N”；
- error 且无成功结果：用户文案“产品还原失败”。

项目详情提供：

- 每张待还原图与对应结果的并排对比；
- 通用还原提示词；
- 分析摘要；
- 重点还原项、模型、分辨率和实际输出尺寸；
- 单张重试、单张重新生成、下载单张和批量下载。

## 架构边界

### 稳定契约

- AppModule 继续使用 retouch。
- 新增 subFeature=product_restore。
- 项目、任务、素材和结果继续进入现有用户隔离、app_state、内部 job、积分、日志、删除和恢复链路。
- 不增加新数据库表，不迁移历史 retouch 数据。
- 不新增 analyzing 之类的全局任务状态。整批分析使用现有 Project.status=planning，并用结构化 taskPurpose 区分阶段。

### 独立单元

产品还原实现拆成四个边界清楚的单元：

1. 配置与输入校验：负责素材角色、数量、选项、模型和分辨率归一化。
2. 批次分析：负责一次性多模态分析和结构化结果解析。
3. 提示词构建：纯函数，根据分析结果、固定约束和当前图片信息生成 RTCFE 生图提示词。
4. 工作流编排：负责分析一次、建立 N 个图片任务、逐项回报、取消、恢复和重试。

工作流可以从现有 runShellRetouchWorkflow 路由进入，但 product_restore 的验证、分析、提示词和任务编排不写进原图精修与白底精修的分支内部。

## 数据与身份

### 项目生成上下文

在现有 OneClickGenerationContext 上增加可选 productRestore 字段。字段仅在 subFeature=product_restore 时出现，包含：

- version=1；
- analysisJobId 和 analysisProviderTaskId；
- analysisModel；
- normalizedAnalysis；
- sharedRestorationPrompt；
- focusOptions；
- targetMaterialIds 和 productReferenceMaterialIds；
- selectedImageModel 和 resolution；
- userRequirement；
- createdAt。

现有 prompt、params、materials 仍保留，确保通用恢复和重新生成能力不依赖新字段。productRestore 不保存 data URL 或 Blob，只保存托管素材身份、稳定 URL 和结构化文本。

### 内部 job 元数据

分析 job 使用：

- taskType=kie_chat；
- taskPurpose=product_restore_analysis；
- shellProjectId、shellProjectName、subFeature=product_restore；
- batchCount=待还原图数量；
- clientSubmissionKey。

每张图片 job 使用：

- taskType=kie_image；
- taskPurpose=product_restore_generation；
- shellProjectId、shellProjectName、subFeature=product_restore；
- batchIndex、batchCount；
- targetMaterialId；
- analysisJobId；
- clientSubmissionKey。

分析控制 job 明确绑定项目，但不生成图片 result，也不计入 Project.taskCount。Project.taskCount 永远等于待还原图数量。

### 结果身份

每张结果的稳定身份优先使用 backendJobId，其次 provider task ID，再次为本地结果 ID。batchIndex 固定对应 restoreTarget 上传顺序。刷新恢复、重试、删除和对账都使用这些结构化身份，不通过项目名或错误文字猜测。

## 批次分析

### 分析模型选择

分析模型继续读取系统公开配置中的 effectiveAnalysisModel，并把当前分析模型 fallback 目录作为同一个内部分析 job 的 provider 级备用模型。产品还原不增加用户选择入口，也不在一次成功但结构无效的响应后自动创建第二个内部分析 job。

提交前检查当前模型能力目录中的 supportsImageInput。若当前系统配置没有可用的视觉分析模型，直接提示“当前系统分析模型不支持图片输入，请联系管理员调整”，不创建 job。

### 输入顺序与角色

一次分析请求最多包含 15 张图片：

1. 全部 restoreTarget，逐张附加“待还原图 1…10”文本标签；
2. 全部 productReference，逐张附加“产品参考图 1…5”文本标签；
3. 重点还原项、补充要求和固定保护规则。

所有图片必须作为真实多模态 image_url content part 发送。提示词里出现 URL 文本不能替代图片输入。

### RTCFE 分析提示词

R Role：电商产品一致性还原分析师和产品摄影质检专家。

T Task：比较同一 SKU 的待还原套图和产品参考图，提取可验证的真实产品身份、共性偏差和整批共用的还原指令。

C Constraint：

- restoreTarget 只定义当前版式、背景、人物、构图、遮挡和错误产品表现；
- productReference 是产品身份的最高优先级依据；
- 不得复制产品参考图的背景、构图、镜头或场景；
- 多张产品参考图共同描述同一 SKU，不按参考图数量生成产品；
- 勾选项决定分析深度，未勾选项仍受保护；
- 产品参考图冲突时只采用清晰、重复出现且互不冲突的可验证特征；
- 不得补造看不清或没有证据的文字、Logo、纹理和部件。

F Format：只返回可解析 JSON。

E Example：示例只展示字段和粒度，不嵌入具体品牌或产品事实，避免模型照抄示例内容。

### 结构化输出

分析结果包含：

- productIdentitySummary：产品真实身份摘要；
- verifiedFeatures.shapeAndStructure；
- verifiedFeatures.proportionAndSilhouette；
- verifiedFeatures.materialAndTexture；
- verifiedFeatures.colorAndGloss；
- verifiedFeatures.logoLabelAndText；
- verifiedFeatures.componentsAndCraft；
- sharedDeviations：套图中的共性偏差；
- sharedRestorationPrompt：供全部图片共同使用的还原指令；
- forbiddenChanges：禁止改变的产品和非产品内容。

程序必须去除 Markdown 围栏后解析 JSON，并校验对象形状。productIdentitySummary、sharedRestorationPrompt、forbiddenChanges 缺失或为空时视为不可用结果。分析模型原始正文可以进入脱敏技术日志，但项目只持久化归一化结果。

## 逐图生图

### 输入组合

每个生图任务的 input image 顺序固定为：

1. 当前 restoreTarget；
2. 全部 productReference，按用户排列顺序。

因此每个任务最多 6 张输入图，低于当前可选生图模型的输入上限。工作流不得把其他待还原图加入某一张的生图输入，避免不同版式互相污染。

### RTCFE 生图提示词

R Role：电商产品一致性还原执行模型。

T Task：只修复当前待还原图中的产品，使产品身份与产品参考图一致，同时保持当前图片的版式和非产品内容。

C Constraint 固定包含：

- 产品参考图中的真实产品身份优先；
- 当前待还原图的产品数量、位置、视角、遮挡关系和画面构图保持；
- 背景、人物、营销文案、排版、装饰和其他非产品元素不得重绘；
- 只允许修改产品本体、产品边缘，以及自然融合所必需的接触阴影、反射和遮挡边缘；
- 不得新增、删除、复制或替换产品；
- 不得编造不可读的 Logo、标签、包装文字和产品部件；
- 若补充要求与产品真实性或固定保护规则冲突，固定规则优先。

F Format：输出一张完整商业图片，画面比例跟随当前待还原图，分辨率使用当前任务的 2K 或 4K。

E Example：用抽象例子说明“允许修正瓶身轮廓与材质，不允许重排标题或更换背景”，不包含具体产品事实。

提示词按以下优先级组装：

1. 产品参考图中的真实产品身份；
2. 当前待还原图的版式、位置、视角、遮挡和场景；
3. 用户勾选的重点还原项；
4. 用户补充要求。

分析模型提供 sharedRestorationPrompt，但程序始终在外层补齐固定 RTCFE 保护合同，不能让模型原文或用户补充要求覆盖硬约束。

### 任务创建和并发

分析成功后立即为全部待还原图建立独立内部 job。前端不硬编码并发数；后端继续使用账号 jobConcurrency 和现有队列控制真实执行并发。界面可以立即看到全部任务身份，排队任务和运行任务都属于 generating。

对共同产品参考图继续复用现有托管素材直连、第三方兼容回退、上传限流和成功 URL 缓存。不得在工作流层再造一套素材转存机制。

## 失败、恢复与取消

### 上传失败

- 任一素材仍在上传时禁止提交。
- 单文件上传失败只重试该文件。
- 提交边界再次确认所有素材有稳定云端地址。

### 分析失败

产品还原分析是主产物必要步骤，与原图精修的辅助分析不同，因此不使用普通精修的 deterministic 通用 fallback。

- 分析 job 仍为 queued、running 或 retry_waiting：项目保持 planning，刷新后继续同步。
- 分析明确终态失败：项目为 error，不创建任何图片 job，提供“重新分析并继续”。
- provider_submission_unknown：不自动重复提交付费分析任务，保留 job 身份和可核对提示。
- 分析 job 成功但结构化内容不可用：直接按分析失败处理，不在应用层自动创建第二个付费分析 job；用户可以核对后手动执行“重新分析并继续”。
- 用户取消：取消分析 job，项目不进入生图阶段。

### 生图失败和部分成功

- 单张图片失败不阻断其他任务。
- 仍有 queued、running 或 retry_waiting 结果时，项目保持 generating。
- 全部终态且全部成功时为 completed。
- 全部终态且至少一张失败时为 error；若存在成功结果，用户文案为“部分完成 X/N”，成功结果正常保留、查看和下载。
- 单张重试复用已保存的 normalizedAnalysis、sharedRestorationPrompt、产品参考图和当前目标图，不重新执行整批分析。
- 用户更换产品参考图、重点项或补充要求时必须创建新项目，不修改旧项目的分析基准。

### 取消、删除和刷新恢复

- 取消整个项目时收集并取消项目分析 job、所有结果 backendJobId 和当前 task backendJobId。
- 已经成功的结果保留；尚未成功的任务进入现有取消语义。
- 删除项目继续使用现有墓碑和多 job 聚合删除机制。
- 刷新后通过 shellProjectId、taskPurpose、batchIndex、targetMaterialId 和 job 身份恢复，不用项目名或错误文字猜状态。
- 控制 job 只绑定已有项目，不允许生成 job-<id> 幽灵项目卡。

## 积分、日志与可观测性

### 积分

- 提交前按“待还原图片数量 × 当前模型与分辨率单价”展示预计生图积分。
- 分析和生图实际消耗继续以服务端内部 job ledger 为真源，前端不自行结算。
- 项目详情区分分析消耗、生图消耗和合计；上游没有返回实际消耗时不虚构数值。
- 单张重试只新增该图片任务的实际消耗记录，不重复记分析消耗。
- provider_submission_unknown 沿用现有不确定提交提示，不把“我方没收到结果”等同于“上游一定没扣费”。

### 结构化日志

至少记录：

- product_restore_batch_started；
- product_restore_analysis_started、succeeded、failed；
- product_restore_generation_created、succeeded、failed；
- product_restore_partial_completed；
- product_restore_single_retry；
- product_restore_cancelled。

日志字段包含用户、项目、分析 job、图片 job、batchIndex、batchCount、素材数量、重点项、模型、分辨率、provider task ID、耗时、实际积分和结构化错误码。不记录密钥、Authorization、完整敏感请求体或图片二进制。

## 功能开关与发布策略

使用单一环境变量 MEIAO_PRODUCT_RESTORE_ROLLOUT，取值：

- off：禁止新建产品还原任务；
- admin：只允许管理员新建；
- all：所有能够访问图片升级的已登录用户可新建。

无效值或未配置时按 off 处理。服务端公开配置只返回规范化 rollout 值，不暴露其他服务端配置。

开关只控制“新建任务”，不控制历史项目读取。即使回滚为 off，已有产品还原项目仍可进入详情、查看和下载结果，避免通过隐藏入口制造数据不可达。

本地开发时在未跟踪的 .env.server 中设为 admin 或 all。云上发布顺序为：

1. 部署代码并保持 off；
2. 验证原图精修、白底精修、health 和 PM2；
3. 改为 admin，只使用管理员测试账号做一次 2 张待还原图、3 张产品参考图、2K 的付费 canary；
4. 核对 job、provider task ID、日志、积分、持久化和结果；
5. 明确授权后改为 all。

本次只做到本地实现与测试，不执行上述云上步骤。

## 测试策略

实现阶段按 TDD 执行。至少覆盖以下合同。

### 纯函数和输入合同

1. product_restore 默认重点项为形态与结构、材质与纹理。
2. 至少保留一个重点项。
3. restoreTarget 上限 10、productReference 上限 5；超限整次拒绝并返回剩余数量。
4. product_restore 把旧 1K 归一为 2K，提交边界不接受 1K。
5. 模型列表只保留支持多图编辑、至少 6 图输入和至少 2K 的模型。
6. 当前模型支持 4K 时显示 2K/4K，只支持 2K 时只显示 2K。
7. 不生成比例选择参数；每张任务使用对应素材的原始尺寸元数据和 auto。

### 分析合同

8. 一次请求包含全部 restoreTarget 和 productReference，并为每张图片标明正确角色。
9. 所有图片作为 image_url content part，而不是仅写入提示词文本。
10. RTCFE 分析提示词包含同一 SKU、选中重点项和非产品保护规则。
11. 合法 JSON 被归一化；Markdown 围栏、空返、拒答、缺字段和错误正文被正确处理。
12. 分析未成功时不会创建任何图片 job。

### 生图与生命周期合同

13. N 张 restoreTarget 创建 N 个图片 job。
14. 每个 job 第一张输入是当前 restoreTarget，后续才是全部 productReference；不混入其他 restoreTarget。
15. 每张 prompt 包含产品身份、当前画面保护、重点项、补充要求和固定 RTCFE 约束。
16. 分析 job 不计入项目 taskCount，也不产生图片 result。
17. 单张重试复用分析结果，不重复创建分析 job。
18. 覆盖全部成功、部分失败、全部失败、queued/running/retry_waiting、取消、删除和刷新恢复。
19. 控制 job 不生成幽灵项目卡，前后端 taskCount、completedCount 和 status 保持一致。
20. 原图精修、白底精修和万物替换现有测试保持通过。

### 建议的定向验证命令

- node --experimental-strip-types --test src/shell/components/layout/BottomInputBar.test.mjs
- node --experimental-strip-types --test src/components/uiArchitecture.test.mjs
- node --experimental-strip-types --test src/adapters/shellControlJobLifecycle.test.mjs
- node --experimental-strip-types --test src/adapters/shellDataAdapter.test.mjs
- node --test src/services/arkService.test.mjs
- node --test server/appStateMerge.test.mjs server/jobRuntime.test.mjs
- npm run lint
- npm run build
- npm run verify

最终计划应将新增纯函数测试文件和精确 test-name-pattern 补充到这些命令中，避免只跑宽泛测试却没有覆盖新路径。

## 本地浏览器验收

本地启动当前版本后，使用真实浏览器完成：

1. 图片升级显示原图精修、白底精修、产品还原和待制作的智能增强。
2. 验证两个上传入口的悬浮提示、持续计数和超限整组拒绝。
3. 上传 10 张待还原图、5 张产品参考图，确认顺序和预览。
4. 验证默认重点项、补充选项、2K 默认值、1K 不可见、支持模型可选 4K。
5. 使用横图、方图和竖图混合套图，确认每张任务使用自身原图作为第一输入，结果没有统一强制比例。
6. 确认整批只产生一个内部分析控制 job，并产生与待还原图数量一致的图片 job；该控制 job 内部允许沿用现有 provider 级备用模型，但不得按待还原图重复分析。
7. 模拟单张失败，确认其他任务继续，项目显示部分完成，单张重试不重新分析。
8. 刷新页面，确认项目、通用提示词、素材身份和每张任务状态恢复。
9. 取消项目，确认全部已知未完成 job 被取消，成功结果保留。
10. 对比原图与结果，人工检查产品轮廓、结构、材质、纹理以及背景、人物、版式和营销文案稳定性。

若本地真实分析或生图会产生第三方费用，先使用合同测试和 mock 验证完整链路；真实付费冒烟只在用户明确同意具体模型、图片数量和分辨率后执行。

## 验收标准

- 用户可见一级名称为“图片升级”，内部 retouch 合同和历史数据不变。
- 产品还原严格区分待还原图与同一 SKU 产品参考图。
- 超限前有悬浮说明，超限时整次拒绝且提示剩余名额。
- 默认重点项、2K 起步、4K 条件显示和逐图比例继承符合已确认决策。
- 整批只创建一个内部分析控制 job，不按待还原图重复分析；结构无效时不创建生图任务。
- N 张待还原图建立 N 个独立生图任务，每张输入角色和顺序准确。
- 非产品保护规则无法被分析模型原文或用户补充要求覆盖。
- 部分失败不吞成功结果，单张重试不重复分析，刷新和取消可恢复。
- 旧精修路径、任务对账、删除、积分和日志合同没有回归。
- 定向测试、完整验证和本地浏览器验收都有本轮新鲜证据。
- 本轮不部署腾讯云。
