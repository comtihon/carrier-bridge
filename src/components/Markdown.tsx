"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { clsx } from "clsx";

const MARKDOWN_COMPONENTS = {
  p: (props: React.HTMLAttributes<HTMLParagraphElement>) => (
    <p {...props} className="text-xs text-slate-200 leading-relaxed my-1.5 first:mt-0 last:mb-0" />
  ),
  h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h1 {...props} className="text-sm font-bold text-white mt-3 mb-1.5 first:mt-0" />
  ),
  h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h2 {...props} className="text-sm font-semibold text-white mt-3 mb-1.5 first:mt-0" />
  ),
  h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h3 {...props} className="text-xs font-semibold text-slate-100 mt-2.5 mb-1 first:mt-0" />
  ),
  h4: (props: React.HTMLAttributes<HTMLHeadingElement>) => (
    <h4 {...props} className="text-xs font-semibold text-slate-200 mt-2 mb-1 first:mt-0" />
  ),
  ul: (props: React.HTMLAttributes<HTMLUListElement>) => (
    <ul {...props} className="text-xs text-slate-200 list-disc pl-5 my-1.5 space-y-0.5" />
  ),
  ol: (props: React.OlHTMLAttributes<HTMLOListElement>) => (
    <ol {...props} className="text-xs text-slate-200 list-decimal pl-5 my-1.5 space-y-0.5" />
  ),
  li: (props: React.LiHTMLAttributes<HTMLLIElement>) => (
    <li {...props} className="text-xs text-slate-200 leading-relaxed" />
  ),
  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      {...props}
      target="_blank"
      rel="noreferrer"
      className="text-sky-400 hover:text-sky-300 underline underline-offset-2"
    />
  ),
  strong: (props: React.HTMLAttributes<HTMLElement>) => (
    <strong {...props} className="font-semibold text-white" />
  ),
  em: (props: React.HTMLAttributes<HTMLElement>) => (
    <em {...props} className="italic text-slate-200" />
  ),
  code: ({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <code {...props} className={clsx(className, "text-xs text-slate-200 font-mono")}>
          {children}
        </code>
      );
    }
    return (
      <code
        {...props}
        className="text-[11px] font-mono bg-slate-800/80 text-amber-200 rounded px-1 py-0.5"
      >
        {children}
      </code>
    );
  },
  pre: (props: React.HTMLAttributes<HTMLPreElement>) => (
    <pre
      {...props}
      className="text-xs bg-slate-800/60 rounded-lg px-3 py-2 my-2 overflow-x-auto whitespace-pre-wrap break-words"
    />
  ),
  blockquote: (props: React.BlockquoteHTMLAttributes<HTMLQuoteElement>) => (
    <blockquote
      {...props}
      className="border-l-2 border-slate-600 pl-3 my-2 text-xs text-slate-400 italic"
    />
  ),
  hr: (props: React.HTMLAttributes<HTMLHRElement>) => (
    <hr {...props} className="border-slate-700 my-3" />
  ),
  table: (props: React.TableHTMLAttributes<HTMLTableElement>) => (
    <div className="overflow-x-auto my-2">
      <table {...props} className="text-xs text-slate-200 border border-slate-700 border-collapse" />
    </div>
  ),
  th: (props: React.ThHTMLAttributes<HTMLTableCellElement>) => (
    <th {...props} className="border border-slate-700 px-2 py-1 bg-slate-800/60 font-semibold text-left" />
  ),
  td: (props: React.TdHTMLAttributes<HTMLTableCellElement>) => (
    <td {...props} className="border border-slate-700 px-2 py-1" />
  ),
};

export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
      {children}
    </ReactMarkdown>
  );
}

export function MarkdownView({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "bg-slate-800/60 rounded-lg px-3 py-2 max-h-96 overflow-y-auto break-words",
        className,
      )}
    >
      <Markdown>{text}</Markdown>
    </div>
  );
}
