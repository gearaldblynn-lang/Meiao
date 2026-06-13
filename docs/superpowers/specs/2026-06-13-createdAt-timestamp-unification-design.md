# 设计:createdAt / completedAt 时间戳彻底统一(消除排序乱序根因)

> 日期:2026-06-13 · 分支 `fix/chunk-error-boundary` · 关联根因库 #1/#2/#4
> 状态:设计已与业主对齐,待写实现计划

## 1. 背景与确认的 bug

体检报告标记项目列表"可能乱序"。按第0层铁律先写最小输入对比探针(`/tmp/sortprobe.mjs`),喂代表性项目进真正的 `sortProjectsNewestFirst`,**复现了真乱序**:

```
排序后(本应 newest→oldest):
  1. C:"06-13"字符串 + id无时间戳      ← 错!被顶到最前
  2. F:"6月13日"中文 + id无时间戳      ← 错!
  3. B:"06-13"字符串 + id带时间戳(同天)
  4. A:Date.now()数字(真最新)
  5. D:数字 早一天
  6. E:只有 updatedAt
```

**根因**:壳层 `Project.createdAt` 是 `string`,既当数据又当展示标签。
- 产生侧:`ShellMigratedApp.tsx` 多处用 `new Date().toLocaleDateString('zh-CN',{month,day}).replace('/','-')` 产出年缺失的 `"06-13"`;`shellDataAdapter.ts` 的 `toDateLabel()` 把后端 job **本来就有的毫秒戳**主动降精度成 `"MM-DD"` 字符串。
- 消费侧:`shellScopeFilters.ts` 的 `projectSortKey` 为容忍这种脏数据,堆了 6 层启发式(`sortAt→createdAtMs→createdAt→从 id 正则抠毫秒→parseMonthDay→updatedAt`)。其中 `parseMonthDay("06-13")` 用 `new Date()` **当前年**拼时间戳 → 任何只能靠年缺失字符串取时间的项目(即 id 不含 12-13 位数字戳的历史/导入项目)被算成"今年6月13日"浮到最前,无视真实新旧。

新项目 id 都是 `proj-<Date.now()>`(`extractTimestampFromText` 能抠回毫秒),所以乱序**只影响历史/导入项目**;但这是线上生产、服务真实商家,旧库里就有这类数据。

这与根因库 #1(状态靠现算、散落多处)/#2(正则猜业务状态)/#4(数据模型把展示和数据混存)同源。

## 2. 目标

- 全链路改用**单一规范数字毫秒时间戳**作为排序/逻辑真值,消除已确认乱序。
- 把散落的"恢复时间戳"启发式**收敛到读边界唯一一处**(单一判据纪律)。
- 展示与数据**彻底分离**:数字是数据,`"06-13"` 是渲染处格式化出来的。
- 商家看到的卡片日期保持 `"06-13"` 不变。
- 后端零改动(`appStateMerge.mjs:145` 已 `Number(...)` coerce,数字反而更兼容)。

