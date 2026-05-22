# 前端系统升级保护规范

更新日期：2026-05-02

本文档用于后续整套前端系统升级。目标是在保留现有业务能力、配置、状态、提示词和任务链路的前提下，只升级前端呈现、布局和交互体验。

## 1. 升级原则

- 不直接在稳定工作目录里做大规模前端改造。
- 先建立隔离升级工作区，边迁移、边对照、边测试。
- 设计稿负责视觉方向，落地时必须服从现有业务链路。
- 如果设计稿与现有功能冲突，优先保功能，再调整呈现。
- 不顺手改 prompt、不顺手改接口、不顺手重构业务状态。
- 每次迁移都要能回答：原功能是否还在、配置是否还生效、状态是否还能恢复、任务是否还能正常提交和找回。

## 2. 隔离开发策略

当前稳定目录：

```text
/Users/feiyanglin/程序开发/电商视觉一键化/版本管理/梅奥MEIAO-当前版本
```

正式升级前建议创建 Git worktree：

```bash
git worktree add .worktrees/frontend-system-upgrade -b frontend-system-upgrade
```

创建 worktree 前必须先检查当前工作树：

```bash
git status --short
```

如果当前版本存在未提交改动，不能直接开升级 worktree 后就开始迁移。因为新 worktree 默认从当前提交 `HEAD` 创建，不会自动带上未提交改动。

必须先选择一种基线策略：

1. 将当前有效改动提交为新的稳定基线，再从该提交创建升级 worktree。
2. 保持当前工作树不提交，但创建 worktree 后手动把这批有效改动同步过去。
3. 暂停升级，先把当前改动整理、测试、确认归属。

默认推荐第 1 种：先把当前有效改动变成清晰基线，再开始前端系统升级。

本次前端系统升级开始前，应先完成一次“升级前稳定基线”提交。提交后记录基线：

```bash
git rev-parse --short HEAD
```

后续创建升级 worktree 时，应从这个已提交基线出发，确保升级工作区包含当前已确认有效的功能修复、prompt 约束、依赖锁文件和文档规范。

升级工作目录：

```text
/Users/feiyanglin/程序开发/电商视觉一键化/版本管理/梅奥MEIAO-当前版本/.worktrees/frontend-system-upgrade
```

工作方式：

1. `梅奥MEIAO-当前版本` 保持为对照基准。
2. `frontend-system-upgrade` 分支承载全部前端系统升级。
3. 每迁移一个模块，在升级工作区验证，再与当前版本对照。
4. 全部模块验收通过后，再合并回 `main`。
5. 合并确认无误后，删除临时 worktree。

当前项目的 `.worktrees/` 已被 Git 忽略，可以作为隔离升级工作区目录。

删除临时工作区时使用：

```bash
git worktree remove .worktrees/frontend-system-upgrade
```

## 3. 禁止默认改动的区域

以下区域默认视为受保护资产。除非用户明确要求，不因前端升级而改业务语义。

- `src/services/arkService.ts`
- `src/services/kieAiService.ts`
- `src/modules/OneClick/generationPromptUtils.ts`
- `src/modules/OneClick/copyLayoutUtils.mjs`
- `server/providerGateway.mjs`
- `server/index.mjs` 中的 prompt、任务、账号、日志、状态接口
- `src/utils/appState.ts` 中的持久化字段和迁移逻辑
- `src/services/internalApi.ts` 中的 API 路径、超时、请求去重和鉴权逻辑
- `src/services/loggingService.ts` 中已有日志动作含义
- `src/types.ts` 中已有状态、任务、模块和配置字段

如果确实需要触碰这些文件，必须先说明原因，并补对应测试或人工验收项。

如果这些文件在升级开始前已经因为业务修复或稳定性改动发生变化，应先把它们纳入新的稳定基线，再创建前端升级 worktree。前端升级阶段仍按受保护资产处理。

## 4. Prompt 保护规则

项目 prompt 是核心资产，前端升级期间默认不修改。

必须保护：

- RTCFE 结构：`R Role`、`T Task`、`C Constraint`、`F Format`、`E Example`
- 解析锚点：`[SCHEME_START]`、`[SCHEME_END]`、`<CONFIG_CHANGES>` 等
- 既有输出字段、字段顺序、JSON schema
- 文案排版规则：圆括号是排版指令，中文引号内才是画面正文
- 产品一致性、logo、比例、素材角色、禁止编造等历史约束

参考文档：

- `docs/prompt-rtcfe-migration-map.md`
- `docs/one-click-prompt-code-boundary-guide.md`

## 5. 前端可改区域

优先升级这些呈现层区域：

- 全局工作台壳层：`src/ShellMigratedApp.tsx`
- 导航和模块入口：`src/shell/components/layout/*`
- 通用工作台组件：`src/components/ui/workspacePrimitives.tsx`
- 弹窗、确认框、Toast、帮助、更新说明
- 各模块的页面布局、卡片、表格、按钮、输入框、上传区、状态展示
- 视觉层 className、布局结构、信息分组、空状态、加载状态、错误状态

允许做的合理调整：

