# Prompt RTCFE 迁移对照检查文档

更新日期：2026-04-29

本文档用于把项目内所有长期维护的 prompt 统一迁移到 RTCFE 结构。当前阶段只做对照审查，不直接改运行中的 prompt。你确认本文档无遗漏后，再按本文档逐项落地修改。

重要说明：
- 本文档只负责 Prompt 层，不负责代码层。
- 项目里的状态管理、项目管理、并发执行、编辑回写、预设保存、任务分叉、持久化恢复，不属于 RTCFE Prompt 规范，而属于程序行为规则。
- 如果要区分一键主详链路中“哪些是 Prompt 规则、哪些是代码规则、哪些是边界责任”，请同时查看：
  - `docs/one-click-prompt-code-boundary-guide.md`

## 1. 长期规范

所有新写或重写的 prompt 必须按 RTCFE 五段组织。RTCFE 是 prompt 的固定数据结构，不是普通排版建议。

```text
R Role 角色
- 激活领域知识。
- 说明模型应该以什么专家身份工作。

T Task 任务
- 说明核心工作。
- 说明本次要产出什么，不要把约束混在任务里。

C Constraint 约束
- 写清边界、禁忌、优先级、不可改动项。
- 历史修好的规则必须放在这里，不能散落在段落里。

F Format 格式
- 写清输出结构、字段名、标题、正文、标签、JSON schema。
- 原有解析依赖的字段、标签、数组结构必须保持不变。

E Example 示例
- Few-shot 样例。
- 示例只能说明格式和质量标准，不得引入新业务事实。
```

### 1.1 改写原则

- 只做结构化重排，不做语义发挥。
- 原 prompt 的输出字段、标签、JSON 结构、解析锚点必须保留。
- 原 prompt 的禁忌规则必须全部保留，尤其是文案输出规范、产品一致性、比例、素材角色、参考图、人物、logo、禁止编造等规则。
- 如果某个 prompt 暂时没有 Example，也要保留 `E Example 示例` 段，写明“无业务样例，仅按 Format 输出”，或补一个不改变业务事实的最小格式样例。
- 修改 prompt 时必须同步或新增防回归测试，至少覆盖字段、标签和关键约束。

### 1.2 统一骨架

```text
R Role 角色
你是……

T Task 任务
你需要……

C Constraint 约束
1. ……
2. ……

F Format 格式
只输出……
字段必须包含……

E Example 示例
……
```

## 2. 全局不可丢规则

这些规则在迁移中必须作为受保护资产，不能被“优化”掉。

- 产品一致性：不得改变产品外观、结构、包装、标签、logo、颜色分区、可见产品元素。
- 文案输出规范：文案排版必须严格按指定输出规范和示例输出；只有中文引号内文字是最终渲染正文，括号内是字体、字号字重、位置、颜色色值等排版要求，字段名、冒号、说明文字、示例标签不得出现在最终画面中。
- 文案格式禁忌：不得输出旧格式或自由格式，例如 `•主文案：「正文」— 字体、字号、位置、颜色`、`角色名：正文（要求）`、没有括号要求的散文式文案。
- 目标语言：最终出现在画面中的文案必须使用目标文案语言，除非用户明确要求保留原文。
- 比例规则：主图、首图、详情、视频、分镜板的比例来源必须保持当前逻辑，不得让 AI 幻觉改比例。
- 素材角色：商品主体图、赠品图、风格参考图、品牌 logo 图、历史生成图的角色必须区分。
- 品牌 logo：logo 图只用于识别和还原我方品牌，不得把竞品或他牌 logo 带入最终画面。
- 禁止编造：不得编造价格、折扣、促销、赠品、库存、产品功能、场景事实。
- 输出可解析：JSON、`[SCHEME_START]`、`[SCHEME_END]`、`<CONFIG_CHANGES>` 等解析锚点必须保持。

## 3. Prompt 清单总览

