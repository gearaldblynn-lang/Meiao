import React from 'react';
import type { SubFeatureOption } from '../../ShellMigratedApp';

interface Props {
  items?: SubFeatureOption[];
  activeId?: string;
  onChange?: (id: string) => void;
}

const SubFeatureTabs: React.FC<Props> = ({ items = [], activeId, onChange }) => {
  if (items.length <= 1) return null;
  return (
    <div className="overflow-x-auto scrollbar-none">
      <div
        className="mx-auto inline-flex min-w-fit items-center gap-0.5 rounded-full px-1 py-1"
        style={{ background: 'var(--bg-elevated)' }}
      >
        {items.map((item) => {
          const active = item.id === activeId;
          const disabledLabel = item.description || '待制作';
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => !item.disabled && onChange?.(item.id)}
              disabled={item.disabled}
              title={item.disabled ? disabledLabel : item.description}
              className="min-w-[84px] rounded-full px-3 py-1.5 text-center text-[12px] font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                background: active ? 'var(--bg-surface)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                boxShadow: active ? 'var(--shadow-card)' : 'none',
              }}
            >
              <span className="block">{item.label}</span>
              {item.disabled && <span className="mt-0.5 block text-[9px] font-medium">{disabledLabel}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default SubFeatureTabs;
