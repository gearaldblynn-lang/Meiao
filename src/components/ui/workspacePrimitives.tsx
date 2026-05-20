import React from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  Circle,
  Code2,
  File,
  FileText,
  FolderOpen,
  Globe,
  HelpCircle,
  Image,
  Link,
  ListChecks,
  LoaderCircle,
  Paperclip,
  PlayCircle,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Square,
  SquarePen,
  StopCircle,
  Trash2,
  Upload,
  Download,
  Video,
  Wand2,
  X,
} from 'lucide-react';

const joinClasses = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(' ');

export const LegacyFaIcon: React.FC<{ icon?: string; className?: string; style?: React.CSSProperties }> = ({ icon = '', className, style }) => {
  const lowerIcon = icon.toLowerCase();
  const sizeClass = className?.match(/text-\[[^\]]+\]|text-(?:xs|sm|base|lg|xl|2xl|3xl|4xl)/)?.[0] || 'text-xs';
  const Icon =
    lowerIcon.includes('exclamation') || lowerIcon.includes('triangle') ? AlertTriangle :
    lowerIcon.includes('sliders') ? SlidersHorizontal :
    lowerIcon.includes('book') ? BookOpen :
    lowerIcon.includes('vial') || lowerIcon.includes('test') ? ListChecks :
    lowerIcon.includes('code-branch') ? Code2 :
    lowerIcon.includes('spinner') ? LoaderCircle :
    lowerIcon.includes('angles-left') ? ChevronsLeft :
    lowerIcon.includes('angles-right') ? ChevronsRight :
    lowerIcon.includes('chevron-left') ? ChevronLeft :
    lowerIcon.includes('chevron-right') ? ChevronRight :
    lowerIcon.includes('chevron-up') ? ChevronUp :
    lowerIcon.includes('chevron') ? ChevronDown :
    lowerIcon.includes('arrow-left') ? ArrowLeft :
    lowerIcon.includes('arrow-right') ? ArrowRight :
    lowerIcon.includes('arrow-up') ? ArrowUp :
    lowerIcon.includes('download') ? Download :
    lowerIcon.includes('upload') ? Upload :
    lowerIcon.includes('folder') ? FolderOpen :
    lowerIcon.includes('paperclip') ? Paperclip :
    lowerIcon.includes('image') || lowerIcon.includes('file-image') ? Image :
    lowerIcon.includes('file-lines') || lowerIcon.includes('file-pdf') ? FileText :
    lowerIcon.includes('video') || lowerIcon.includes('clapperboard') ? Video :
    lowerIcon.includes('brain') || lowerIcon.includes('robot') ? Brain :
    lowerIcon.includes('check') ? CheckCircle2 :
    lowerIcon.includes('plus') ? Plus :
    lowerIcon.includes('trash') ? Trash2 :
    lowerIcon.includes('xmark') || lowerIcon.includes('times') ? X :
    lowerIcon.includes('question') ? HelpCircle :
    lowerIcon.includes('globe') ? Globe :
    lowerIcon.includes('search') || lowerIcon.includes('magnifying') ? Search :
    lowerIcon.includes('stop') ? StopCircle :
    lowerIcon.includes('pen-to-square') ? SquarePen :
    lowerIcon.includes('play') ? PlayCircle :
    lowerIcon.includes('wand') || lowerIcon.includes('magic') ? Wand2 :
    lowerIcon.includes('link') ? Link :
    lowerIcon.includes('gear') || lowerIcon.includes('cog') ? Settings :
    lowerIcon.includes('circle') ? Circle :
    File;

  return <Icon className={joinClasses('inline-block h-[1em] w-[1em] shrink-0', sizeClass, className)} style={style} aria-hidden="true" />;
};

export const WorkspaceShellCard = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(({ children, className, ...props }, ref) => (
  <div
    ref={ref}
    className={joinClasses('rounded-[28px] border border-slate-200/80 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.06)]', className)}
    {...props}
  >
    {children}
  </div>
));
WorkspaceShellCard.displayName = 'WorkspaceShellCard';

