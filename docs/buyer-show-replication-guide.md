# 买家秀功能复刻说明

版本基准：`260407A`

本文档目标不是介绍产品，而是完整还原当前代码里的“买家秀”实现逻辑，让另一个 AI 读完后可以直接照着复刻同样的链路、状态结构、提示词规则、执行顺序和异常处理。

## 1. 功能定位

买家秀不是单次生图按钮，而是一条“两阶段流水线”：

1. 先用分析模型生成一整套买家秀策划方案。
2. 再按方案逐张调用生图模型出图。

其中“每套方案”的第 1 张图是基准图，后续图片都依赖这张基准图来保持整套一致性。

## 2. 关键文件

前端主模块：
- `modules/BuyerShow/BuyerShowModule.tsx`

前端配置面板：
- `modules/BuyerShow/BuyerShowSidebar.tsx`

策划模型服务：
- `services/arkService.ts`
  - `generateBuyerShowPrompts`
  - `generatePureEvaluations`

生图服务封装：
- `services/kieAiService.ts`
  - `processWithKieAi`
  - `recoverKieAiTask`

素材上传：
- `services/tencentCosService.ts`
  - `uploadToCos`

类型定义：
- `types.ts`
  - `BuyerShowPersistentState`
  - `BuyerShowSet`
  - `BuyerShowTask`
  - `ArkBuyerShowResult`

回归测试：
- `services/buyerShowPromptPriority.test.mjs`
- `modules/BuyerShow/buyerShowBehavior.test.mjs`

## 3. 数据结构

### 3.1 单张任务

`BuyerShowTask`

- `id`: 前端本地任务 ID
- `taskId`: Kie 内部任务 ID，可用于失败后找回
- `prompt`: 策划模型生成的英文生图描述
- `styleDescription`: 中文短描述，用于前端卡片展示
- `hasFace`: 是否明确包含可见人脸
- `status`: `pending | generating | completed | error | interrupted`
- `resultUrl`: 结果图地址
- `error`: 失败信息

### 3.2 单套方案

`BuyerShowSet`

- `id`: 套图 ID
- `index`: 第几套方案，从 1 开始
- `tasks`: 这一套里的多张图片任务
- `evaluationText`: 这一套对应的一条买家评价文案
- `status`: `pending | analyzing | generating | completed`

### 3.3 持久化状态

`BuyerShowPersistentState`

当前真正参与主链路的核心字段：

- `productImages`
- `uploadedProductUrls`
- `referenceImage`
- `uploadedReferenceUrl`
- `productFeatures`
- `targetCountry`
- `includeModel`
- `aspectRatio`
- `quality`
- `model`
- `imageCount`
- `setCount`
- `sets`
- `isAnalyzing`
- `isGenerating`

### 3.4 名义存在但当前基本未生效的字段

这些字段在类型或 UI 中存在，但当前主链路没有真正发挥作用，复刻时要明确区分：

- `referenceStrength`
  - UI 有，但没有进入策划 prompt，也没有进入生图 prompt。
- `userRequirement`
  - 类型中存在，但当前买家秀主链路没有使用。
- `subMode`
  - 在模块里解构了，但实际逻辑没有分支使用。
- `customCountry`
  - UI 支持填写自定义国家，但当前 prompt 实际使用的是 `targetCountry`。
  - 如果用户选择了 `CUSTOM`，当前实现会把 `targetCountry` 设为字面量 `CUSTOM`，因此这是一个未真正打通的字段。
- `pureEvaluations`
  - 有单独的文案生成函数，但当前买家秀主流程未使用。
- `firstImageConfirmed`
  - 当前主流程未使用。

## 4. 前端交互与工作流

### 4.1 用户输入项

来自 `BuyerShowSidebar.tsx`：

- 产品素材图
  - 最多 8 张
  - 支持 `File[]`
  - 也支持历史 `uploadedProductUrls`
- 视觉氛围参考图
  - 可选，仅 1 张