| 编号 | 模块 | 文件 | 函数或位置 | 类型 | 是否迁移 |
|---|---|---|---|---|---|
| P01 | 一键主详 | `services/arkService.ts` | `analyzeOneClickReferenceSet` | 参考图分析 prompt | 待确认 |
| P02 | 产品精修 | `services/arkService.ts` | `analyzeRetouchTask` | 精修分析 prompt | 待确认 |
| P03 | 一键主图/详情 | `services/arkService.ts` | `generateMarketingSchemes` | 主图/详情策划 prompt | 待确认 |
| P04 | 一键 SKU | `services/arkService.ts` | `generateSkuSchemes` | SKU 策划 prompt | 待确认 |
| P05 | 买家秀 | `services/arkService.ts` | `generateBuyerShowPrompts` | 买家秀策划 JSON prompt | 待确认 |
| P06 | 买家秀 | `services/arkService.ts` | `generatePureEvaluations` | 买家评价文案 prompt | 待确认 |
| P07 | 短视频 | `services/arkService.ts` | `generateVideoScript` | 视频分镜 JSON prompt | 待确认 |
| P08 | 出海翻译 | `services/kieAiService.ts` | `buildKieAiPrompt` | 翻译/去文案图像 prompt | 待确认 |
| P09 | 一键首图 | `modules/OneClick/FirstImageSubModule.tsx` | `triggerNewKieTask` | 首图生图 prompt | 待确认 |
| P10 | 一键主图 | `modules/OneClick/MainImageSubModule.tsx` | `triggerNewKieTask` | 主图生图 prompt | 待确认 |
| P11 | 一键详情 | `modules/OneClick/DetailPageSubModule.tsx` | `triggerNewKieTask` | 详情单屏生图 prompt | 待确认 |
| P12 | 一键 SKU | `modules/OneClick/SkuSubModule.tsx` | `buildSkuPrompt` | SKU 生图 prompt | 待确认 |
| P13 | 一键文案 | `modules/OneClick/generationPromptUtils.ts` | `appendOneClickCopyGuardrails` | 文案渲染护栏 | 待确认 |
| P14 | 买家秀 | `modules/BuyerShow/BuyerShowModule.tsx` | `triggerNewKieTask` | 买家秀生图 prompt | 待确认 |
| P15 | 产品精修 | `modules/Retouch/RetouchModule.tsx` | `finalPrompt` 组装 | 精修生图 prompt | 待确认 |
| P16 | 视频分镜 | `services/videoStoryboardService.ts` | `buildScriptRequestPrompt` | 分镜脚本 JSON prompt | 待确认 |
| P17 | 视频分镜 | `services/videoStoryboardService.ts` | `buildBoardPrompt` | 分镜板生图 prompt | 待确认 |
| P18 | 小红书封面 | `modules/XhsCover/xhsCoverUtils.mjs` | `buildXhsCoverPrompt` | 封面生图 prompt | 待确认 |
| P19 | 智能体知识库 | `server/index.mjs` | `buildKnowledgeNormalizationPrompt` | 知识整理 prompt | 待确认 |
| P20 | 视频诊断 | `server/index.mjs` | `buildVideoDiagnosisAnalysisPrompt` | 内容诊断 JSON prompt | 待确认 |
| P21 | 智能体生图 | `server/index.mjs` | `buildImageGenerationAnalysisMessages` | 生图参数分析 prompt | 待确认 |
| P22 | 智能体生图 | `server/index.mjs` | `buildImagePromptReferenceText` + final prompt | 智能体图像生成 prompt | 待确认 |
| P23 | 智能体训练 | `server/index.mjs` | `STUDIO_CONFIG_ASSISTANT_PROMPT` | 训练助手配置 prompt | 待确认 |
| P24 | Provider 网关 | `server/providerGateway.mjs` | `buildKieAspectRatioPromptHint` | 比例补充短 prompt | 待确认 |

说明：测试文件中的 prompt fixture 不作为源 prompt 迁移对象，但迁移后要同步更新或新增测试。

## 4. 分模块对照

### P01 一键参考图分析

- 文件：`services/arkService.ts`
- 位置：`analyzeOneClickReferenceSet`
- 当前用途：分析设计参考图，只输出用户勾选维度对应栏目。
- 当前输出结构：按维度输出 `- 视觉风格：`、`- 字体：`、`- 色调：`、`- 排版：`、`- 文案内容：`。
- 关键约束：
  - 只分析用户勾选的参考维度。
  - 不分析产品功能、人群和商品定位。
  - 未勾选维度不要输出。
  - 勾选文案内容时，只提炼可复用表达，不照抄不可复用品牌名或商品名。
  - 结论必须可直接进入后续策划。
