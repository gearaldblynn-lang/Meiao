# 全局外壳压缩与智能体中心高度重分配 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把顶部模块识别和右上角全局入口从页面主视觉里拿掉，收口到左侧底部用户区，并同步压缩智能体中心头部，把更多高度让给工作区和会话区。

**Architecture:** 保留 `Header` 作为最小外壳层，避免全局弹层与安全区失效；把版本、服务状态、通知、帮助、系统设置、账号管理、退出登录整合进 `SidebarNavigation` 底部用户面板。智能体中心内部再压缩首页头部和工作室页头，统一把高度优先让给内容区。

**Tech Stack:** React、TypeScript、Tailwind、node:test、tsc

---

### Task 1: 建立全局壳层改造的失败测试

**Files:**
- Modify: `components/uiArchitecture.test.mjs`
- Test: `components/uiArchitecture.test.mjs`

- [ ] **Step 1: 写失败测试，锁定新壳层结构**

```js
test('global shell moves release status and account tools into the sidebar user hub while shrinking the header', () => {
  const header = read('./layout/Header.tsx');
  const sidebar = read('./layout/SidebarNavigation.tsx');
  const app = read('../App.tsx');

  assert.doesNotMatch(header, /meta\.title/);
  assert.doesNotMatch(header, /toggleCenter/);
  assert.doesNotMatch(header, /onOpenReleaseNotes/);
  assert.match(header, /showBack/);
  assert.match(sidebar, /releaseTag: string/);
  assert.match(sidebar, /serviceStatusLabel/);
  assert.match(sidebar, /toggleCenter/);
  assert.match(sidebar, /onOpenReleaseNotes/);
  assert.match(sidebar, /onLogout/);
  assert.match(app, /releaseTag=\{APP_RELEASE_VERSION\}/);
  assert.match(app, /serviceStatusLabel=\{internalMode \? '服务正常' : '单机本地模式'\}/);
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test components/uiArchitecture.test.mjs`
Expected: FAIL，提示 `Header.tsx` 仍然包含模块标题和右上角入口逻辑，`SidebarNavigation.tsx` 还没有用户工作台入口。

- [ ] **Step 3: 提交测试代码**

```bash
git add components/uiArchitecture.test.mjs
git commit -m "test: lock compact global shell architecture"
```

### Task 2: 改造 Header 为最小外壳层

**Files:**
- Modify: `components/layout/Header.tsx`
- Modify: `App.tsx`
- Test: `components/uiArchitecture.test.mjs`

- [ ] **Step 1: 写最小实现，移除 Header 中重复的模块识别和右上角全局入口**

```tsx
const Header: React.FC<Props> = ({
  activeModule,
  currentUser = null,
  internalMode = false,
  onBack,
}) => {
  const showBack = activeModule === AppModule.ACCOUNT || activeModule === AppModule.SETTINGS;

  return (
    <header className="z-40 shrink-0 border-b border-slate-200/60 bg-white/72 px-5 py-2.5 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-h-10 items-center gap-3">
          {showBack && onBack ? (
            <button
              type="button"
              onClick={onBack}
              className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white/92 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
              title="返回上一页"
              aria-label="返回上一页"
            >
              <i className="fas fa-arrow-left text-sm" />
            </button>
          ) : (
            <div className="h-10" />
          )}
        </div>

        <div className="hidden items-center gap-2 lg:flex">
          {internalMode && currentUser ? (
            <span className="text-[11px] font-medium text-slate-400">
              当前登录：{currentUser.username}
            </span>
          ) : null}
        </div>
      </div>
    </header>
  );
};
```

- [ ] **Step 2: 在 `App.tsx` 中删掉 Header 已不再需要的 props 透传**

```tsx
<Header
  activeModule={activeModule}
  currentUser={currentUser}
  internalMode={internalMode}
  onBack={handleBackFromSystemPage}
/>
```

- [ ] **Step 3: 跑测试确认 Header 压缩通过**

Run: `node --test components/uiArchitecture.test.mjs`
Expected: 与 Header 相关的新断言变为 PASS，其他旧断言若失败则记录下来，继续下一任务统一修正。

### Task 3: 在 SidebarNavigation 落地底部用户工作台入口

**Files:**
- Modify: `components/layout/SidebarNavigation.tsx`
- Modify: `App.tsx`
- Possibly Modify: `components/ToastSystem.tsx`
- Test: `components/uiArchitecture.test.mjs`