- 产品核心信息
  - 实际主要写入 `productFeatures`
- 模特呈现策略
  - `includeModel = true/false`
- 生图模型
- 画面比例
  - `1:1 / 3:4 / 9:16`
- 质量
- 目标市场
- 每套图数
  - `3 / 5 / 8`
- 方案套数
  - `1 / 2 / 3 / 4`

### 4.2 启动整套流程

入口函数：
- `handleStartWorkflow()`

执行步骤：

1. 防重入。
   - 如果 `__workflow__` 已在执行，则直接返回。
2. 读取最新状态 `stateRef.current`。
3. 如果正在策划、正在生图，或者没有可用产品素材，则直接返回。
4. 中断旧的策划任务与旧的生图任务。
5. 重置状态：
   - `isAnalyzing = true`
   - `sets = []`
   - `tasks = []`
   - `evaluationText = ''`
   - `pureEvaluations = []`
   - `firstImageConfirmed = false`
   - `isGenerating = false`
6. 调用 `ensureUploadedAssets`，把产品图和参考图都转成可用 URL。
7. 按 `setCount` 循环调用 `generateBuyerShowPrompts` 生成多套策划。
8. 解析成功后，把每套方案转成 `BuyerShowSet[]`。
9. 自动展开第一套方案。
10. 把 `isAnalyzing` 改为 `false`，`isGenerating` 改为 `true`。
11. 对每一套方案并行调用 `runSetGeneration`。

## 5. 素材上传与素材校验

### 5.1 上传策略

入口：
- `ensureUploadedAssets`
- `uploadToCos`

实际行为：

1. 如果前端已有 `uploadedProductUrls`，会先校验 URL 是否仍然有效。
2. 如果历史 URL 无效，但本地还有 `File`，则重新上传。
3. 如果只有 `File` 没有 URL，则上传。
4. 参考图也是同样逻辑。

### 5.2 URL 校验逻辑

入口：
- `verifyManagedAssetUrl`

规则：

- 仅对 `/api/assets/file/` 这类内部素材地址做校验。
- 通过 `GET` 测试地址是否还能访问。
- 无法访问时直接报错：
  - `旧素材记录已失效，请重新导入产品图后再试。`

这一步非常重要，因为买家秀会复用历史素材 URL，不做校验会出现“界面上还显示有图，但实际 URL 已失效，生图时报错”的问题。

### 5.3 上传时的隐含规则

`uploadToCos` 内部会先执行 `prepareImageForUpload(file)`：

- 会自动压缩过大的图片
- 优先走流式上传
- 流式失败时回退为 Base64 上传
- 会记录上传日志

## 6. 策划阶段链路

### 6.1 入口

`services/arkService.ts`

函数：
- `generateBuyerShowPrompts(productUrls, referenceUrl, state, apiConfig, setIndex, signal)`

### 6.2 模型调用方式

买家秀策划不是直接调外部模型 API，而是先创建内部任务：

- `taskType: 'kie_chat'`
- `provider: 'kie'`

最终由 `requestAnalysisResponse` 统一走内部任务系统：

1. `createInternalJob`
2. `waitForInternalJob`
3. 读取 `finalJob.result.content`

### 6.3 策划阶段输入

输入给分析模型的内容是一个单轮 `user` 消息，包含：

- 一段完整的英文 `systemPrompt + userPrompt`
- 所有产品图 `image_url`
- 可选的 1 张参考图 `image_url`

当前没有给这些图片额外标注“图1/图2/图3”的文字标签，买家秀策划阶段主要依赖顺序与整段文字语义。

### 6.4 策划 prompt 的核心原则

当前策划 prompt 的定位是：

- 生成一组“真实、整洁、iPhone 随手拍质感”的买家秀拍摄概念
- 输出 JSON
- 每个任务都给出英文 prompt
- 同时给出中文短风格描述
- 再给一条本地语言评价文案

#### 固定视觉母规则

策划 prompt 中明确要求：