- RTCFE 改写重点：
  - R：电商视觉参考图分析师。
  - T：按勾选维度提炼可复用设计规则。
  - C：未勾选不输出，不做产品分析，不编造。
  - F：保留现有五类 `- xxx：` 输出格式。
  - E：给一个只包含勾选维度的短样例。
- 你确认：`[ ]`

### P02 产品精修分析

- 文件：`services/arkService.ts`
- 位置：`analyzeRetouchTask`
- 当前用途：根据原图和可选参考图输出专业精修指令。
- 当前输出结构：英文精修指令，按模式包含 `[主体白底精修]` 或 `[画面内容调整]` 等模块。
- 关键约束：
  - 严禁改变品牌 logo、标签文字内容。
  - 原图精修必须基于原图连续性，不得重新设计新画面。
  - 禁止随意替换主体、场景、拍摄角度、构图关系。
  - 无明确要求不得新增背景、道具、装饰或额外产品。
  - 白底模式和原图精修模式的输出模块不同。
- RTCFE 改写重点：
  - R：商业摄影修图师和视觉总监。
  - T：分析原图并输出精修指令。
  - C：主体保真、原图连续性、模式差异。
  - F：保留英文输出和当前模块名。
  - E：给白底和原图模式各一个最小结构样例。
- 你确认：`[ ]`

### P03 一键主图/详情策划

- 文件：`services/arkService.ts`
- 位置：`generateMarketingSchemes`
- 当前用途：为主图或详情页输出多屏营销策划方案。
- 当前解析锚点：每屏必须由 `[SCHEME_START]` 和 `[SCHEME_END]` 包裹。
- 当前输出字段：
  - `屏序/类型`
  - `设计意图`
  - `画面风格`
  - `画面描述`
  - `文案内容排版`
  - `画面比例`
- 文案内容排版输出规范：

```text
-文案内容排版：
主标题（字体，字号字重，位置，颜色色值）：“xxx”
其他内容（字体，字号字重，位置，颜色色值）：“xxx”
...
```

- 文案内容排版示例：

```text
-文案内容排版：
主标题（宋体，28pt Bold，画面顶部居中，#3d3d3d）：“全屋持久留香”
副标题（黑体，16pt Light，主标题下方居中，#000000）：“法式沙龙调香，持续散香”
点缀（潇洒手写体，16pt Medium，右上角，#ff6600）：“love potion”
```

- 关键约束：
  - 全套视觉统一。
  - 禁止编造促销活动、价格、赠品等未提供信息。
  - 主图比例必须服从用户指定全局比例。
  - 详情页 Auto 比例需要按单屏内容智能填写，严禁整套默认 9:16，严禁输出 auto。
  - Amazon/Walmart/Ebay 主图 1 需遵守白底、无文字、无 logo、无水印、主体占比 85% 等合规倾向。
  - TikTok/Shopee/Lazada/淘宝/拼多多主图 1 强化点击欲望。
  - 文案内容排版必须严格按“文案内容排版输出规范”和“文案内容排版示例”输出。
  - 圆括号内必须依次写字体、字号字重、位置、颜色色值；圆括号内容不渲染。
  - 中文引号内才是最终渲染正文。
  - 不得把文案信息混入画面描述。
  - 风格参考只提炼设计语言，不替代产品主体。
  - logo 图只用于我方品牌识别和还原。
- RTCFE 改写重点：
  - R：顶级电商视觉总监。
  - T：为指定平台策划主图系列或详情页长卷方案。
  - C：拆成“产品一致性、平台规则、比例规则、文案规则、logo 规则、禁止编造”。
  - F：完整保留 `[SCHEME_START]`、字段名和字段顺序。
  - E：给一屏最小样例，样例必须使用本文档中的文案内容排版示例结构。
- 你确认：`[ ]`

### P04 一键 SKU 策划

- 文件：`services/arkService.ts`
- 位置：`generateSkuSchemes`
- 当前用途：为多个 SKU 组合策划展示图方案。
- 当前解析锚点：每个 SKU 方案必须由 `[SCHEME_START]` 和 `[SCHEME_END]` 包裹。
- 当前输出字段：
  - `SKU标识`
  - `画面风格`
  - `画面描述`
  - `文案内容排版`
  - `画面比例`
- 文案内容排版输出规范：

```text
-文案内容排版：
主标题（字体，字号字重，位置，颜色色值）：“xxx”
其他内容（字体，字号字重，位置，颜色色值）：“xxx”
...
```