- [ ] **Step 1: 扩展 SidebarNavigation props，接收全局状态与操作**

```tsx
interface Props {
  activeModule: AppModule;
  onModuleChange: (module: AppModule, options?: { accountView?: 'profile' | 'manage' }) => void;
  showSystemEntries?: boolean;
  currentUser?: AuthUser | null;
  internalMode?: boolean;
  releaseTag: string;
  serviceStatusLabel: string;
  onOpenReleaseNotes?: () => void;
  onLogout?: () => void;
}
```

- [ ] **Step 2: 在 SidebarNavigation 底部新增用户工作台入口和聚合弹层**

```tsx
const [userHubOpen, setUserHubOpen] = useState(false);
const { unreadCount, toggleCenter } = useToast();

<div className="mt-auto w-full pt-3">
  {showSystemEntries ? <div className="sys-grid mb-3 w-full">{systemItems.map((item) => renderNavButton(item, 'system'))}</div> : null}

  {internalMode && currentUser ? (
    <div className="relative w-full">
      <button
        type="button"
        onClick={() => setUserHubOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-[18px] border border-white/10 bg-white/8 px-2 py-2 text-left text-white/92"
      >
        <UserAvatar ... />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-black">{currentUser.username}</p>
          <p className="truncate text-[10px] text-white/56">{currentUser.role === 'admin' ? '管理员' : '个人资料'}</p>
        </div>
        <i className={`fas fa-chevron-up text-[10px] transition ${userHubOpen ? '' : 'rotate-180'}`} />
      </button>

      {userHubOpen ? (
        <div className="absolute bottom-[calc(100%+10px)] left-0 w-[248px] rounded-[24px] border border-white/16 bg-slate-950/88 p-2 text-white shadow-[0_24px_60px_rgba(2,6,23,0.42)] backdrop-blur-2xl">
          ...
        </div>
      ) : null}
    </div>
  ) : null}
</div>
```

- [ ] **Step 3: 把版本、服务状态、通知、帮助、账号入口都接到用户工作台弹层**

```tsx
<button type="button" onClick={onOpenReleaseNotes} ...>{releaseTag}</button>
<div className="..."> <span className="h-2 w-2 rounded-full bg-emerald-400" /> {serviceStatusLabel} </div>
<button type="button" onClick={toggleCenter} ...>通知中心</button>
<button type="button" onClick={() => setShowHelp(true)} ...>使用帮助</button>
<button type="button" onClick={() => onModuleChange(AppModule.ACCOUNT, { accountView: 'profile' })} ...>个人资料</button>
<button type="button" onClick={() => onModuleChange(AppModule.ACCOUNT, { accountView: 'manage' })} ...>账号管理</button>
<button type="button" onClick={() => onModuleChange(AppModule.SETTINGS)} ...>系统设置</button>
<button type="button" onClick={() => onLogout?.()} ...>退出登录</button>
```

- [ ] **Step 4: 在 `App.tsx` 中把这些 props 传入 SidebarNavigation**

```tsx
<SidebarNavigation
  activeModule={activeModule}
  onModuleChange={handleModuleChange}
  showSystemEntries={!internalMode}
  currentUser={currentUser}
  internalMode={internalMode}
  releaseTag={APP_RELEASE_VERSION}
  serviceStatusLabel={internalMode ? '服务正常' : '单机本地模式'}
  onOpenReleaseNotes={openReleaseNotes}
  onLogout={onLogout}
/>
```

- [ ] **Step 5: 跑测试确认全局入口迁移通过**

Run: `node --test components/uiArchitecture.test.mjs`
Expected: 新增“global shell…”测试通过，原有“release notes…”相关断言需要根据入口迁移结果一并更新为 PASS。

### Task 4: 压缩智能体中心首页头部与工作室头部

**Files:**
- Modify: `modules/AgentCenter/AgentCenterModule.tsx`
- Modify: `modules/AgentCenter/AgentStudioWorkspace.tsx`
- Possibly Modify: `modules/AgentCenter/AgentCenterManager.tsx`
- Test: `components/uiArchitecture.test.mjs`

- [ ] **Step 1: 为智能体中心首页写失败测试，锁定去大头部结构**