- 真实买家秀风格
- 干净整洁的生活环境
- 禁止脏乱差
- 明亮自然光或温暖室内光
- 产品必须清晰可见
- 整体像高质量小红书 / Instagram 日常分享

#### 逻辑结构要求

所有图必须形成“成套故事”：

1. Context
2. Detail
3. Usage/Interaction

图数不是固定 3 张，而是动态使用 `state.imageCount`。

### 6.5 模特模式规则

当 `includeModel = true`：

- prompt 要求整套图必须有适合目标市场的真人出镜
- 第 1 张必须是 benchmark shot
- 后续保持一致
- 如果 `hasFace=true`，人物应看起来像目标市场的本地用户

当 `includeModel = false`：

- 明确要求 `NO HUMAN FACES/BODIES`
- 允许必要的手部出镜
- 重点转为静物和场景

### 6.6 参考图规则

如果有参考图：

- 参考图不是可有可无，而是高优先级氛围参照
- 要严格参考 4 个维度：
  - 风格
  - 色调
  - 场景类型
  - 如果有人的话，参考其气质、风格、年龄段

但同时禁止：

- 直接复制构图
- 完全照抄同一画面

注意：当前实现对参考图中人物的约束比较强，要求“气质、风格、年龄段接近”，同时又要求符合目标市场本地用户形象。这种设计是当前代码真实行为，复刻时要保持一致，不要擅自改弱或改强。

### 6.7 多套方案发散规则

`setIndex` 决定每一套方案的发散方向：

- `0`: 室内 / 家居
- `1`: 户外 / 街景
- `2`: 办公 / 学习 / 工作场景
- `>=3`: 更自由、更创意的场景

这是买家秀“多套方案”最重要的差异化来源之一。

### 6.8 策划输出契约

模型必须输出 JSON：

```json
{
  "tasks": [
    {
      "prompt": "英文生图描述",
      "style": "中文短描述",
      "hasFace": true
    }
  ],
  "evaluation": "目标国家本地语言的一条真实好评"
}
```

当前代码对返回内容做了这些处理：

1. 删除 ```json 包裹
2. 截取最外层 `{ ... }`
3. `JSON.parse`
4. 解析失败直接报：
   - `AI 返回内容格式异常，无法解析为 JSON`

### 6.9 策划模型完整提示词模板

下面不是意译，而是当前代码逻辑的模板化还原。复刻时建议直接照这个结构拼接。

#### `modelPrompt`

当 `includeModel = true`：

```text
3. **Include Model Strategy**: The set must include human presence suitable for ${state.targetCountry}. The FIRST task MUST be a benchmark shot. Subsequent shots must maintain consistency. If hasFace=true, the person should look like a local user from ${state.targetCountry}.
```

当 `includeModel = false`：

```text
3. **STILL LIFE Strategy**: **NO HUMAN FACES/BODIES.** Focus on product details and scenes. Hands are allowed if necessary for usage demonstration.
```

#### `systemPrompt`

```text
You are an expert in generating authentic e-commerce Buyer Reviews (UGC).
Target Market: ${state.targetCountry}.
Task: Create ${state.imageCount} realistic buyer show photo concepts (JSON) + one review.

VISUAL STYLE: **Authentic, Aesthetic & Clean Daily Life (iPhone Style)**.
- **Core Concept**: "Casual/Spontaneous" means natural and relaxed, **NOT** dirty, messy, or chaotic.
- **Environment**: Must be **CLEAN**, tidy, and visually pleasing (e.g., organized desk, cozy bedroom, bright cafe, neat shelf). **STRICTLY FORBID** messy rooms, trash, stained surfaces, or bad/dark lighting.
- **Angle**: Natural user angles. Can be slightly handheld/dynamic, but ensure the product is clearly visible.
- **Lighting**: Bright natural light or warm aesthetic indoor light. Avoid dark, gloomy, or flash-glare styles unless specified as artistic.
- **Vibe**: Aspirational but attainable. Like a high-quality post on Xiaohongshu or Instagram.

