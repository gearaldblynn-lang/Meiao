import React, {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Check, ChevronDown, Loader2 } from 'lucide-react';

import { isImeComposing } from '../../../utils/ime';

export type ComposerSelectOption = string | {
  value: string;
  label: string;
};

const toSelectOption = (option: ComposerSelectOption) => (
  typeof option === 'string' ? { value: option, label: option } : option
);

export type ComposerSurfaceProps = HTMLAttributes<HTMLDivElement> & {
  highlighted?: boolean;
  invalid?: boolean;
};

export const ComposerSurface: React.FC<ComposerSurfaceProps> = ({
  children,
  className = '',
  highlighted = false,
  invalid = false,
  style,
  ...props
}) => (
  <div
    {...props}
    className={`relative mx-auto w-full max-w-[896px] rounded-3xl border transition-all ${className}`.trim()}
    style={{
      borderColor: invalid
        ? 'var(--danger)'
        : highlighted
          ? 'var(--accent)'
          : 'var(--border-subtle)',
      background: 'var(--bg-surface)',
      boxShadow: highlighted ? '0 0 0 3px var(--accent-soft)' : 'none',
      ...style,
    }}
  >
    {children}
  </div>
);

export const ComposerToolbar: React.FC<HTMLAttributes<HTMLDivElement> & {
  spacious?: boolean;
}> = ({
  children,
  className = '',
  spacious = false,
  ...props
}) => (
  <div
    {...props}
    className={`flex flex-wrap items-end justify-between gap-3 px-3 ${spacious ? 'py-5' : 'pb-3'} ${className}`.trim()}
  >
    {children}
  </div>
);

export type ComposerCapsuleButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  icon?: ReactNode;
  label: ReactNode;
  trailingIcon?: ReactNode;
};

export const ComposerCapsuleButton: React.FC<ComposerCapsuleButtonProps> = ({
  active = false,
  icon,
  label,
  trailingIcon,
  className = '',
  style,
  type = 'button',
  ...props
}) => (
  <button
    {...props}
    type={type}
    className={`flex items-center gap-1 rounded-2xl px-3 py-1.5 text-[11px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-45 ${className}`.trim()}
    style={{
      color: active ? 'var(--accent)' : 'var(--text-secondary)',
      background: active ? 'var(--accent-soft)' : 'var(--bg-elevated)',
      ...style,
    }}
  >
    {icon}
    <span className="max-w-[142px] truncate">{label}</span>
    {trailingIcon}
  </button>
);