- 文案内容排版示例：

```text
-文案内容排版：
主标题（宋体，28pt Bold，画面顶部居中，#3d3d3d）：“全屋持久留香”
副标题（黑体，16pt Light，主标题下方居中，#000000）：“法式沙龙调香，持续散香”
点缀（潇洒手写体，16pt Medium，右上角，#ff6600）：“love potion”
```

- 关键约束：
  - 严格区分商品主体图、赠品图、风格参考图。
  - 画面描述提及商品时必须同时标注身份和名称，例如 `【主体商品】名称`、`【赠品】名称`。
  - 正确理解规格与 SKU 数量换算。
  - SKU 文案必须完整书写，不得省略。
  - 有产品信息时主标题可提炼，无产品信息时直接使用 SKU 文案作为主标题。
  - 赠品不能喧宾夺主。
  - 禁止擅自新增未在 SKU 列表或产品信息中出现的新文案。
  - 禁止同一卖点换说法重复写多次。
- RTCFE 改写重点：
  - R：SKU 组合展示图策划视觉总监。
  - T：逐 SKU 输出可执行展示图方案。
  - C：素材角色、数量换算、赠品占比、文案来源。
  - F：保留 `[SCHEME_START]` 和字段。
  - E：给一个 SKU 方案样例，样例必须使用本文档中的文案内容排版示例结构。
- 你确认：`[ ]`

### P05 买家秀策划

- 文件：`services/arkService.ts`
- 位置：`generateBuyerShowPrompts`
- 当前用途：生成一套买家秀图片任务 JSON 和一条评价。
- 当前输出结构：JSON only。

```json
{
  "tasks": [
    {
      "prompt": "English visual description",
      "style": "中文简短描述",
      "hasFace": true
    }
  ],
  "evaluation": "native-language review"
}
```

- 关键约束：
  - 产品核心信息是唯一依据，严禁编造或偏离。
  - 场景必须适合目标市场。
  - 画面必须干净、整洁、自然生活感，不要脏乱、垃圾、暗光。
  - 多图要构成完整故事，覆盖环境、细节、使用互动。
  - includeModel=true 时第一张是基准图，后续保持一致。
  - includeModel=false 时禁止人脸和人体，可用手部。
  - 有参考图时严格参考风格、色调、场景类型、人物气质，但不能复制构图。
- RTCFE 改写重点：
  - R：真实电商买家秀 UGC 策划专家。
  - T：输出图片任务 JSON 和一条评价。
  - C：目标市场、产品依据、场景整洁、人物策略、参考图策略。
  - F：保留 JSON schema。
  - E：给一个 1 task 的 JSON 样例。
- 你确认：`[ ]`

### P06 买家评价文案

- 文件：`services/arkService.ts`
- 位置：`generatePureEvaluations`
- 当前用途：生成 5 条本地化买家评价。
- 当前输出结构：JSON array of strings。
- 关键约束：
  - 以目标国家本地消费者口吻。
  - 使用目标国家母语。
  - 输出 distinct authentic reviews。
- RTCFE 改写重点：
  - F 必须保留纯 JSON 字符串数组。
  - E 给 `["评价1", "评价2"]` 格式样例。
- 你确认：`[ ]`

### P07 视频分镜脚本

- 文件：`services/arkService.ts`
- 位置：`generateVideoScript`
- 当前用途：策划产品短视频分镜脚本。
- 当前输出结构：

```json
{
  "scenes": [
    {
      "Scene": "详细画面描述",
      "duration": 5
    }
  ]
}
```

- 关键约束：
  - 开场 3 秒抓住眼球。
  - 根据产品卖点视觉化呈现。
  - 分镜切换自然。
  - `Scene` 严禁提及文字和字幕。
- RTCFE 改写重点：
  - F 保留 `scenes` 数组、`Scene` 大写字段和 `duration`。
  - E 给最小 JSON 样例。
- 你确认：`[ ]`

### P08 出海翻译与去文案

- 文件：`services/kieAiService.ts`
- 位置：`buildKieAiPrompt`
- 当前用途：为翻译、保留原文、去文案生成图像处理 prompt。
- 当前模式：
  - `isRemoveText=true`：清除非包装表面文字。
  - `KEEP_ORIGINAL`：严格保留所有原始文本文案。
  - 默认：将所有文本文案翻译成目标语言。