非目标(留给后续):后端 `app_states` 单行 JSON 拆表(根因库 #4 中期项)。

## 3. 范围决策(已与业主对齐)

| 决策点 | 选定方案 |
|---|---|
| 规范字段 | `createdAt` 类型 `string → number`(连同 `completedAt`),语义最纯;靠 tsc 揪出全部消费点 |
| 旧数据迁移 | 启发式搬到读边界单一 normalizer `coerceCreatedAtMs`,加载时一次性转数字;之后排序塌成纯数字比较 |
| 卡片展示 | 抽共享时间格式化模块,合并 3 份重复 `formatTime`,新增紧凑月-日格式给卡片,显示仍为 `"06-13"` |

## 4. 架构与组件

### 4.1 新增 `src/utils/createdAtMs.ts`(纯函数 + 单测)
唯一的时间戳恢复判据。把现有 `toFiniteTimestamp` / `extractTimestampFromText` / `parseMonthDay` / `startOfDay` 从 `shellScopeFilters.ts` 搬来:

```ts
// 把任意历史形态的 createdAt 原始值恢复成规范毫秒戳
coerceCreatedAtMs(raw: unknown, ctx?: { id?: string; updatedAt?: unknown }): number
```
恢复优先级:`数字直采 → 从 id 抠 12-13 位毫秒 → 解析 "MM-DD"/"X月Y日" → 退 updatedAt → 0`。
**修正乱序**:年缺失日期(MM-DD/中文)恢复出的值,排序时不得排在"有完整毫秒戳"的项目之前——实现方式见 4.4(分层 key,而非贴当前年)。

### 4.2 新增/整合 `src/utils/timeFormat.ts`(展示)
- `formatTime(ms?: number | null): string` —— 完整日期时间(合并 `shell/modules/Account/AccountManagement.tsx:66`、`modules/Account/AccountManagement.tsx:103`、`modules/OneClick/ReferencePresetManager.tsx:28` 三份相同实现)。
- `formatMonthDay(ms?: number | null): string` —— 紧凑 `"MM-DD"`(= 旧 `toDateLabel` 的展示部分),给项目卡片/结果卡片用。

### 4.3 类型(`string → number`)
- `ShellMigratedApp.tsx`:`GeneratedResult.createdAt`、`Project.createdAt`、`Project.completedAt`(及相关 options/接口形态)。
- `src/adapters/shellDataAdapter.ts` 内部 `createdAt: string` 形态、`shellPersistence.ts` 内部形态。
- tsc 会把所有遗漏的字符串产生点报成类型错——这是选 number 的核心收益。

### 4.4 排序(`src/adapters/shellScopeFilters.ts`)
`projectSortKey` 塌成读 `project.createdAt`(已是规范数字)。保留"完整戳优先于年缺失戳"的分层:
- `tier`:有真实毫秒戳=1,仅年缺失恢复值=0;
- 排序:`tier desc → createdAt desc → sequence desc → 原序`。
迁移后读边界已回填数字,`ScopeProject` 的 `sortAt/createdAtMs/createdAt:string|number` 冗余字段可简化为 `createdAt: number`(保留 `updatedAt` 作 normalizer 上下文)。

### 4.5 读边界(回填)
`shellDataAdapter.ts` 所有构造 project/result 处:`toDateLabel(createdAtValue)`(产字符串)→ `coerceCreatedAtMs(createdAtValue, { id, updatedAt })`(产数字)。`shellPersistence.ts` 读取持久化数据处同样过 normalizer。

### 4.6 产生点(`ShellMigratedApp.tsx`)
4 处 `new Date().toLocaleDateString(...).replace('/','-')` → `Date.now()`。`completedAt: project.createdAt` 等透传点保持透传(类型随之变数字)。

### 4.7 展示点
- `ProjectCard.tsx:865/897/1028`、`ResultCard.tsx:105`:`{project.createdAt}` / `{result.createdAt}` → `{formatMonthDay(...)}`。1028 行 `textReportResult?.createdAt || project.completedAt || project.createdAt` 改为对数字取值后再 `formatMonthDay`。

## 5. 数据流

```
后端 job / 持久化(数字戳 or 旧 "06-13" 字符串)
  → 读边界 coerceCreatedAtMs(单一判据) → 内存中 createdAt:number(规范)
  → 排序 projectSortKey(纯数字 + tier)
  → 展示 formatMonthDay(createdAt) → "06-13"
  → 写回/持久化 数字(后端 Number() 兼容)
```

## 6. 测试

- **回归测试**:把 `/tmp/sortprobe.mjs` 固化进 `shellScopeFilters.test.mjs`,断言 C/F(年缺失)排在 A/D(真实戳)之后,A 在 D 之前。
- `createdAtMs.test.mjs`:`coerceCreatedAtMs` 覆盖 数字直采 / id 抠戳 / "MM-DD" / "X月Y日" / 垃圾→0 / updatedAt 退路 / tier 判定。
- `timeFormat.test.mjs`:`formatTime`、`formatMonthDay`(含空值)。
- 现有 941 测试保持全绿;更新任何断言 createdAt 为字符串格式的旧测试(grep 风格源码测试尤其注意,见根因库教训)。
- 全量:`npm run lint` + 前后端 `--test`。

## 7. 风险与回滚

- 本地未提交,git 在 `fix/chunk-error-boundary`,可回滚。
- 最大风险=漏改某产生点仍写字符串 → **tsc 类型检查会全部报出**,这是 number 方案的保险。
- 展示风险:`formatMonthDay` 必须与旧 `toDateLabel` 输出逐字一致(`"MM-DD"`),否则商家看到变化——单测锁定。
- 后端无改动,`/api/state` 双向 merge 契约不变(后端本就 `Number()` coerce)。
