
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PERSISTENCE_KEY } from './utils/appState';
import { releaseAllObjectURLs } from './utils/urlUtils';

interface ErrorBoundaryProps {
  children?: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class RootErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  declare props: Readonly<ErrorBoundaryProps>;

  state: ErrorBoundaryState = {
    hasError: false,
    errorMessage: '',
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || '未知错误',
    };
  }

  componentDidCatch(error: Error) {
    console.error('Root render failed:', error);
  }

  handleReset = () => {
    try {
      releaseAllObjectURLs();
      localStorage.removeItem(PERSISTENCE_KEY);
    } catch (error) {
      console.error('Failed to clear persisted state:', error);
    }
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="h-screen w-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-2xl w-full bg-white border border-rose-100 rounded-[32px] shadow-xl p-8">
          <p className="text-[10px] font-black uppercase tracking-[0.28em] text-rose-500">Page Recovery</p>
          <h1 className="mt-3 text-2xl font-black text-slate-900">页面启动时发生错误</h1>
          <p className="mt-3 text-sm font-bold text-slate-500 leading-7">
            这通常是当前浏览器里的本地缓存状态和新代码不兼容导致的。我们先清掉这份本地缓存，再重新加载页面。
          </p>
          <div className="mt-5 rounded-2xl bg-slate-50 border border-slate-200 p-4 text-xs font-bold text-slate-600 break-all">
            {this.state.errorMessage}
          </div>
          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={this.handleReset}
              className="px-5 py-3 rounded-2xl bg-slate-900 text-white text-sm font-black hover:bg-slate-800 transition-colors"
            >
              清空本地缓存并重开
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-5 py-3 rounded-2xl bg-slate-100 text-slate-700 text-sm font-black hover:bg-slate-200 transition-colors"
            >
              直接重试
            </button>
          </div>
        </div>
      </div>
    );
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);