- 关键约束：
  - 仅允许保留产品/包装表面的字符不变。
  - 不得更改图像主体内容和主题。
  - 去文案模式必须清除全图文字、字符、数字，但保留产品包装表面文字。
  - 主图模式下可保持原图比例，非 1:1 原图严禁生成 1:1 方图。
  - 输出高清商业工作室品质。
- RTCFE 改写重点：
  - C 中拆分三种模式约束。
  - F 不要求 JSON，输出给图像模型的执行指令即可。
- 你确认：`[ ]`

### P09/P10/P11 首图、主图、详情生图

- 文件：
  - `modules/OneClick/FirstImageSubModule.tsx`
  - `modules/OneClick/MainImageSubModule.tsx`
  - `modules/OneClick/DetailPageSubModule.tsx`
- 位置：各自 `triggerNewKieTask`
- 当前用途：把已编辑策划方案转成最终生图 prompt。
- 当前共同结构：
  - 产品一致性英文前缀。
  - `SCENARIO & STYLE: ${cleanPrompt}`。
  - 高端商业棚拍质量。
  - 竞品 logo 去除和我方 logo 还原。
  - 追加 `appendOneClickCopyGuardrails`。
- 需要统一追加的文案内容排版规范：

```text
-文案内容排版：
主标题（字体，字号字重，位置，颜色色值）：“xxx”
其他内容（字体，字号字重，位置，颜色色值）：“xxx”
...
```

- 需要统一追加的文案内容排版示例：

```text
-文案内容排版：
主标题（宋体，28pt Bold，画面顶部居中，#3d3d3d）：“全屋持久留香”
副标题（黑体，16pt Light，主标题下方居中，#000000）：“法式沙龙调香，持续散香”
点缀（潇洒手写体，16pt Medium，右上角，#ff6600）：“love potion”
```

- 关键差异：
  - 首图和主图：强制使用全局配置比例，忽略文本中的比例。
  - 详情：从单屏文本提取 `画面比例`，没有则回退到 `scheme.extractedRatio` 或 `3:4`。
- 关键约束：
  - 严格保持产品与源参考图一致。
  - 不改变外观、尺寸、结构、标签、包装、可见元素。
  - 风格参考图不作为 image input，产品图和 logo 图作为输入。
  - 产品素材中的竞品 logo 或他牌标识必须去除或替换为我方 logo。
  - 文案渲染护栏必须保留。
- RTCFE 改写重点：
  - 三个文件可以统一抽出共享 `buildOneClickImagePrompt`，但首图/主图/详情比例规则必须分开保留。
  - F 是给图像模型的连续指令，不是 JSON。
  - E 给一个包含 `SCENARIO & STYLE` 和文案护栏的最小样例。
- 你确认：`[ ]`

### P12 SKU 生图

- 文件：`modules/OneClick/SkuSubModule.tsx`
- 位置：`buildSkuPrompt`
- 当前用途：把 SKU 展示方案转成最终生图 prompt。
- 当前输入结构：
  - 素材清单。
  - 产品信息。
  - SKU 展示方案。
  - 首张或后续 SKU 的风格参考。
- 需要统一追加的文案内容排版规范：

```text
-文案内容排版：
主标题（字体，字号字重，位置，颜色色值）：“xxx”
其他内容（字体，字号字重，位置，颜色色值）：“xxx”
...
```

- 需要统一追加的文案内容排版示例：

```text
-文案内容排版：
主标题（宋体，28pt Bold，画面顶部居中，#3d3d3d）：“全屋持久留香”
副标题（黑体，16pt Light，主标题下方居中，#000000）：“法式沙龙调香，持续散香”
点缀（潇洒手写体，16pt Medium，右上角，#ff6600）：“love potion”
```

- 关键约束：
  - 严格保持所有商品与赠品和参考图一致。
  - 严格区分素材类型。
  - 后续 SKU 必须严格保持第一张生成结果的风格。
  - 文案语言硬约束。
  - 主体商品最显眼，赠品辅助点缀。
  - 赠品可更小，但必须正面陈列。
  - 商品和赠品禁止躺放、斜放、倾倒。
- RTCFE 改写重点：
  - C 中保护“第一张作为风格基准”和“赠品不能喧宾夺主”。
  - F 输出图像模型执行指令。
- 你确认：`[ ]`