PLANNING LOGIC (Coherent Story):
The ${state.imageCount} images must form a logical set covering multiple aspects:
1. **Context**: Show the product in a NICE, CLEAN real-life environment.
2. **Detail**: Close-up of texture/material.
3. **Usage/Interaction**: How it is used.

Output Format: JSON ONLY.
Structure:
{
  "tasks": [
    {
      "prompt": "Visual description in English for Image AI. Keywords: aesthetic iPhone shot, clean background, natural light. If hasFace=true, the person should look like a local user from the target market.",
      "style": "中文简短描述(例如: '午后阳光下的整洁桌面', '温馨的卧室一角', '手持细节展示'). 必须使用中文.",
      "hasFace": boolean (true ONLY if a human face is clearly visible)
    }
  ],
  "evaluation": "A single, authentic, enthusiastic review text in the native language of ${state.targetCountry}."
}
```

#### `productInfo`

```text
如果 state.productName 有值：
${state.productName}
Details & Scenarios: ${state.productFeatures}

否则：
${state.productFeatures}
```

#### `divergenceInstruction`

```text
setIndex === 0:
Focus on **Indoor/Home** setting (e.g., Living room, Bedroom, Kitchen). Cozy and warm vibe.

setIndex === 1:
Focus on **Outdoor/Street** setting (e.g., Park, City street, Cafe terrace). Natural sunlight, dynamic vibe.

setIndex === 2:
Focus on **Office/Workplace/Study** setting (e.g., Desk setup, Meeting room). Clean, professional but casual vibe.

setIndex >= 3:
Create a **Unique & Creative** setting different from typical home/outdoor scenes. Maybe travel, gym, or artistic background.
```

#### `refInstruction`

有参考图时：

```text
CRITICAL VISUAL ATMOSPHERE REFERENCE (严格参照):
A reference image is provided. You MUST strictly follow these 4 dimensions:
1. **Style**: Strictly match the overall visual style of the reference (e.g., ins风, 日系, 韩系, 欧美风). Do NOT deviate.
2. **Color Tone**: Strictly match the color temperature and color tendency (warm/cool/neutral, saturation level).
3. **Scene**: Create scenes that are SIMILAR in type but NOT identical (e.g., if reference is a café, use a different café or similar cozy space). Adapt to divergence theme: ${divergenceInstruction}
4. **Model Appearance**: If the reference contains a person, the model's temperament, style, and age range MUST closely match the reference. If hasFace=true, the person should look like a local user from ${state.targetCountry}.
PROHIBITION: Do NOT copy the exact composition of the reference. Maintain the same visual tone while creating fresh angles.
```

无参考图时：

```text
Creative Direction: ${divergenceInstruction}
```

#### `userPrompt`

```text
**MANDATORY PRODUCT CORE INFO (以下产品核心信息是策划的唯一依据，严禁编造或偏离):**
Product Name & Selling Points: ${productInfo}
All task prompts MUST revolve around these selling points and usage scenarios. Do NOT invent features or scenarios not mentioned above.

${refInstruction}

Requirement:
1. Scenarios must feel 100% authentic to local users in ${state.targetCountry}.
2. **Diversity & Logic**: The set of ${state.imageCount} images must tell a complete story.
${modelPrompt}
4. Generate exactly ${state.imageCount} tasks.

Generate the JSON response. Ensure valid JSON format.
```

#### 最终传给策划模型的文本

```text
${systemPrompt}

