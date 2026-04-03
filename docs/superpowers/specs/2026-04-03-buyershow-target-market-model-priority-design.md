# 买家秀目标市场模特优先级设计

## 背景

当前买家秀在开启“包含模特”时，策划 prompt 与生图 prompt 都会强烈要求复现参考视觉氛围图中的人物外貌特征。这会导致一个错误优先级：

- 当目标市场是 A 国，但参考氛围图中的人物明显属于 B 国人群特征时，系统仍可能优先复制参考人物
- 最终生成结果不符合目标市场用户对“本地真实买家秀”的预期

本次调整要明确一条硬规则：

- 只要开启“包含模特”，模特的国籍/人种/肤色等核心人物特征必须先由 `targetCountry` 决定
- 参考视觉氛围图中的人物特征不得覆盖这条规则

## 用户确认的业务口径

1. 若参考视觉氛围图里有人，系统应完全忽略其国籍、人种、肤色等人物特征
2. 参考图里的人物仅可提供弱参考，范围限定为：穿搭方向、姿态气质、镜头语言
3. 目标市场按界面中的 `targetCountry` 直接映射默认人群特征，不额外做“多族裔混合覆盖”的保守表达

## 涉及文件

1. `services/arkService.ts` - `generateBuyerShowPrompts`，负责策划阶段的 buyer show prompt
2. `modules/BuyerShow/BuyerShowModule.tsx` - `triggerNewKieTask`，负责实际生图前的 prompt 拼接
3. `services/arkService.test.mjs` - 增加策划 prompt 回归测试
4. `modules/BuyerShow/buyerShowBehavior.test.mjs` - 增加买家秀生图 prompt 回归测试

## 设计目标

1. 在策划阶段就把“目标市场优先决定模特特征”写成硬约束
2. 在生图阶段再做一次硬约束，避免策划文本被弱化后失效
3. 保留参考视觉氛围图对光影、场景、色调、穿搭和镜头语言的价值
4. 不改 UI，不新增配置项，不改变现有数据结构

## 方案对比

### 方案一：同时修改策划层与生图层

- 优点：规则在上游和下游都生效，最稳，能覆盖用户手改 prompt 或模型理解偏移
- 缺点：需要同时补两处测试

### 方案二：只改策划层

- 优点：改动较少
- 缺点：如果后续生图阶段没有重复约束，执行时仍可能被参考图人物带偏

### 方案三：只改生图层

- 优点：能直接影响最终出图
- 缺点：用户在界面里看到的策划内容仍然可能保留错误人物设定

### 结论

采用方案一，同时修改策划层与生图层。

## 详细设计

### 一：策划层 `services/arkService.ts`

当 `state.includeModel === true` 时，调整 `modelPrompt` 与 `refInstruction` 的约束文案。

核心变化：

1. 明确写出：每个 `hasFace=true` 的任务，人物外貌必须先基于 `state.targetCountry` 决定
2. 若参考图中有人，不允许复用其 `ethnicity`、`nationality`、`skin tone`
3. 参考图中的人物只能用于继承以下软信息：
   - clothing direction
   - pose energy / temperament
   - camera language
4. 若参考图无人，则仍由系统直接生成符合目标市场的人物设定

策划层预期语义：

- “Target market fit” 高于 “reference person resemblance”
- “visual atmosphere reference” 只负责氛围，不负责人物身份

### 二：生图层 `modules/BuyerShow/BuyerShowModule.tsx`

在 `triggerNewKieTask` 中，为包含模特模式追加硬约束。

核心变化：

1. 第一张图使用用户上传参考图时，明确声明：
   - 该图只作为视觉氛围参考
   - 即使参考图中有人，也不能复制其国籍、人种、肤色等核心人物特征
   - 最终人物必须符合 `${persistentState.targetCountry}` 的本地市场人群特征
2. 后续图使用首张生成图作为一致性参考时，保持人物一致性的对象变成“首张生成图里的模特”
3. “一致性”定义为：
   - same generated person
   - same scene family
   - same tone / aesthetic
   - 不再回指原始参考图中的人物

### 三：不改动的部分

- `BuyerShowSidebar.tsx` 不新增开关或提示文案
- `types.ts` 不新增字段
- `kieAiService.ts` 底层调用参数不变
- 方案数量、首图/后续图的流程编排不变

## 测试策略

### 策划层测试

在 `services/arkService.test.mjs` 增加断言，验证买家秀策划 prompt 中存在以下语义：

1. 含模特时，人物特征必须优先匹配 `targetCountry`
2. 参考图中的人物不得覆盖目标市场人物特征
3. 参考图人物仅可作为穿搭、姿态、镜头语言参考

### 生图层测试

在 `modules/BuyerShow/buyerShowBehavior.test.mjs` 增加断言，验证生图 prompt 组装源码中存在以下语义：

1. 首图 prompt 明确禁止复制参考图人物的人种/国籍/肤色特征
2. 首图 prompt 明确要求人物符合目标市场
3. 后续图 prompt 的一致性对象是首张生成图，而不是原始参考氛围图人物

## 风险与取舍

1. `targetCountry` 当前是直接映射，不做更细颗粒度的人群策略，因此生成会偏“该市场主流直觉”
2. 如果用户故意上传与目标市场冲突的人物参考图，本次改动会有意忽略该人物身份特征，这是符合当前确认业务口径的
3. 不新增 UI 提示，意味着这条规则主要靠 prompt 约束和最终结果体现

## 验收标准

1. 开启“包含模特”且存在参考视觉氛围图时，策划结果中的人物描述优先符合 `targetCountry`
2. 当参考图人物与目标市场冲突时，策划文本不再要求复制参考图人物的人种/国籍/肤色
3. 生图 prompt 明确把参考图人物身份特征排除在可继承范围之外
4. 回归测试覆盖上述优先级，避免后续被改回
