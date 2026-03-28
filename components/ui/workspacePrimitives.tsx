import React from 'react';
import { createPortal } from 'react-dom';

const joinClasses = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(' ');

export const WorkspaceShellCard: React.FC<{
  children: React.ReactNode;
  className?: string;
}> = ({ children, className }) => (
  <div className={joinClasses('rounded-[28px] border border-slate-200/80 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.06)]', className)}>
    {children}
  </div>
);

export const SidebarShell: React.FC<{
  accentClass: string;
  title: string;
  subtitle: string;
  headerContent?: React.ReactNode;
  footer?: React.ReactNode;
  actions?: React.ReactNode;
  widthClassName?: string;
  children: React.ReactNode;
}> = ({ accentClass, title, subtitle, headerContent, footer, actions, widthClassName = 'w-[380px]', children }) => (
  <aside className={joinClasses(widthClassName, 'h-full shrink-0 overflow-hidden border-r border-slate-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#fbfdff_100%)]')}>
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200/70 px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className={joinClasses('h-10 w-2 rounded-full', accentClass)}></div>
              <div className="min-w-0">
                <h2 className="truncate text-lg font-black tracking-tight text-slate-900">{title}</h2>
                <p className="mt-1 text-[10px] font-black uppercase tracking-[0.28em] text-slate-400">{subtitle}</p>
              </div>
            </div>
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
        {headerContent ? <div className="mt-4">{headerContent}</div> : null}
      </div>

      <div className="sidebar-scroll flex-1 overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(248,250,252,0.95),_rgba(255,255,255,1))] px-5 py-5">
        <div className="space-y-4 pb-10">{children}</div>
      </div>

      {footer ? <div className="border-t border-slate-200/70 bg-white/90 p-5 backdrop-blur">{footer}</div> : null}
    </div>
  </aside>
);

export const SectionCard: React.FC<{
  title: string;
  icon?: string;
  accentTextClass?: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}> = ({ title, icon, accentTextClass = 'text-slate-700', description, children, className }) => (
  <WorkspaceShellCard className={joinClasses('overflow-hidden', className)}>
    <div className="border-b border-slate-100 px-4 py-3">
      <div className="flex items-center gap-3">
        {icon ? <i className={joinClasses('fas text-xs', icon, accentTextClass)}></i> : null}
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-600">{title}</div>
          {description ? <p className="mt-1 text-[11px] leading-5 text-slate-400">{description}</p> : null}
        </div>
      </div>
    </div>
    <div className="space-y-4 px-4 py-4">{children}</div>
  </WorkspaceShellCard>
);

export const CollapsibleSection: React.FC<{
  title: string;
  icon?: string;
  accentTextClass?: string;
  description?: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}> = ({ title, icon, accentTextClass = 'text-slate-700', description, expanded, onToggle, children }) => (
  <WorkspaceShellCard className="overflow-hidden">
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-slate-50"
    >
      <div className="flex min-w-0 items-center gap-3">
        {icon ? <i className={joinClasses('fas text-xs', icon, accentTextClass)}></i> : null}
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-600">{title}</div>
          {description ? <p className="mt-1 text-[11px] leading-5 text-slate-400">{description}</p> : null}
        </div>
      </div>
      <i className={joinClasses('fas fa-chevron-down text-[10px] text-slate-400 transition-transform', !expanded && '-rotate-90')}></i>
    </button>
    {expanded ? <div className="border-t border-slate-100 px-4 py-4">{children}</div> : null}
  </WorkspaceShellCard>
);

