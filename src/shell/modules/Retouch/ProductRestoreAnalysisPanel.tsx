import React from 'react';
import type { ProductRestoreProjectContext } from '../../../types';
import { PRODUCT_RESTORE_FOCUS_OPTIONS } from '../../../modules/Retouch/productRestoreContract.mjs';

interface Props {
  context: ProductRestoreProjectContext;
  imageCreditsConsumed?: number;
  totalCreditsConsumed?: number;
  onCopyPrompt: (prompt: string) => void;
}

const MAX_VISIBLE_ITEMS = 6;

const creditLedgerValue = (value: unknown) => {
  if (value === undefined || value === null || value === '') {
    return { present: false, value: 0 };
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0
    ? { present: true, value: parsed }
    : { present: false, value: 0 };
};

const formatCredits = (value: number) => (
  Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '')
);

export const ProductRestoreResultCreditBadge: React.FC<{
  creditsConsumed?: number;
}> = ({ creditsConsumed }) => {
  const credits = creditLedgerValue(creditsConsumed);
  if (!credits.present) return null;
  return (
    <span
      className="rounded-full px-2 py-0.5 font-semibold tabular-nums"
      style={{ background: 'var(--bg-surface)', color: 'var(--accent)' }}
    >
      累计图片消耗 {formatCredits(credits.value)} 积分
    </span>
  );
};

const BoundedList: React.FC<{ title: string; items: string[] }> = ({ title, items }) => {
  if (!Array.isArray(items) || items.length === 0) return null;
  const visibleItems = items.slice(0, MAX_VISIBLE_ITEMS);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>{title}</h4>
      <ul className="space-y-1.5 text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>
        {visibleItems.map((item, index) => (
          <li key={`${title}-${index}`} className="flex gap-2">
            <span aria-hidden="true" style={{ color: 'var(--accent)' }}>•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
      {hiddenCount > 0 && (
        <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>其余 {hiddenCount} 条</p>
      )}
    </section>
  );
};

const ProductRestoreAnalysisPanel: React.FC<Props> = ({
  context,
  imageCreditsConsumed,
  totalCreditsConsumed,
  onCopyPrompt,
}) => {
  const analysis = context.normalizedAnalysis;
  const analysisCredits = creditLedgerValue(context.analysisCreditsConsumed);
  const imageCredits = creditLedgerValue(imageCreditsConsumed);
  const totalCredits = creditLedgerValue(totalCreditsConsumed);
  const focusLabels = PRODUCT_RESTORE_FOCUS_OPTIONS
    .filter((option) => context.focusIds.includes(option.id))
    .map((option) => option.label);

  return (
    <section
      className="space-y-4 rounded-xl border p-4"
      style={{ background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>产品还原分析</h3>
          {context.analysisModel && (
            <p className="mt-1 text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
              分析模型 · {context.analysisModel}
            </p>
          )}
        </div>
        {focusLabels.length > 0 && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {focusLabels.map((label) => (
              <span
                key={label}
                className="rounded-full px-2 py-1 text-[10px] font-medium"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                {label}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg px-3 py-2.5 text-xs leading-5" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
        {analysis.productIdentitySummary}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <BoundedList title="产品身份不变量" items={analysis.invariantFeatures} />
        <BoundedList title="待还原套图问题" items={analysis.targetSetIssues} />
      </div>

      <details className="rounded-lg border px-3 py-2" style={{ borderColor: 'var(--border-subtle)' }}>
        <summary className="cursor-pointer text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
          共享还原 Prompt
        </summary>
        <pre className="mt-3 whitespace-pre-wrap break-words text-[11px] leading-5" style={{ color: 'var(--text-tertiary)' }}>
          {context.sharedRestorationPrompt}
        </pre>
        <button
          type="button"
          className="mt-3 rounded-lg border px-3 py-1.5 text-xs font-medium"
          style={{ borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}
          onClick={() => onCopyPrompt(context.sharedRestorationPrompt)}
        >
          复制共享 Prompt
        </button>
      </details>

      {(analysisCredits.present || imageCredits.present || totalCredits.present) && (
        <div className="grid grid-cols-3 gap-2">
          {analysisCredits.present && (
            <div className="rounded-lg px-3 py-2" style={{ background: 'var(--bg-elevated)' }}>
              <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>分析积分</p>
              <p className="mt-1 text-sm font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCredits(analysisCredits.value)}</p>
            </div>
          )}
          {imageCredits.present && (
            <div className="rounded-lg px-3 py-2" style={{ background: 'var(--bg-elevated)' }}>
              <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>累计图片消耗</p>
              <p className="mt-1 text-sm font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCredits(imageCredits.value)}</p>
            </div>
          )}
          {totalCredits.present && (
            <div className="rounded-lg px-3 py-2" style={{ background: 'var(--bg-elevated)' }}>
              <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>总积分</p>
              <p className="mt-1 text-sm font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{formatCredits(totalCredits.value)}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export default ProductRestoreAnalysisPanel;
