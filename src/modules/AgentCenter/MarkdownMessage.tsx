import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { LegacyFaIcon } from '../../components/ui/workspacePrimitives';

interface Props {
  content: string;
}

const CodeBlock: React.FC<{ className?: string; children?: React.ReactNode }> = ({ className = '', children }) => {
  const [copied, setCopied] = useState(false);
  const text = String(children || '').replace(/\n$/, '');
  const language = className.replace(/^language-/, '').trim();

  const copyCode = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="my-3 overflow-hidden rounded-lg border" style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}>
      <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5" style={{ borderColor: 'var(--border-subtle)' }}>
        <span className="text-[10px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--text-secondary)' }}>
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={copyCode}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold transition"
          style={{ color: 'var(--text-secondary)', background: 'var(--bg-base)' }}
        >
          <LegacyFaIcon icon={copied ? 'fa-check' : 'fa-copy'} className="text-[10px]" />
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="max-w-full overflow-x-auto px-3 py-3 text-[12px] leading-5">
        <code>{text}</code>
      </pre>
    </div>
  );
};

const MarkdownMessage: React.FC<Props> = ({ content }) => (
  <div className="markdown-message select-text break-words text-[13px] leading-6">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
        ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
        li: ({ children }) => <li>{children}</li>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2" style={{ color: 'var(--accent)' }}>
            {children}
          </a>
        ),
        table: ({ children }) => (
          <div className="my-3 overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-[12px]">{children}</table>
          </div>
        ),
        th: ({ children }) => <th className="border px-2 py-1 font-semibold" style={{ borderColor: 'var(--border-subtle)' }}>{children}</th>,
        td: ({ children }) => <td className="border px-2 py-1" style={{ borderColor: 'var(--border-subtle)' }}>{children}</td>,
        code: ({ inline, className, children, ...props }: any) => (
          inline
            ? <code className="rounded px-1 py-0.5 text-[12px]" style={{ background: 'var(--bg-elevated)' }} {...props}>{children}</code>
            : <CodeBlock className={className}>{children}</CodeBlock>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
);

export default MarkdownMessage;
