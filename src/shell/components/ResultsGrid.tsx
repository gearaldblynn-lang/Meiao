import React from 'react';
import ResultCard from './ResultCard';
import type { GeneratedResult } from '../../ShellMigratedApp';

interface Props {
  results: GeneratedResult[];
  title: string;
  description: string;
  emptyIcon: React.ReactNode;
  emptyTitle: string;
  emptySubtitle: string;
  onDelete?: (id: string) => void;
  onRegenerate?: (id: string) => void;
  toolbar?: React.ReactNode;
}

const ResultsGrid: React.FC<Props> = ({
  results, title, description, emptyIcon, emptyTitle, emptySubtitle,
  onDelete, onRegenerate, toolbar,
}) => (
  <div className="p-5">
    <div className="mb-5 flex items-end justify-between">
      <div>
        <h2 className="text-[18px] font-semibold tracking-[-0.01em]" style={{ color: 'var(--text-primary)' }}>{title}</h2>
        <p className="mt-1 text-[13px]" style={{ color: 'var(--text-tertiary)' }}>{description}</p>
      </div>
      <div className="flex items-center gap-2">
        {results.length > 0 && <span className="pill">{results.length} 张</span>}
        {toolbar}
      </div>
    </div>
    {results.length > 0 ? (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-3">
        {results.map((r, i) => (
          <div key={r.id} style={{ animation: `fade-in-up 0.25s ease ${i * 0.04}s both` }}>
            <ResultCard result={r} onDelete={onDelete} onRegenerate={onRegenerate} />
          </div>
        ))}
      </div>
    ) : (
      <div className="flex flex-col items-center justify-center py-28 text-center">
        <div className="flex h-[68px] w-[68px] items-center justify-center rounded-2xl mb-4 surface">
          <div style={{ color: 'var(--text-disabled)' }}>{emptyIcon}</div>
        </div>
        <p className="text-[15px] font-medium" style={{ color: 'var(--text-secondary)' }}>{emptyTitle}</p>
        <p className="mt-1.5 text-[13px] max-w-sm" style={{ color: 'var(--text-tertiary)' }}>{emptySubtitle}</p>
      </div>
    )}
  </div>
);

export default ResultsGrid;