export const ComposerSelect: React.FC<{
  value: string;
  options: Array<ComposerSelectOption>;
  onChange: (value: string) => void;
  icon?: ReactNode;
  title?: string;
  allowCustom?: boolean;
  recommendedValue?: string;
  recommendedLabel?: string;
  secondaryRecommendedValue?: string;
  secondaryRecommendedLabel?: string;
  getOptionMeta?: (value: string) => string;
  disabled?: boolean;
}> = ({
  value,
  options,
  onChange,
  icon,
  title,
  allowCustom,
  recommendedValue,
  recommendedLabel = '推荐',
  secondaryRecommendedValue,
  secondaryRecommendedLabel = '常用',
  getOptionMeta,
  disabled,
}) => {
  const [open, setOpen] = useState(false);
  const [customInputs, setCustomInputs] = useState(false);
  const [customValue, setCustomValue] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, []);

  const commitCustom = () => {
    const next = customValue.trim();
    if (!next) return;
    const isCount = title?.includes('数量') || title?.includes('张数') || title?.includes('屏数');
    onChange(isCount ? next.replace(/[^\d]/g, '') || next : next);
    setCustomInputs(false);
    setCustomValue('');
    setOpen(false);
  };

  const isRecommended = Boolean(recommendedValue && value === recommendedValue);
  const isSecondaryRecommended = Boolean(
    secondaryRecommendedValue && value === secondaryRecommendedValue,
  );
  const selectedOption = options.map(toSelectOption).find((option) => option.value === value);
  const displayValue = selectedOption?.label || value;
  const isModelSelect = title?.includes('模型');
  const isResolutionSelect = Boolean(
    title && (title.includes('分辨率') || title.includes('渲染质量')),
  );
  const displayClassName = isModelSelect ? 'max-w-[142px] truncate' : 'max-w-[92px] truncate';
  const isCount = title?.includes('数量') || title?.includes('张数') || title?.includes('屏数');

  return (
    <div ref={ref} className="relative">
      <ComposerCapsuleButton
        active={open}
        disabled={disabled}
        onClick={() => {
          if (!disabled) setOpen((current) => !current);
        }}
        icon={icon}
        label={(
          <>
            <span className={displayClassName}>
              {isCount ? `${String(value).replace(/[^\d]/g, '') || value}张` : displayValue}
            </span>
            {isRecommended ? (
              <span
                className="ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-black"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                {recommendedLabel}
              </span>
            ) : isSecondaryRecommended ? (
              <span
                className="ml-1 rounded-full px-1.5 py-0.5 text-[9px] font-black"
                style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                {secondaryRecommendedLabel}
              </span>
            ) : null}
          </>
        )}
        trailingIcon={(
          <ChevronDown
            size={9}
            className="transition-transform"
            style={{ transform: open ? 'rotate(180deg)' : 'none' }}
          />
        )}
        aria-label={title}
        aria-haspopup="listbox"
        aria-expanded={open}
      />

      {open && !disabled ? (
        <div
          role="listbox"
          aria-label={title}
          className={`absolute bottom-full left-0 z-[200] mb-1.5 rounded-2xl border px-1.5 py-2 ${isModelSelect ? 'min-w-[240px]' : 'min-w-[170px]'}`}
          style={{
            background: 'var(--bg-surface)',
            borderColor: 'var(--border-subtle)',
            boxShadow: 'var(--shadow-elevated)',
          }}
        >
          {title ? (
            <div
              className="mb-1 border-b px-3 pb-1.5"
              style={{ borderColor: 'var(--border-subtle)' }}
            >
              <span className="text-[10px] font-medium" style={{ color: 'var(--text-tertiary)' }}>
                {title}
              </span>
            </div>
          ) : null}

          {customInputs ? (
            <div className="px-2 pb-1 pt-1">
              <input
                autoFocus
                value={customValue}
                onChange={(event) => setCustomValue(event.target.value)}
                onKeyDown={(event) => {
                  if (isImeComposing(event)) return;
                  if (event.key === 'Enter') commitCustom();
                  if (event.key === 'Escape') setCustomInputs(false);
                }}
                placeholder="请输入自定义"
                className="input-field w-full rounded-2xl px-3 py-2 text-[12px]"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={commitCustom}
                  className="flex-1 rounded-2xl px-3 py-1.5 text-[11px] font-medium"
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  确定
                </button>
                <button
                  type="button"
                  onClick={() => setCustomInputs(false)}
                  className="rounded-2xl px-3 py-1.5 text-[11px] font-medium"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-tertiary)' }}
                >
                  返回
                </button>
              </div>
            </div>
          ) : options.map((optionItem) => {
            const option = toSelectOption(optionItem);
            const active = option.value === value;
            const optionMeta = getOptionMeta?.(option.value);
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-[12px] transition-colors"
                style={{
                  color: active ? 'var(--accent)' : 'var(--text-secondary)',
                  background: active ? 'var(--accent-soft)' : 'transparent',
                }}
              >
                {active ? <Check size={11} /> : null}
                <span className="flex min-w-0 flex-col items-start">
                  <span className="truncate">{option.label}</span>
                  {(isModelSelect || isResolutionSelect) && optionMeta ? (
                    <span
                      className="mt-0.5 text-[10px] font-medium"
                      style={{ color: active ? 'var(--accent)' : 'var(--text-tertiary)' }}
                    >
                      {optionMeta}
                    </span>
                  ) : null}
                </span>
                {recommendedValue && option.value === recommendedValue ? (
                  <span
                    className="ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-black"
                    style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    {recommendedLabel}
                  </span>
                ) : secondaryRecommendedValue && option.value === secondaryRecommendedValue ? (
                  <span
                    className="ml-auto rounded-full px-1.5 py-0.5 text-[9px] font-black"
                    style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}
                  >
                    {secondaryRecommendedLabel}
                  </span>
                ) : null}
              </button>
            );
          })}

          {allowCustom && !customInputs ? (
            <button
              type="button"
              onClick={() => setCustomInputs(true)}
              className="mt-1 flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-[12px] transition-colors"
              style={{ color: 'var(--accent)', background: 'var(--accent-soft)' }}
            >
              <span>+ 自定义</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export const ComposerSubmitButton: React.FC<
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
    busy?: boolean;
    icon: ReactNode;
    label: string;
  }
> = ({
  busy = false,
  icon,
  label,
  className = '',
  style,
  type = 'button',
  ...props
}) => (
  <button
    {...props}
    type={type}
    className={`flex items-center gap-2 rounded-3xl px-5 py-2.5 text-[13px] font-semibold text-white transition-all disabled:cursor-not-allowed disabled:opacity-30 ${className}`.trim()}
    style={{ background: 'var(--accent)', ...style }}
  >
    {busy ? <Loader2 size={14} className="animate-spin" /> : icon}
    <span>{label}</span>
  </button>
);
