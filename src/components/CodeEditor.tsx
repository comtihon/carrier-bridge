"use client";

import Editor from "react-simple-code-editor";
import Prism from "prismjs";
import "prismjs/components/prism-python";
import "prismjs/components/prism-json";
import "prismjs/components/prism-graphql";
// javascript ships with Prism core.
import { clsx } from "clsx";

/** The grammars imported above — nothing else can be painted. */
export type CodeLanguage = "python" | "json" | "graphql" | "javascript";

/**
 * Source editor with syntax highlighting.
 *
 * `react-simple-code-editor` keeps a real <textarea> for input and paints a
 * Prism-highlighted <pre> underneath it, so selection, undo and IME all behave
 * like a plain textarea. Colours come from the `.token.*` rules in globals.css
 * rather than a Prism theme stylesheet, so they match the slate palette.
 */
export function CodeEditor({
  value,
  onChange,
  language = "python",
  readOnly = false,
  placeholder,
  minHeight = 200,
  className,
}: {
  value: string;
  onChange: (code: string) => void;
  language?: CodeLanguage;
  readOnly?: boolean;
  placeholder?: string;
  minHeight?: number;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "rounded-lg border border-slate-700 bg-slate-950 overflow-auto",
        "focus-within:border-sky-500 transition-colors",
        className,
      )}
      style={{ minHeight }}
    >
      <Editor
        value={value}
        onValueChange={readOnly ? () => {} : onChange}
        highlight={(code) => Prism.highlight(code, Prism.languages[language], language)}
        padding={12}
        readOnly={readOnly}
        placeholder={placeholder}
        textareaClassName="focus:outline-none"
        className="font-mono text-[12px] leading-relaxed text-slate-200 min-h-full"
        style={{
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          minHeight,
        }}
      />
    </div>
  );
}