export const SidebarShell: React.FC<{
  accentClass: string;
  title: string;
  subtitle: string;
  headerContent?: React.ReactNode;
  footer?: React.ReactNode;
  actions?: React.ReactNode;
  widthClassName?: string;
  titleClassName?: string;
  subtitleClassName?: string;
  children: React.ReactNode;
}> = ({
  accentClass,
  title,
  subtitle,
  headerContent,
  footer,
  actions,
  widthClassName = 'w-[380px]',
  titleClassName,
  subtitleClassName,
  children,
}) => (
  <aside className={joinClasses(widthClassName, 'h-full shrink-0 overflow-hidden border-r border-slate-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#fbfdff_100%)]')}>
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-200/70 px-6 py-5">
        {headerContent ? <div className="mb-4">{headerContent}</div> : null}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-3">
              <div className={joinClasses('h-10 w-2 rounded-full', accentClass)}></div>
              <div className="min-w-0">
                <h2 className={joinClasses('truncate text-lg font-black tracking-tight text-slate-900', titleClassName)}>{title}</h2>
                <p className={joinClasses('mt-1 text-[10px] font-black uppercase tracking-[0.28em] text-slate-400', subtitleClassName)}>{subtitle}</p>
              </div>
            </div>
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
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
        {icon ? <LegacyFaIcon icon={icon} className={joinClasses('text-xs', accentTextClass)} /> : null}
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
        {icon ? <LegacyFaIcon icon={icon} className={joinClasses('text-xs', accentTextClass)} /> : null}
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-600">{title}</div>
          {description ? <p className="mt-1 text-[11px] leading-5 text-slate-400">{description}</p> : null}
        </div>
      </div>
      <LegacyFaIcon icon="fa-chevron-down" className={joinClasses('text-[10px] text-slate-400 transition-transform', !expanded && '-rotate-90')} />
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
      <LegacyFaIcon icon={icon} className={joinClasses('text-xl', accentTextClass)} />
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
          {item.icon ? <LegacyFaIcon icon={item.icon} className="text-xs" /> : null}
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
    {icon ? <LegacyFaIcon icon={icon} className="text-xs" /> : null}
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
    {icon ? <LegacyFaIcon icon={icon} className="text-xs" /> : null}
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
    {icon ? <LegacyFaIcon icon={icon} className="text-xs" /> : null}
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
          {item.icon ? <LegacyFaIcon icon={item.icon} className="text-[10px]" /> : null}
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
          'flex h-10 w-full items-center justify-between rounded-2xl border px-4 text-left text-xs font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-50',
          buttonClassName
        )}
        style={{
          background: 'var(--bg-input)',
          borderColor: 'var(--border-subtle)',
          color: 'var(--text-primary)',
        }}
      >
        <span className="truncate">{fallbackOption?.label || placeholder || ''}</span>
        <LegacyFaIcon icon="fa-chevron-down" className={joinClasses('ml-3 text-[11px] transition-transform', open && 'rotate-180')} style={{ color: 'var(--text-tertiary)' }} />
      </button>
      {open && menuStyle ? createPortal(
        <div ref={menuRef} style={{ ...menuStyle, background: 'var(--bg-surface)', borderColor: 'var(--border-subtle)' }} className="overflow-hidden rounded-[20px] border shadow-[0_18px_40px_rgba(15,23,42,0.10)]">
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
                  className="flex w-full items-center rounded-[16px] px-4 py-2.5 text-left text-sm transition-colors"
                  style={active
                    ? { background: 'var(--accent-soft)', color: 'var(--accent)' }
                    : { color: 'var(--text-secondary)' }}
                >
                  <span className={joinClasses('truncate', active && 'font-semibold')}>{option.label}</span>
                  {active ? <LegacyFaIcon icon="fa-check" className="ml-auto text-xs" style={{ color: 'var(--accent)' }} /> : null}
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