${userPrompt}
```

再附加图片输入：

1. 所有产品图 `image_url`
2. 如果有参考图，再追加 1 张参考图 `image_url`

## 7. 策划结果转任务的逻辑

在 `handleStartWorkflow` 中：

1. 遍历每套 `planResult`
2. 如果方案为空或报错，则跳过该套
3. 如果 `includeModel = true`
   - 会把第一个 `hasFace = true` 的任务强行提到第 1 位
   - 目的：保证基准图优先是“带人脸的模特图”
4. 每条任务转成 `BuyerShowTask`
   - 初始 `status = 'pending'`
5. 每套结果转成 `BuyerShowSet`

这意味着：

- 基准图不一定来自策划模型原始第 1 条
- 在模特模式下，前端会重新排序

## 8. 生图阶段链路

### 8.1 入口

`BuyerShowModule.tsx`

函数：
- `runSetGeneration(set, productUrls, globalRefUrl)`

### 8.2 核心原则

每套方案的生成顺序不是“全部一起并行直接出图”，而是：

1. 先生成第 1 张基准图
2. 基准图成功后，把这张生成结果作为后续图片的新参考图
3. 后续图片再并行生成

这条规则是买家秀一致性的核心。

### 8.3 首图失败时的行为

如果第 1 张基准图失败：

- 第 1 张标记为 `error`
- 后续所有图片不再继续生成
- 后续任务统一标记错误：
  - `等待首图生成成功`

这是硬门槛，不允许“先把后面的凑出来”。

### 8.4 后续图的参考源切换

基准图成功后：

- `referenceForOthers = firstRes.imageUrl`

也就是说：

- 第 1 张用的是“全局参考图”
- 第 2 张及以后用的是“第 1 张已经生成出的真实结果图”

这是当前买家秀成套一致性的关键设计，必须保留。

## 9. 生图 prompt 组装规则

### 9.1 入口

`triggerNewKieTask(prompt, productUrls, refUrl, isFirstImage, signal)`

### 9.2 输入图顺序

最终传给生图模型的输入图顺序是：

1. 所有产品素材图
2. 如果存在参考图，则把参考图放在最后一个输入

```ts
const inputs = [...productUrls];
if (refUrl) inputs.push(refUrl);
```

因此：

- 首图时，最后一张输入通常是“用户上传的参考图”
- 后续图时，最后一张输入通常是“本套第 1 张已生成结果图”

### 9.3 生图 prompt 的组成

最终 prompt = 4 段拼接：

1. `realismPrompt`
2. `baseRequirement`
3. `productPreservation`
4. `Scenario: ${task.prompt}`

### 9.4 realismPrompt

这段是固定母 prompt，强调：

- 高质量真实 iPhone 照片
- 社交媒体随手拍
- 环境融合真实
- 物理正确阴影与反射
- 产品自然放置
- 干净整洁
- 禁止脏乱、漂浮、贴纸感

### 9.5 首图参考逻辑

当 `isFirstImage = true` 且有参考图时：

- 参考图优先级高
- 参考图决定环境风格和光线氛围
- 需要把产品融入相似但不完全复制的干净场景

关键文案：

- `VISUAL REFERENCE PRIORITY: High.`

### 9.6 后续图参考逻辑

当 `isFirstImage = false` 且有参考图时：

- 参考图承担“整套现实基础”的作用
- 要保持同一个人物、同一个房间/地点、同一个光线条件
- 但必须改变角度、姿势或焦距
- 不能复制同一个构图

关键文案：

- `SCENE & CHARACTER CONSISTENCY: The provided reference image establishes the reality of this set.`

这里的“reference image”在后续图阶段其实不是原始氛围图，而是第 1 张已经生成出来的基准图。

### 9.7 模特模式与静物模式的差异

#### 模特模式

首图：

- 真实生活方式快照
- 适合目标市场的真实用户
- 如果出现人物，应看起来像目标市场本地用户
- 走轻量化“本地用户”约束，不做极重的人种细节强绑定

后续图：

- 强调视觉一致性和同一场景延展

#### 静物模式

- 高质量静物图
- 禁止人脸
- 产品必须像真实放置在场景中，而不是后贴上去

### 9.8 产品保真规则

固定加入：

- `STRICT PRODUCT INTEGRITY`

要求：

- 产品外形、细节、标签必须忠实于源图
- 只让环境光影改变，不允许改坏产品主体

### 9.9 生图阶段完整提示词模板

#### `realismPrompt`

固定文案：

```text
High quality authentic iPhone photo, aesthetic social media snapshot. **Perfect environmental integration**, **physically accurate shadows and reflections**, **product naturally interacting with surfaces**. Clean and tidy daily life environment, natural lighting, clear details, realistic texture. NO messy background, NO trash, NO clutter, NO floating product, NO sticker effect.
```

#### `refDescription`

有参考图且是首图：

```text
VISUAL REFERENCE PRIORITY: High. The provided reference image (last input) determines the environment style and lighting vibe. Adapt the product into a similar **clean and aesthetic** environment with perfect lighting match.
```

有参考图且不是首图：

```text
SCENE & CHARACTER CONSISTENCY: The provided reference image establishes the reality of this set.
1. **MAINTAIN**: The same person (if present), the same specific room/location, and the same lighting conditions.
2. **EXTEND & DIVERGE**: This is a new shot in the same session. Change the camera angle, pose, or focus distance based on the new prompt. Do NOT simply clone the reference composition. Create a coherent story sequence.
```

没有参考图：

```text
空字符串
```

#### `baseRequirement`

模特模式 + 首图：

```text
AUTHENTIC LIFESTYLE SNAPSHOT (BENCHMARK): A real user in ${persistentState.targetCountry} posing naturally in a nice, clean setting. If a person is shown, they should look like a local user from ${persistentState.targetCountry}. Casual "influencer" style. ${refDescription}
```

模特模式 + 后续图：

```text
VISUAL CONSISTENCY & VARIATION: ${refDescription}
```

静物模式：

```text
HIGH QUALITY STILL LIFE: Focus on product in a real-world setting. NO FACES. The product must look like it is physically sitting in the scene, not pasted. ${refDescription}
```

#### `productPreservation`

固定文案：

```text
STRICT PRODUCT INTEGRITY: The product MUST maintain its exact physical form, details, and labels from source images, while receiving accurate lighting and shadows from the environment.
```

#### 最终生图 prompt

```text
${realismPrompt}
${baseRequirement}
${productPreservation}

