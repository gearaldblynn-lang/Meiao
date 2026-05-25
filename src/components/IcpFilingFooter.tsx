export const ICP_FILING_DOMAIN = 'http://meiaoyuntai.com';
export const ICP_FILING_NUMBER = '浙ICP备2026015528号-1';
export const ICP_FILING_URL = 'https://beian.miit.gov.cn/';

type IcpFilingFooterProps = {
  className?: string;
};

export default function IcpFilingFooter({ className = '' }: IcpFilingFooterProps) {
  return (
    <footer
      className={`mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 rounded-2xl border px-4 py-2 text-[11px] shadow-sm backdrop-blur-md ${className}`}
      style={{
        borderColor: 'var(--border-subtle)',
        background: 'color-mix(in srgb, var(--bg-surface) 86%, transparent)',
        color: 'var(--text-tertiary)',
      }}
    >
      <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>
        杭州梅奥AI工作台
      </span>
      <span className="hidden h-3 w-px sm:inline-block" style={{ background: 'var(--border-default)' }} />
      <span>备案域名：{ICP_FILING_DOMAIN}</span>
      <span className="hidden h-3 w-px sm:inline-block" style={{ background: 'var(--border-default)' }} />
      <a
        href={ICP_FILING_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium transition-colors hover:underline"
        style={{ color: 'var(--text-secondary)' }}
      >
        {ICP_FILING_NUMBER}
      </a>
    </footer>
  );
}
