# 买家秀参考图标注优化设计

## 背景

当前买家秀功能在使用环境参考图时，prompt 中未明确标注参考图的 URL 和角色。需要优化为：
- 第一张图：明确标注用户上传的环境参考图为"视觉氛围风格参考"，禁止完全复制
- 后续图：用第一张生成图替代原始参考图，标注为"一致性参考"，保持风格一致但角度延展

## 涉及文件

1. `services/arkService.ts` — `generateBuyerShowPrompts` 函数（策划模型 prompt）
2. `modules/BuyerShow/BuyerShowModule.tsx` — `triggerNewKieTask` 函数（生图模型 prompt）

## 改动一：策划模型（arkService.ts 第477-485行）

### 现有逻辑
`refInstruction` 包含四维约束（风格/色调/场景/模特），但未区分首图和后续图的策划差异。

### 改动内容
在 `refInstruction`（referenceUrl 存在时）末尾追加首图 vs 后续图的策划指引：

```
GENERATION SEQUENCE AWARENESS:
- Task 1 (首图): This prompt will be generated with the user's uploaded atmosphere reference image.
  Focus on establishing the visual atmosphere, environment, and overall mood.
- Tasks 2+ (后续图): These prompts will be generated using the FIRST generated image as consistency reference.
  Focus on extending different angles, poses, and compositions while maintaining the established style.
  Each subsequent prompt should naturally imply continuity with the first shot.
```

不改变现有四维约束逻辑，仅追加。

## 改动二：生图模型（BuyerShowModule.tsx 第769-819行）

### 现有逻辑
`triggerNewKieTask` 中 `refDescription` 根据 `isFirstImage` 区分，但未在 prompt 中写明参考图 URL。

### 改动内容

**第一张图（isFirstImage=true，refUrl 为用户上传的环境参考图）：**

替换现有 `refDescription` 为：
```typescript
refDescription = `VISUAL ATMOSPHERE STYLE REFERENCE (视觉氛围风格参考图):
Reference Image URL: ${refUrl}
This image is the VISUAL ATMOSPHERE reference. Match its overall style and color tone.
PROHIBITION: Do NOT generate an identical scene, person, or composition.
Create a SIMILAR atmosphere with DIFFERENT specific content and angles.`;
```

**后续图（isFirstImage=false，refUrl 为第一张生成图 URL）：**

替换现有 `refDescription` 为：
```typescript
refDescription = `CONSISTENCY REFERENCE (一致性参考图):
Reference Image URL: ${refUrl}
This image is the FIRST generated photo of this set — use it as the consistency anchor.
MAINTAIN: Same person (if present), same scene style, same color tone, same overall aesthetic.
EXTEND: Different camera angle, different pose, different composition.
Create a coherent continuation of the same shooting session, NOT a copy.`;
```

### 数据流不变
- `runSetGeneration` 中 `referenceForOthers = firstRes.imageUrl` 逻辑保持不变
- 后续图的 `inputs` 数组 = productUrls + 第一张生成图 URL（不含原始参考图）
- `handleGenerateRemainingOptimized` 同理，已使用 `firstTask.resultUrl` 作为参考

## 不改动的部分

- `BuyerShowSidebar.tsx` — 前端 UI 无变化
- `kieAiService.ts` — 底层生图服务无变化
- `types.ts` — 数据结构无变化
- 策划模型的四维约束核心逻辑不变，仅追加序列感知指引