Scenario: ${task.prompt}
```

这里的 `${task.prompt}` 来自策划模型返回的每条任务中的英文 prompt。

#### 最终图像输入顺序

```text
inputs = [...productUrls]
if (refUrl) inputs.push(refUrl)
```

也就是：

1. 产品素材图全部在前
2. 参考图永远放最后

#### 首图与后续图的参考图来源

首图：

```text
refUrl = 用户上传的氛围参考图（如果有）
```

后续图：

```text
refUrl = 本套第1张已生成成功的结果图
```

所以后续图虽然文字里叫 `reference image`，但实际已经换成了“基准生成图”，不是最初用户上传的氛围图。

## 10. 模型调用与超时设置

生图最终通过：
- `processWithKieAi`

内部统一下发内部任务：

- `taskType: 'kie_image'`
- `provider: 'kie'`

关键参数：

- `imageUrls`
- `prompt`
- `model`
- `aspectRatio`
- `resolution`

### 10.1 超时

当前买家秀生图走的是 `kieAiService.ts` 的统一超时：

- `nano-banana-2`: 6 分钟
- `nano-banana-pro`: 6 分钟
- 默认也是 6 分钟

### 10.2 画面比例

买家秀没有独立的智能比例推理。

它直接把 UI 选的比例传入：

- `1:1`
- `3:4`
- `9:16`

## 11. 失败找回与重生成功能

### 11.1 找回

入口：
- `handleRecoverTask`

当某张图已有 `taskId` 但前端结果没回来时：

1. 调用 `recoverKieAiTask(task.taskId, apiConfig, signal)`
2. 内部创建：
   - `taskType: 'kie_recover'`
3. 成功后把结果图补回卡片

### 11.2 重新生成

入口：
- `handleRegenerateTaskOptimized`

逻辑：

- 如果重生第 1 张
  - 参考图仍然优先使用全局参考图
- 如果重生第 2 张及以后
  - 优先使用本套第 1 张成功结果图作为参考
  - 如果第 1 张还没成功，才退回到全局参考图

这条规则非常重要，因为它保证“重生单张”时不会丢掉整套一致性。

### 11.3 生成剩余套图

入口：
- `handleGenerateRemainingOptimized`

用途：

- 当首图已成功，但后续部分图片失败时，可以只补跑后续图

硬条件：

- 第 1 张必须已成功
- 否则直接提醒：
  - `请先重新生成第一张基准图！`

## 12. 日志与状态流转

### 12.1 策划阶段日志

典型动作：

- `plan_start`
- `plan_success`
- `plan_failed`
- `plan_interrupt`

### 12.2 生图阶段日志

典型动作：

- `create_image_task`
- `set_generation_failed`
- `generate_remaining`
- `retry_single`
- `recover_single`
- `download_single`
- `download_batch`

### 12.3 任务状态流转

单张图：

- `pending -> generating -> completed`
- `pending -> generating -> error`
- `generating -> interrupted`

单套方案：

- `pending -> generating -> completed`
- 如果首图失败，当前实现会回到近似未完成态，而不是强制打成永久失败态

## 13. 当前真实行为中的隐含约束

这些不是 UI 明写出来的，但复刻时必须保留：

1. 买家秀是“先策划、后生图”的两阶段结构，不是边想边出。
2. 多套方案的差异主要由 `setIndex` 的场景发散指令驱动。
3. 模特模式下，前端会把第一张强制调成最适合做基准图的“带人脸”方案。
4. 整套图的一致性不依赖原始参考图本身，而依赖“第 1 张已生成图”。
5. 静物模式允许手部，但不允许人脸。
6. 参考图的作用不只是色调氛围，也会影响人物气质与场景风格。
7. 历史上传素材地址会先做有效性校验，否则直接报错，不盲信本地状态。

## 14. 当前实现的不足与坑点

这些也是复刻时必须知道的真实情况：

1. `customCountry` 没有真正打通。
   - 现在用户选自定义国家，prompt 仍可能拿到 `CUSTOM` 字面量。

2. `referenceStrength` 没接入链路。
   - UI 有，实际不影响策划和生图。

3. `userRequirement` 没接入链路。

4. 买家秀策划阶段没有像对话生图那样给图片做“图1/图2/图3 + URL”强绑定注释。

5. 当前人物参考规则是“目标市场本地用户”与“参考图人物气质/风格/年龄段接近”并存，存在一定张力。
   - 这是现状，不是文档建议。

## 15. 复刻清单

如果另一个 AI 要 1:1 复刻当前买家秀，请按这个顺序做：

1. 先实现 `BuyerShowPersistentState`、`BuyerShowSet`、`BuyerShowTask` 三层状态结构。
2. 实现素材上传与历史 URL 校验。
3. 实现策划接口：
   - 输入产品图数组
   - 可选参考图
   - 输出 JSON 任务数组和评价文案
4. 实现 `setIndex` 场景发散。
5. 实现模特模式与静物模式的 prompt 分支。
6. 实现“模特模式下把第一条带人脸任务前置”的重排规则。
7. 实现生图执行链：
   - 先出第 1 张
   - 成功后再并行出后续图
   - 后续图统一参考第 1 张结果图
8. 实现首图失败时阻断后续图。
9. 实现失败找回。
10. 实现单张重生和“补跑后续图”。
11. 实现日志记录与状态恢复。

## 16. 最小复刻结论

如果只能抓住最核心的 5 条，请保留这 5 条：

1. 买家秀是“策划 JSON -> 生图执行”的两阶段流水线。
2. 每套的第 1 张必须是基准图。
3. 后续图必须参考第 1 张已生成结果，而不是继续直接参考原始氛围图。
4. 多套方案差异依赖 `setIndex` 的固定场景发散指令。
5. 素材 URL 在调用前必须校验是否仍然有效。
