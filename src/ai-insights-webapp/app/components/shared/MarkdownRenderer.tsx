"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export default function MarkdownRenderer({ content, className = "" }: MarkdownRendererProps) {
  return (
    <div className={`markdown-content prose prose-sm dark:prose-invert min-w-0 max-w-none text-sm leading-relaxed text-foreground/90 space-y-2.5 select-text ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: "ignore", trust: false }]]}
        components={{
          h1: ({ children }) => (
            <h1 className="text-xl sm:text-2xl font-bold text-foreground mt-4 mb-2 pb-1.5 border-b border-border/60">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg sm:text-xl font-bold text-foreground mt-3.5 mb-1.5 pb-1 border-b border-border/40">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-bold text-primary dark:text-indigo-400 mt-3 mb-1.5">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="text-sm font-bold text-foreground mt-2.5 mb-1">
              {children}
            </h4>
          ),
          h5: ({ children }) => (
            <h5 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mt-2 mb-1">
              {children}
            </h5>
          ),
          h6: ({ children }) => (
            <h6 className="text-xs font-semibold text-muted-foreground mt-1.5 mb-0.5">
              {children}
            </h6>
          ),
          p: ({ children }) => (
            <p className="text-sm leading-relaxed text-foreground/90 mb-2">{children}</p>
          ),
          strong: ({ children }) => (
            <strong className="font-bold text-foreground">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic text-foreground/85">{children}</em>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-5 space-y-1 mb-2.5 text-sm text-foreground/90">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-5 space-y-1 mb-2.5 text-sm text-foreground/90">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-sm leading-relaxed">{children}</li>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary/50 pl-3 my-2 text-muted-foreground italic bg-surface-muted/30 py-1 rounded-r-lg text-sm">
              {children}
            </blockquote>
          ),
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline hover:text-primary/80 transition-colors font-medium"
            >
              {children}
            </a>
          ),
          hr: () => <hr className="my-3 border-border/60" />,
          table: ({ children }) => (
            <div className="overflow-x-auto my-3 rounded-xl border border-border/80 bg-surface/60 shadow-xs">
              <table className="w-full text-left text-xs border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-surface-muted/80 text-muted-foreground border-b border-border/80 font-bold uppercase text-[11px] tracking-wider">
              {children}
            </thead>
          ),
          tbody: ({ children }) => (
            <tbody className="divide-y divide-border/40 font-mono text-xs text-foreground/85">{children}</tbody>
          ),
          tr: ({ children }) => (
            <tr className="hover:bg-surface-muted/30 transition-colors">{children}</tr>
          ),
          th: ({ children }) => <th className="px-3.5 py-2 font-bold">{children}</th>,
          td: ({ children }) => <td className="px-3.5 py-2 whitespace-nowrap">{children}</td>,
          code: ({ className, children, ...props }) => {
            const isInline = !className && !String(children).includes("\n");
            if (isInline) {
              return (
                <code
                  className="px-1.5 py-0.5 rounded bg-surface-muted border border-border/60 font-mono text-xs text-primary dark:text-indigo-300 font-semibold"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return <CodeBlock language={className?.replace("language-", "") || ""}>{String(children).replace(/\n$/, "")}</CodeBlock>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function CodeBlock({ children, language }: { children: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-2.5 rounded-xl border border-border/80 bg-slate-950 text-slate-100 overflow-hidden text-xs font-mono shadow-sm">
      <div className="px-3.5 py-2 bg-slate-900 border-b border-slate-800 flex items-center justify-between text-[11px] text-slate-400 select-none">
        <span>{language || "code"}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
        >
          {copied ? (
            <>
              <span className="text-emerald-400 font-bold">✓</span>
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <span>📋</span>
              <span>Copy code</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3.5 overflow-x-auto text-xs leading-relaxed select-text">
        <code>{children}</code>
      </pre>
    </div>
  );
}