### P13 一键文案渲染护栏

- 文件：`modules/OneClick/generationPromptUtils.ts`
- 位置：`appendOneClickCopyGuardrails`
- 当前用途：给一键主详和 SKU 生图 prompt 追加统一文案规则。
- 当前规则：
  - 画面文案语言为目标语言。
  - 逐字渲染展示方案中的文案，禁止翻译或替换语言。
  - 文案内容排版必须严格按输出规范和示例输出。
  - 圆括号内必须依次写字体、字号字重、位置、颜色色值，且不渲染。
  - 中文引号内文字是正文。
  - 字段名、冒号、说明文字不渲染。
- RTCFE 改写重点：
  - 这是全局受保护护栏，建议保留为独立函数。
  - 可改成固定 `C Constraint` 片段。
  - 必须有测试防止被删。
- 你确认：`[ ]`

### P14 买家秀生图

- 文件：`modules/BuyerShow/BuyerShowModule.tsx`
- 位置：`triggerNewKieTask`
- 当前用途：把买家秀 task prompt 转成最终图像生成 prompt。
- 当前结构：
  - iPhone 日常快照质感。
  - 参考图策略。
  - 人物/静物模式。
  - 产品一致性和真实场景融合。
  - `SCENE` 或 `NEXT SHOT`。
- 关键约束：
  - 非专业摄影、真实用户随手拍，但不脏乱。
  - 第一张匹配参考图氛围，不复制构图。
  - 后续图延续同一真实生活 session。
  - 人物必须是目标市场真实本地用户气质。
  - 静物模式无人。
  - 产品包装、品牌、色块、标签、logo、结构完全一致。
  - 产品真实物理尺寸，真实接触阴影，环境光照合理。
- RTCFE 改写重点：
  - C 必须保留“产品不是被重新设计的合成图”这一组规则。
  - F 输出图像模型执行指令。
- 你确认：`[ ]`

### P15 产品精修生图

- 文件：`modules/Retouch/RetouchModule.tsx`
- 位置：`finalPrompt` 组装。
- 当前用途：把分析得到的精修指令和严格标准组合成图像生成 prompt。
- 当前结构：
  - 待精修图和参考图说明。
  - `【核心精修指令】`。
  - 严格标准。
- 关键约束：
  - 需要保留分析结果 `analysis.description`。
  - 需要保留严格标准中的主体、logo、标签和商业质感规则。
- RTCFE 改写重点：
  - R：商业精修执行专家。
  - T：按分析指令执行精修。
  - C：保真、禁止重设计、参考图仅作效果参考。
  - F：图像模型执行指令。
- 你确认：`[ ]`

### P16 视频分镜脚本生成

- 文件：`services/videoStoryboardService.ts`
- 位置：`buildScriptRequestPrompt`
- 当前用途：生成连续分镜 JSON 数组。
- 当前输出结构：只输出 JSON 数组，每个对象必须包含 `description`、`prompt`、`script`。
- `script` 格式：
  - `分镜X（时长）`
  - `画面：...`
  - `动作：...`
  - `口播：...`
- 关键约束：
  - 必须输出刚好指定数量对象。
  - 按视频时间顺序排列。
  - description 是静态分镜画面，不是视频运镜。
  - 禁止字幕、logo、水印。
  - `prompt` 用于分镜板生成，产品与参考图一致。
  - 画面和动作中文，口播使用目标国家/语言。
  - 口播长度匹配镜头时长。
  - 爆款裂变模式要按参考爆款视频节奏做商品替换式裂变。
- RTCFE 改写重点：
  - F 必须严格保留 JSON 数组和 `script` 内部格式。
  - E 给一个单对象样例。
- 你确认：`[ ]`

### P17 分镜板生图

- 文件：`services/videoStoryboardService.ts`
- 位置：`buildBoardPrompt`
- 当前用途：把多个连续分镜一次性生成单张分镜板。
- 关键约束：
  - 输出单张完整分镜板，不是单格分开生成。
  - 所有格子产品一致，光影、色彩、风格统一。
  - 格子统一尺寸、统一比例。
  - 固定宫格数量和行列，顺序从左到右、从上到下。
  - 禁止字幕、logo、水印。
  - 不可缺格，不可多格。
  - 每格明显不同，但属于同一支视频连续内容。