export const UploadSurface: React.FC<{
  title: string;
  hint: string;
  meta?: string;
  icon: string;
  accentTextClass?: string;
  onClick?: () => void;
  children?: React.ReactNode;
}> = ({ title, hint, meta, icon, accentTextClass = 'text-slate-700', onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    className="group w-full rounded-[24px] border border-dashed border-slate-300 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-6 text-center transition-all hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-[0_12px_30px_rgba(15,23,42,0.08)]"
  >
    <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 transition-transform group-hover:scale-105">
      <i className={joinClasses('far text-xl', icon, accentTextClass)}></i>
    </div>
    <p className="text-sm font-black text-slate-700">{title}</p>
    <p className="mt-2 text-[11px] leading-5 text-slate-500">{hint}</p>
    {meta ? <p className="mt-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{meta}</p> : null}
    {children}
  </button>
);

export const SegmentedTabs = <T extends string>({
  items,
  value,
  onChange,
  accentClass = 'bg-slate-900 text-white',
}: {
  items: Array<{ value: T; label: string; icon?: string }>;
  value: T;
  onChange: (next: T) => void;
  accentClass?: string;
}) => (
  <div className="inline-flex w-full rounded-2xl border border-slate-200 bg-white/90 p-1 shadow-sm">
    {items.map((item) => {
      const active = item.value === value;
      return (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={joinClasses(
            'flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-black transition-all',
            active ? accentClass : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
          )}
        >
          {item.icon ? <i className={joinClasses('fas text-xs', item.icon)}></i> : null}
          <span>{item.label}</span>
        </button>
      );
    })}
  </div>
);

export const PrimaryActionButton: React.FC<{
  label: string;
  icon?: string;
  disabled?: boolean;
  onClick: () => void;
}> = ({ label, icon, disabled = false, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="flex w-full items-center justify-center gap-3 rounded-2xl bg-slate-950 px-5 py-4 text-sm font-black text-white shadow-[0_16px_36px_rgba(15,23,42,0.18)] transition-all hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
  >
    {icon ? <i className={joinClasses('fas text-xs', icon)}></i> : null}
    <span>{label}</span>
  </button>
);

export const SecondaryActionButton: React.FC<{
  label: string;
  icon?: string;
  disabled?: boolean;
  onClick: () => void;
}> = ({ label, icon, disabled = false, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-black text-slate-700 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-100 disabled:bg-slate-100 disabled:text-slate-400"
  >
    {icon ? <i className={joinClasses('fas text-xs', icon)}></i> : null}
    <span>{label}</span>
  </button>
);

export const DangerActionButton: React.FC<{
  label: string;
  icon?: string;
  disabled?: boolean;
  onClick: () => void;
}> = ({ label, icon, disabled = false, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="flex items-center justify-center gap-2 rounded-2xl border border-rose-200 bg-white px-4 py-3 text-sm font-black text-rose-600 shadow-sm transition-all hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-rose-100 disabled:bg-rose-50/50 disabled:text-rose-300"
  >
    {icon ? <i className={joinClasses('fas text-xs', icon)}></i> : null}
    <span>{label}</span>
  </button>
);

export const InfoPill: React.FC<{
  label: string;
  value: string;
}> = ({ label, value }) => (
  <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</div>
    <div className="mt-2 text-lg font-black text-slate-900">{value}</div>
  </div>
);

export const ChoiceGrid: React.FC<{
  items: Array<{ label: string; value: string; icon?: string }>;
  currentValue: string;
  onChange: (next: string) => void;
  activeClassName?: string;
  columnsClassName?: string;
}> = ({ items, currentValue, onChange, activeClassName = 'bg-slate-900 text-white border-slate-900', columnsClassName = 'grid-cols-3' }) => (
  <div className={joinClasses('grid gap-2', columnsClassName)}>
    {items.map((item) => {
      const active = item.value === currentValue;
      return (
        <button
          key={item.value}
          type="button"
          onClick={() => onChange(item.value)}
          className={joinClasses(
            'flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-center transition-all',
            active ? activeClassName : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-800'
          )}
        >
          {item.icon ? <i className={joinClasses('fas text-[10px]', item.icon)}></i> : null}
          <span className="text-[10px] font-black">{item.label}</span>
        </button>
      );
    })}
  </div>
);

export const PopoverSelect = <T extends string>({
  value,
  options,
  onChange,
  placeholder,
  disabled = false,
  className,
  buttonClassName,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  buttonClassName?: string;
}) => {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = React.useState<React.CSSProperties | null>(null);
  const selected = options.find((option) => option.value === value);
  const fallbackOption = selected || options[0];

  const updateMenuPosition = React.useCallback(() => {
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + 8,
      left: rect.left,
      width: rect.width,
      zIndex: 90,
    });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    updateMenuPosition();

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedInsideRoot = rootRef.current?.contains(target);
      const clickedInsideMenu = menuRef.current?.contains(target);
      if (!clickedInsideRoot && !clickedInsideMenu) {
        setOpen(false);
      }
    };

    const handleViewportChange = () => updateMenuPosition();

    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, updateMenuPosition]);

  return (
    <div ref={rootRef} className={joinClasses('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        className={joinClasses(
          'flex h-10 w-full items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 text-left text-xs font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-white disabled:cursor-not-allowed disabled:opacity-50',
          buttonClassName
        )}
      >
        <span className="truncate">{fallbackOption?.label || placeholder || ''}</span>
        <i className={joinClasses('fas fa-chevron-down ml-3 text-[11px] text-slate-400 transition-transform', open && 'rotate-180')}></i>
      </button>
      {open && menuStyle ? createPortal(
        <div ref={menuRef} style={menuStyle} className="overflow-hidden rounded-[24px] border border-white/80 bg-white/72 shadow-[0_18px_40px_rgba(15,23,42,0.10)] backdrop-blur-2xl">
          <div className="max-h-64 overflow-y-auto p-2">
            {options.map((option) => {
              const active = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={joinClasses(
                    'flex w-full items-center rounded-[18px] px-4 py-2.5 text-left text-sm transition-colors',
                    active ? 'bg-white/92 text-slate-900 shadow-sm' : 'text-slate-600 hover:bg-white/80 hover:text-slate-900'
                  )}
                >
                  <span className={joinClasses('truncate', active && 'font-semibold')}>{option.label}</span>
                  {active ? <i className="fas fa-check ml-auto text-xs text-rose-500"></i> : null}
                </button>
              );
            })}
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
};