- 把不合理的视觉层级改得更清晰。
- 把过度拥挤或过度留白的区域改成更适合工作台的密度。
- 把重复 UI 抽成更稳定的通用组件。
- 把隐藏太深的关键动作放到更顺手的位置。

不允许默认做的调整：

- 删除已有按钮或入口。
- 改变默认配置值。
- 改变生成、重试、中断、找回、下载、保存的行为。
- 改变多项目、用户隔离、日志、状态恢复逻辑。
- 因为视觉设计而让用户必须多走一步完成原本一步能完成的任务。

## 6. 模块迁移顺序

建议顺序：

1. 全局壳层、导航、通用组件
2. 一键主详
3. 出海翻译
4. 买家秀
5. 产品精修
6. 短视频
7. 小红书封面
8. 智能体中心
9. 系统设置
10. 账号管理与运行日志

一键主详优先级高，是因为它最复杂，也最容易因 UI 调整影响状态、项目、编辑回写和 prompt 组装。

## 7. 每个模块的验收清单

每迁移一个模块，至少检查：

- 模块入口仍可打开。
- 页面刷新后状态能恢复。
- 所有原有按钮和关键入口仍存在。
- 配置项能正常修改并持久化。
- 上传、删除、清空、选择、编辑、保存等基础交互可用。
- 生成任务能提交。
- 任务结果能展示。
- 失败后能重试或找回。
- 中断或取消逻辑仍有效。
- 下载或导出仍有效。
- 内部模式下用户隔离、权限和日志不被破坏。
- 空状态、加载状态、失败状态、完成状态都有合理呈现。

## 8. 重点模块保护项

### 一键主详

必须保留：

- 首图、主图、详情、SKU 四个子模块。
- 多项目并存、项目切换、项目删除、刷新恢复。
- 编辑后的方案必须进入后续生成。
- 首图继续裂变必须新开项目，不污染原项目。
- 参考图、产品图、logo、赠品图角色区分。
- 参考预设库、保存预设、应用预设。
- 批量生成、单张重做、找回结果、中断、下载。
- 生图 prompt 只取当前方案，不重新附加策划示例。

### 出海翻译

必须保留：

- 主图出海、详情出海、去除文案三种模式。
- 文件和文件夹导入。
- 批量处理、单张重试、找回结果、中断、打包导出。
- 详情比例检查和比例保护。

### 智能体中心

必须保留：

- 普通员工可聊天。
- 管理员可管理智能体、知识库、版本、训练和测试。
- 会话、知识库绑定、模型策略、系统提示词显示和编辑流程。
- 图像生成请求的长超时和结果同步。

### 账号与日志

必须保留：

- 登录、登出；登录页不得预填默认账号或密码。
- 管理员创建、禁用、启用、删除、重置密码。
- 运行日志筛选、分页、统计、导出。
- 用户隔离和权限判断。

## 9. 测试基线

升级前先跑一次基线，记录失败项；升级后同样命令复跑。

基础命令：

```bash
npm run lint
npm run build
```

如果 `package.json` 或 `package-lock.json` 有变化，创建升级工作区后必须先执行：

```bash
npm install
```

再运行 lint、build 和重点回归，避免依赖版本与锁文件不一致。

重点回归：

```bash
node --test src/components/uiArchitecture.test.mjs
node --test src/components/workspacePrimitives.test.mjs
node --test src/modules/OneClick/oneClickBehavior.test.mjs
node --test src/modules/OneClick/oneClickRecoveryBehavior.test.mjs
node --test src/services/arkService.test.mjs
node --test src/services/kieAiService.test.mjs
node --test src/modules/BuyerShow/buyerShowBehavior.test.mjs
node --test src/modules/XhsCover/xhsCoverUtils.test.mjs
node --test src/modules/Account/accountManagementBehavior.test.mjs
node --test server/jobRuntime.test.mjs
node --test server/providerGateway.test.mjs
```

完整验收可运行：

```bash
npm run acceptance
```

## 10. 设计稿接入规则

用户提供前端框架文件或设计稿后，先做三件事：

1. 拆出视觉系统：颜色、字号、间距、圆角、阴影、按钮、表单、卡片、导航、弹窗。
2. 对照现有功能：确认设计稿中是否遗漏原有入口或状态。
3. 制定模块迁移计划：每次只迁移一块，完成后验证。

如果设计稿缺少某个现有功能入口，默认不是删除功能，而是按新设计系统补一个合理入口。

## 11. 合并回当前版本前检查

合并前必须确认：

- 升级分支无未解释的测试失败。
- 当前版本已有未提交改动没有被覆盖。
- 升级分支包含升级前确认有效的当前基线改动。
- prompt diff 无非预期变化。
- API 路径、状态字段、日志动作无非预期变化。
- 主要模块人工走查完成。
- 本地 `npm run build` 通过。
- 用户确认升级效果和功能完整性。

合并后再更新：

- `README.md`
- `项目交接上下文.md`
- `docs/project-overview.md`
- `docs/release-and-handoff.md`

仅在升级完成后更新长期文档，避免中途计划污染稳定交接信息。