- RTCFE 改写重点：
  - C 中保护宫格尺寸、数量、顺序。
  - F 输出图像模型执行指令。
- 你确认：`[ ]`

### P18 小红书封面

- 文件：`modules/XhsCover/xhsCoverUtils.mjs`
- 位置：`buildXhsCoverPrompt`
- 当前用途：组合风格 prompt、标题、副标题、字体、装饰和额外要求。
- 关键约束：
  - 仅允许使用用户提供的标题与副标题作为主要文案。
  - 不得新增英文主标题、拼音标题或替代文案。
  - `sanitizeStylePrompt` 会清理风格 prompt 中可能冲突的标题规则。
- RTCFE 改写重点：
  - C 必须保护“标题不可翻译成英文或被英文替代”。
  - F 输出图像模型执行指令。
  - E 给一个标题、副标题样例。
- 你确认：`[ ]`

### P19 知识库整理

- 文件：`server/index.mjs`
- 位置：`buildKnowledgeNormalizationPrompt`
- 当前用途：把规则、SOP 或规范性文档整理成更适合检索的结构化文本。
- 关键约束：
  - 必须保留原意。
  - 不得凭空新增规则。
  - 不得删掉关键限制。
  - 原文本身清晰时只轻量整理。
  - 只输出整理后的正文，不解释，不加代码块，不加前言。
- RTCFE 改写重点：
  - F 保留“只输出正文”。
  - E 给一个规则条目整理样例。
- 你确认：`[ ]`

### P20 视频诊断分析

- 文件：`server/index.mjs`
- 位置：`buildVideoDiagnosisAnalysisPrompt`
- 当前用途：根据 TikTok/抖音/小红书数据输出诊断分析。
- 当前输出结构：JSON，包含 `summary`、`overallRisk`、`sections`、`topActions`。
- 小红书 sections 当前包括：
  - `account_authority`
  - `content_performance`
  - `content_originality`
  - `commercial_signals`
  - `audience_targeting`
  - `growth_potential`
- 关键约束：
  - 必须基于已提供数据分析。
  - 风险等级使用指定枚举。
  - sections 字段结构必须可被前端解析。
- RTCFE 改写重点：
  - F 保留 JSON schema。
  - C 中说明“不得把缺失数据当事实”。
- 你确认：`[ ]`

### P21 智能体生图参数分析

- 文件：`server/index.mjs`
- 位置：`buildImageGenerationAnalysisMessages`
- 当前用途：把用户自然语言和图片引用整理成可执行生图参数 JSON。
- 当前输出字段：
  - `taskType`
  - `selectedImageModel`
  - `size`
  - `transparentBackground`
  - `inputImageUrls`
  - `imageReferences`
  - `prompt`
  - `reasoningSummary`
- 关键约束：
  - 严格按图 1、图 2、图 3 理解图片目录，不得自行改号。
  - 新上传图优先，其后历史上传图和历史生成图。
  - 用户明确说“把图1的 xx 换到图2”时，必须在引用和 reasoning 中对应。
  - 必须结合最近几轮对话理解“继续调整”“按上一版修改”等指代。
  - 默认 size 必须为 auto。
  - 只有用户明确指定比例，或明确表达比例修正诉求时，才允许修改 size。
  - 知识库规则优先于用户需求。
  - 只输出 JSON，不输出解释文字。
- RTCFE 改写重点：
  - C 中单独保护图片编号、比例、历史生成图主编辑对象规则。
  - F 保留全部 JSON 字段。
- 你确认：`[ ]`

### P22 智能体最终图像生成

- 文件：`server/index.mjs`
- 位置：`buildImagePromptReferenceText` 和 `finalPrompt`
- 当前用途：把参数分析结果转成最终图像模型 prompt。
- 当前结构：
  - 可选前缀：以最近一张历史生成图为主编辑对象。
  - 输入图顺序说明：`图1：URL=...，说明=...，角色=...`
  - `parsed.prompt` 或当前用户消息。
- 关键约束：
  - 输入图顺序说明必须保留。
  - 继续调整上一张时，上一张生成图是主编辑对象，新上传图只作版式/风格参考，除非用户明确要求替换主体。
- RTCFE 改写重点：
  - 可作为 F 前置说明或 C 约束片段，不要丢失顺序映射。
- 你确认：`[ ]`

### P23 智能体训练助手配置

