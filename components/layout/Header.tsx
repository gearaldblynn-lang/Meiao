import React from 'react';
import { AppModule } from '../../types';

interface Props {
  activeModule: AppModule;
  onBack?: () => void;
}

const Header: React.FC<Props> = ({
  activeModule,
  onBack,
}) => {
  const showBack = activeModule === AppModule.ACCOUNT || activeModule === AppModule.SETTINGS;

  if (!showBack || !onBack) {
    return null;
  }

  return (
    <header className="z-40 shrink-0 border-b border-slate-200/60 bg-white/72 px-4 py-2 backdrop-blur-xl lg:px-5">
      <div className="flex items-center justify-start">
        <button
          type="button"
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-2xl border border-slate-200 bg-white/92 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
          title="返回上一页"
          aria-label="返回上一页"
        >
          <i className="fas fa-arrow-left text-sm" />
        </button>
      </div>
    </header>
  );
};

export default Header;