```js
test('agent center removes the oversized landing header and keeps compact workspace switches', () => {
  const module = read('../modules/AgentCenter/AgentCenterModule.tsx');
  const studio = read('../modules/AgentCenter/AgentStudioWorkspace.tsx');

  assert.doesNotMatch(module, /<h2 className="text-3xl font-black text-slate-900">智能体中心<\/h2>/);
  assert.doesNotMatch(module, /当前登录：/);
  assert.match(module, /智能体工厂/);
  assert.match(module, /智能体广场/);
  assert.match(module, /智能体/);
  assert.match(module, /知识库/);
  assert.doesNotMatch(studio, /px-5 py-4/);
});
```

- [ ] **Step 2: 压缩 `AgentCenterModule.tsx` 的首页头部**

```tsx
<section className="rounded-[30px] border border-white/70 bg-white/74 px-4 py-3 shadow-[0_22px_44px_rgba(15,23,42,0.08)] backdrop-blur-xl">
  <div className="flex items-center justify-between gap-3">
    <div className="inline-flex rounded-[22px] border border-slate-200/80 bg-white/88 p-1">
      ...
    </div>
    {canManage ? (
      <div className="inline-flex rounded-[22px] border border-slate-200/80 bg-white/88 p-1">
        ...
      </div>
    ) : null}
  </div>
</section>
```

- [ ] **Step 3: 压缩 `AgentStudioWorkspace.tsx` 头部高度与留白**

```tsx
<div className={`${glassPanel} px-4 py-3`}>
  <div className="flex items-center justify-between gap-3">
    ...
    <AgentAvatar ... className="h-10 w-10 rounded-[15px] ..." />
    <p className="text-[14px] font-black ...">{agent.name}</p>
    <p className="text-[11px] font-medium ...">工作室 · 草稿 v{currentVersion.versionNo}</p>
    ...
  </div>
</div>
```

- [ ] **Step 4: 跑测试确认智能体中心压缩通过**

Run: `node --test components/uiArchitecture.test.mjs`
Expected: 智能体中心与工作室结构断言全部 PASS。

### Task 5: 压缩训练/测试输入与消息区的垂直占位

**Files:**
- Modify: `modules/AgentCenter/AgentStudioTrainingPane.tsx`
- Modify: `modules/AgentCenter/AgentStudioTestingPane.tsx`
- Modify: `modules/AgentCenter/ChatComposer.tsx`
- Test: `components/uiArchitecture.test.mjs`

- [ ] **Step 1: 调整训练/测试页头部状态条高度**

```tsx
<div className="rounded-[20px] border border-slate-200/80 bg-white/92 px-3.5 py-2 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
  ...
</div>
```

- [ ] **Step 2: 把 ChatComposer 做成更紧凑的一体化输入容器**

```tsx
<div className="rounded-[20px] border border-slate-200/85 bg-white/96 px-3 py-2.5 shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
  <div className="flex items-center gap-2">
    ...
  </div>
  <div className="mt-2">
    <textarea ... className="min-h-[84px] ..." />
  </div>
</div>
```

- [ ] **Step 3: 确保消息区继续是主滚动区，不把整页重新做成长滚动**

```tsx
<div className="mt-2 min-h-0 flex-1 overflow-y-auto rounded-[20px] ...">
  ...
</div>
```

- [ ] **Step 4: 跑测试确认训练/测试布局相关断言仍通过**

Run: `node --test components/uiArchitecture.test.mjs`
Expected: 工作室训练/测试页既保留统一聊天能力入口，又没有因压缩布局丢失功能控件。

### Task 6: 全量验证与收尾

**Files:**
- Verify only

- [ ] **Step 1: 跑 UI 架构测试**

Run: `node --test components/uiArchitecture.test.mjs`
Expected: PASS

- [ ] **Step 2: 跑智能体相关源码测试**

Run: `node --test server/agentCenterSource.test.mjs server/providerGateway.test.mjs`
Expected: PASS

- [ ] **Step 3: 跑 TypeScript 校验**

Run: `npm run lint`
Expected: PASS

- [ ] **Step 4: 跑本地工作室冒烟**

Run: `node scripts/local-studio-smoke.mjs`
Expected: 输出 `工作室本地冒烟测试通过。`

- [ ] **Step 5: 总结结果并准备下一轮 UI 微调**

```text
记录以下结果：
- 顶部是否已经移除模块识别与右上角功能堆叠
- 左侧底部用户区是否可打开并可进入通知、版本说明、系统设置、账号管理
- 智能体中心首屏是否比改造前明显更高
- 工作室消息区是否明显增高
```