- 文件：`server/index.mjs`
- 位置：`STUDIO_CONFIG_ASSISTANT_PROMPT`
- 当前用途：训练工作台助手给出建议，并在末尾输出待确认结构化改动。
- 当前解析锚点：`<CONFIG_CHANGES>[JSON数组]</CONFIG_CHANGES>`。
- 支持 field：
  - `systemPrompt`
  - `openingRemarks`
  - `knowledgeBaseIds`
  - `modelPolicy`
  - `retrievalPolicy`
  - `knowledgeDocument`
- 关键约束：
  - 助手不是直接执行修改。
  - 建议阶段不得说“已经修改完成”。
  - 如果只是答疑，不输出 `CONFIG_CHANGES`。
  - 删除知识库文档必须提供 `documentId`。
  - 不要输出不可执行空字段。
- RTCFE 改写重点：
  - F 必须保留 `<CONFIG_CHANGES>` 标签和 JSON 数组 schema。
  - C 中保护“不直接执行，只建议”。
- 你确认：`[ ]`

### P24 Provider 比例短 prompt

- 文件：`server/providerGateway.mjs`
- 位置：`buildKieAspectRatioPromptHint`
- 当前用途：为 provider 补充最终画面比例提示。
- 当前输出：`最终画面按 ${normalized} 比例构图生成。`
- 当前状态：`augmentImagePromptForModel` 对 `gpt-image-2` 暂未追加此 hint。
- RTCFE 改写重点：
  - 这是短规则片段，不一定强行扩写成完整 RTCFE。
  - 如果未来启用，应作为 C 约束片段追加，不要覆盖主 prompt。
- 你确认：`[ ]`

## 5. 落地顺序建议

建议按风险从高到低迁移：

1. 一键主详：P03、P04、P09、P10、P11、P12、P13。
2. 买家秀：P05、P06、P14。
3. 视频：P07、P16、P17。
4. 出海翻译和精修：P02、P08、P15。
5. 智能体和后台：P19、P20、P21、P22、P23。
6. Provider 短规则：P24。

## 6. 防回归测试要求

迁移后至少新增或更新以下测试：

- 一键主详 prompt 测试：
  - 保留 `[SCHEME_START]` 和 `[SCHEME_END]`。
  - 保留字段 `屏序/类型`、`设计意图`、`画面风格`、`画面描述`、`文案内容排版`、`画面比例`。
  - 保留文案内容排版输出规范：`主标题（字体，字号字重，位置，颜色色值）：“xxx”`。
  - 保留示例里的字体、字号字重、位置、颜色色值、中文引号结构。
  - 保留“圆括号不渲染，中文引号内文字才渲染，字段名、冒号、说明文字一律不渲染”。
  - 保留 logo 和竞品 logo 规则。
- SKU prompt 测试：
  - 保留 `【主体商品】` 和 `【赠品】` 标注规则。
  - 保留字段 `SKU标识`、`画面风格`、`画面描述`、`文案内容排版`、`画面比例`。
  - 保留 SKU 文案内容排版输出规范：`主标题（字体，字号字重，位置，颜色色值）：“xxx”`。
  - 保留 SKU 文案完整书写规则。
  - 保留赠品不能喧宾夺主、禁止躺放斜放倾倒。
- 买家秀 prompt 测试：
  - 保留 JSON schema。
  - 保留第一张基准图和后续一致性规则。
  - 保留包装 identity hard-lock。
- 视频 prompt 测试：
  - 保留 JSON schema。
  - 保留 `Scene` 严禁提及文字和字幕。
  - 保留分镜脚本的 `description`、`prompt`、`script` 字段。
  - 保留分镜脚本里 `画面`、`动作`、`口播` 的内部格式。
  - 保留分镜板宫格数量和顺序规则。
- 智能体 prompt 测试：
  - 保留默认 `size=auto` 规则。
  - 保留图片编号映射规则。
  - 保留 `<CONFIG_CHANGES>` 标签。

## 7. 你的审查方式

建议你按下面方式逐项看：

1. 先看第 2 节全局不可丢规则。
2. 再看第 3 节确认是否有遗漏的 prompt。
3. 最后看第 4 节逐项勾选。
4. 如果某项要补充规则，直接告诉我编号，例如：`P03 补充：主图1必须优先展示产品全貌`。
5. 你确认后，我再按第 5 节顺序落地改写，并同步补第 6 节测试。
