# 设计:ProjectCard 加 React.memo(消除大列表无谓重渲)

> 日期:2026-06-14 · 分支 `fix/chunk-error-boundary` · 关联交接记录下一步 #3
> 状态:设计已与业主对齐,待写实现计划

## 1. 背景

`ProjectCard`(`src/shell/components/ProjectCard.tsx`,2289 行)是项目列表里每个卡片的渲染组件,在 `ProjectListView` 里 `visibleProjects.map()` 批量渲染。当前**未包 `React.memo`**,父组件(`ShellMigratedApp`/`ProjectListView`)任意状态变化(打字、无关 state churn)都会让所有可见卡片整体重渲——卡片内部逻辑重(2289 行,含 plan 编辑、结果网格等),是体感卡顿来源之一。

直接 `React.memo(ProjectCard)` **无效**:唯一真实调用点 `ProjectListView:348` 把父级回调包成 **5 个内联箭头函数**绑 `project.id`(`onDeleteResult/onRegenerate/onFission/onEdit/onRecover`),每次父渲染生成新函数引用,memo 浅比较永远判定 props 变了。

## 2. 关键现实(已探针确认)

- **只有 1 个调用点**用共享 `ProjectCard`:`ProjectListView.tsx:348`。`StoryboardWorkspace.tsx:98` 是**同名本地组件**,与本任务无关,不动。
- 父级 `ShellMigratedApp` 的 handler(`handleDeleteResult` 等)**本来就 `useCallback` 包好、签名是 `(projectId, ...)`、稳定**。内联闭包纯粹为把 `(projectId,rid)` 适配成卡片当前 `(rid)` 契约。
- `pendingActionKeys` 是 `Record<string,boolean>`,任一动作切换换新引用、传所有卡片。默认浅比较下它一变所有卡重渲(仅动作切换时,低频)——可接受,不在本轮优化。

## 3. 范围决策(已与业主对齐)

| 决策点 | 选定方案 |
|---|---|
| 契约改法 | 卡片回调签名加 `projectId` 入参;卡片内部用自己的 `project.id` 调用;ProjectListView 透传稳定父级 handler,删 5 个内联闭包 |
| memo 比较 | `React.memo` 默认浅比较(YAGNI,不写自定义 comparator)|

## 4. 架构与改动

### 4.1 ProjectCard Props 契约(`src/shell/components/ProjectCard.tsx`)
受影响的 5 个回调签名,统一**前置 `projectId: string`**:
- `onDeleteResult?: (projectId: string, resultId: string) => void`
- `onRegenerate?: (projectId: string, resultId: string, instruction?: string) => void`
- `onFission?: (projectId: string, resultId: string, mode: 'scene' | 'palette' | 'custom', instruction: string) => void`
- `onEdit?: (projectId: string, resultId: string, instruction: string, files: File[]) => void`
- `onRecover?: (projectId: string, resultId: string) => void`

其余回调(`onDeleteProject/onConfirmPlan/onUpdatePlans/onDeletePlan/onRegeneratePlans/onCancelTask/onConfirmStoryboardImaging/onImportStoryboardToGeneration`)签名**已含 projectId 或无需绑定**,不变。

### 4.2 ProjectCard 内部调用点(卡片内 ~5 处)
卡片内调用这 5 个回调处,把 `project.id` 作为第一个实参补上(卡片内 `props.project.id` 始终可得)。例如 `onDeleteResult(rid)` → `onDeleteResult(project.id, rid)`。**靠 tsc 揪出所有调用点**:改完签名后,卡片内任何漏改的旧调用都会类型报错。

### 4.3 ProjectCard 导出包 memo(`src/shell/components/ProjectCard.tsx:2289`)
`export default ProjectCard` → `export default React.memo(ProjectCard)`(与本轮 `BottomInputBar` 同款写法)。

### 4.4 ProjectListView 调用点(`src/shell/components/ProjectListView.tsx:348`)
删掉 5 个内联闭包,直接透传父级稳定 handler:
- `onDeleteResult={(rid) => onDeleteResult(project.id, rid)}` → `onDeleteResult={onDeleteResult}`
- `onRegenerate={(rid, instruction) => onRegenerateResult?.(project.id, rid, instruction)}` → `onRegenerate={onRegenerateResult}`
- `onFission={(rid, mode, instruction) => onFissionResult?.(project.id, rid, mode, instruction)}` → `onFission={onFissionResult}`
- `onEdit={(rid, instruction, files) => onEditResult?.(project.id, rid, instruction, files)}` → `onEdit={onEditResult}`
- `onRecover={(rid) => onRecoverResult?.(project.id, rid)}` → `onRecover={onRecoverResult}`

注:卡片侧 `onRegenerate/onFission/onEdit/onRecover` 是可选(`?`),父级 `onRegenerateResult` 等也是可选 `(projectId,...)`,签名对齐后直接透传类型相容。

## 5. 数据流(不变)

用户在卡片上点删除/重生成/裂变/编辑/恢复 → 卡片以 `project.id + resultId` 调回调 → ProjectListView 透传 → ShellMigratedApp 的稳定 handler 执行。行为与现在**完全等价**,只是 projectId 从"调用点闭包绑定"变成"卡片内部传参"。

## 6. 测试

- **行为等价**:现有 `ProjectCard`/`ProjectListView` 相关测试保持全绿;若有源码 grep 风格测试断言旧闭包写法(`onDeleteResult={(rid)`),同步更新(本项目老毛病,见根因库教训)。
- **回归测试(新增)**:在 `ProjectListView` 相关测试加一条——断言调用点透传的是稳定引用(grep 源码:不再出现 `onDeleteResult={(rid)`,出现 `onDeleteResult={onDeleteResult}`),锁定"不退回内联闭包"。
- 全量:前端 650 + 后端 303 全绿,`npm run lint`(tsc + eslint)exit 0,`npm run build` 成功。
- **实机**:删除/重生成/裂变/编辑/恢复五个动作各点一次,确认作用到正确项目(projectId 传对);打字时卡片不再整列重渲(可选 React DevTools Profiler 验,非必须)。

## 7. 风险与回滚

- 本地已提交基线 `afa6471`,可回滚。分支 `fix/chunk-error-boundary`。
- **最大风险=卡片内漏改某个调用点**(仍按旧签名调)→ tsc 类型错会全部报出(这是加 projectId 入参而非默认值的保险)。
- **次风险=projectId 传错**(传成别的 id)→ 删/改作用到错项目;实机逐个动作验证拦截。
- memo 默认浅比较:`pendingActionKeys` 变更仍触发全列表重渲(低频,可接受),不在本轮范围。
