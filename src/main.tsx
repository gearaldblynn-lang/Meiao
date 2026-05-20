import { createRoot } from 'react-dom/client'
import './index.css'

if (import.meta.env.DEV && typeof window !== 'undefined') {
  const trace = { label: 'main:loaded', t: performance.now() };
  (window as typeof window & { __MEIAO_STARTUP_TRACE__?: typeof trace[] }).__MEIAO_STARTUP_TRACE__ = [trace];
  console.info(`[MEIAO startup] ${trace.label} ${trace.t.toFixed(1)}ms`);
}

const root = createRoot(document.getElementById('root')!)

const renderBootScreen = () => {
  root.render(
    <div
      className="flex h-screen w-screen items-center justify-center"
      style={{ background: 'var(--bg-base)', color: 'var(--text-tertiary)' }}
    >
      <div className="flex items-center gap-3">
        <div
          className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
        <span className="text-sm">正在加载工作台...</span>
      </div>
    </div>,
  )
}

renderBootScreen()

if (import.meta.env.DEV && typeof window !== 'undefined') {
  console.info('[MEIAO startup] shell-import:start')
}

void import('./ShellMigratedApp.tsx').then(({ default: App }) => {
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    console.info('[MEIAO startup] shell-import:end')
  }
  root.render(<App />)
}).catch((error) => {
  console.error('[MEIAO startup] shell-import:error', error)
  root.render(
    <div
      className="flex h-screen w-screen items-center justify-center"
      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)' }}
    >
      <div className="text-center space-y-3">
        <div className="text-base font-medium">工作台加载失败</div>
        <div className="text-sm" style={{ color: 'var(--text-tertiary)' }}>请刷新页面重试</div>
      </div>
    </div>,
  )
})
