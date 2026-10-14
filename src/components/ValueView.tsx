"use client";

import { StoredOutputRef } from "./StoredOutputRef";
import { isOutputRef } from "@/lib/outputRef";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-json";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-graphql";
import {
  Check, ChevronDown, ChevronUp, ChevronsDownUp, ChevronsUpDown, Copy, Search, X,
} from "lucide-react";
import { clsx } from "clsx";
import { prettyValue, type ValueLanguage } from "@/lib/prettyValue";
import {
  ancestorIds, branchIds, buildValueTree, countNodes, findMatches, type TreeNode,
} from "@/lib/valueTree";
import { flattenTree, Highlighted, ValueTree } from "./ValueTree";

/**
 * One parameter value, rendered as what it is.
 *
 * A short scalar stays on the key's line — boxing `30d` would be noise. A JSON
 * or XML value becomes a tree the reviewer can fold: indenting a 400-line body
 * only halves the problem, because they still have to scroll past the parts
 * they have cleared to reach the one filter that decides whether the deletion
 * is safe. Folding shuts what has been read; the find bar jumps to what has
 * not. SQL, GraphQL and prose have no structure to fold and stay flat text,
 * painted with the same Prism token colours the code editors use.
 *
 * A value that was reformatted keeps a way back to the bytes that were actually
 * sent — "what will this call do" is a question about the raw payload, and a
 * reviewer must be able to check the prettifier's work.
 *
 * Highlighting is the only thing here that touches innerHTML, and it is fed
 * exclusively by `Prism.highlight`, which escapes its input. While a search is
 * running the flat view drops to plain text with the matches marked, because
 * marking inside painted HTML would mean editing markup as a string.
 */

/** Roughly a screenful of a flat value before it is clamped. */
const COLLAPSE_LINES = 14;

/** Rows drawn at once. A 20k-row body must not lock the page up. */
const MAX_ROWS = 400;

/** Past this many nodes a tree opens folded below the first level. */
const AUTO_FOLD_NODES = 80;

const LANG_LABEL: Record<ValueLanguage, string> = {
  json: "JSON",
  markup: "XML",
  sql: "SQL",
  graphql: "GraphQL",
  text: "text",
};

function paint(text: string, language: ValueLanguage): string | null {
  if (language === "text") return null;
  const grammar = Prism.languages[language];
  if (!grammar) return null;
  try {
    return Prism.highlight(text, grammar, language);
  } catch {
    // A grammar that chokes must not take the value down with it.
    return null;
  }
}

/** Branches to fold on first render: everything below depth 1 in a big tree. */
function initialCollapsed(roots: TreeNode[]): Set<string> {
  if (countNodes(roots) <= AUTO_FOLD_NODES) return new Set();
  const out = new Set<string>();
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const node of nodes) {
      if (node.children.length > 0 && depth >= 1) out.add(node.id);
      walk(node.children, depth + 1);
    }
  };
  walk(roots, 0);
  return out;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  if (!clipboard) return null;
  return (
    <button
      type="button"
      title="Copy value"
      onClick={async () => {
        try {
          await clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Denied clipboard permission is not worth an error state here.
        }
      }}
      className="flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300 transition-colors"
    >
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** Flat text with the search term marked — used while a find is running. */
function MarkedText({ text, query }: { text: string; query: string }) {
  return <Highlighted text={text} query={query} />;
}

/** A stored-output reference renders as size + preview + download, never raw JSON. */
export function ValueView({ value, className }: { value: unknown; className?: string }) {
  if (isOutputRef(value)) return <StoredOutputRef value={value} />;
  return <ValueViewBody value={value} className={className} />;
}

function ValueViewBody({ value, className }: { value: unknown; className?: string }) {
  const pretty = useMemo(() => prettyValue(value), [value]);
  const tree = useMemo(() => buildValueTree(value, pretty), [value, pretty]);

  const [showRaw, setShowRaw] = useState(false);
  const [expandedFlat, setExpandedFlat] = useState(false);
  const [allRows, setAllRows] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState("");
  const [matchAt, setMatchAt] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);

  // A new value is a new tree: fold state and search belong to the old one.
  useEffect(() => {
    setCollapsed(tree ? initialCollapsed(tree) : new Set());
    setMatchAt(0);
  }, [tree]);

  const matches = useMemo(
    () => (tree && query.trim() ? findMatches(tree, query) : []),
    [tree, query],
  );
  const matchSet = useMemo(() => new Set(matches), [matches]);
  const activeId = matches.length > 0 ? matches[Math.min(matchAt, matches.length - 1)] : null;

  // A match inside a folded branch is a match the reviewer cannot see, so the
  // search opens the way to every hit rather than only reporting a count.
  useEffect(() => {
    if (matches.length === 0) return;
    setCollapsed((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const id of matches) {
        for (const parent of ancestorIds(id)) {
          if (next.delete(parent)) changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [matches]);

  useEffect(() => {
    if (!activeId) return;
    const el = bodyRef.current?.querySelector(`[data-node-id="${activeId}"]`);
    (el as HTMLElement | null)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  const step = useCallback((by: number) => {
    setMatchAt((at) => {
      if (matches.length === 0) return 0;
      return (at + by + matches.length) % matches.length;
    });
  }, [matches.length]);

  const toggleNode = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const foldAll = useCallback(() => {
    setCollapsed(new Set(tree ? branchIds(tree) : []));
  }, [tree]);
  const unfoldAll = useCallback(() => setCollapsed(new Set()), []);

  if (pretty.inline) {
    return (
      <span className={clsx("font-mono text-[11px] text-slate-200 break-words", className)}>
        {pretty.text}
      </span>
    );
  }

  // The tree is a view of the formatted value; Raw is a view of the bytes.
  const asTree = tree !== null && !showRaw;
  const shown = showRaw ? pretty.raw : pretty.text;

  const rows = asTree ? flattenTree(tree, collapsed) : [];
  const rowCap = allRows ? rows.length : MAX_ROWS;
  const shownRows = rows.slice(0, rowCap);

  const flatLines = shown.split("\n");
  const flatClamped = !expandedFlat && flatLines.length > COLLAPSE_LINES;
  const flatBody = flatClamped ? flatLines.slice(0, COLLAPSE_LINES).join("\n") : shown;
  // Painting and marking both own the same characters, so a running search
  // takes the plain rendering: the matches are what the reviewer is reading.
  const painted = query.trim() ? null : paint(flatBody, pretty.language);
  const flatMatches = query.trim()
    ? flatBody.toLowerCase().split(query.trim().toLowerCase()).length - 1
    : 0;

  const searchable = asTree || pretty.language !== "text" || flatLines.length > 3;
  const matchCount = asTree ? matches.length : flatMatches;

  return (
    <div className={clsx("rounded-lg border border-slate-800 bg-slate-950/60 overflow-hidden", className)}>
      <div className="flex items-center gap-3 px-2.5 py-1 border-b border-slate-800/80 bg-slate-900/40">
        <span className="text-[9px] uppercase tracking-wide font-semibold text-slate-500">
          {LANG_LABEL[pretty.language]}
        </span>
        <span className="text-[9px] text-slate-600 tabular-nums">
          {asTree
            ? `${rows.length} row${rows.length === 1 ? "" : "s"}`
            : `${flatLines.length} line${flatLines.length === 1 ? "" : "s"}`}
        </span>
        <div className="flex-1" />
        {asTree && (
          <>
            <button
              type="button" onClick={foldAll} title="Fold everything"
              className="text-slate-500 hover:text-slate-300 transition-colors"
            >
              <ChevronsDownUp className="w-3 h-3" />
            </button>
            <button
              type="button" onClick={unfoldAll} title="Unfold everything"
              className="text-slate-500 hover:text-slate-300 transition-colors"
            >
              <ChevronsUpDown className="w-3 h-3" />
            </button>
          </>
        )}
        {searchable && (
          <button
            type="button"
            onClick={() => { setFinding((v) => !v); if (finding) setQuery(""); }}
            title={finding ? "Close find" : "Find in this value"}
            className={clsx(
              "transition-colors",
              finding ? "text-sky-400" : "text-slate-500 hover:text-slate-300",
            )}
          >
            <Search className="w-3 h-3" />
          </button>
        )}
        {pretty.reformatted && (
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            title={showRaw ? "Show the formatted value" : "Show exactly what was sent"}
            className="text-[10px] text-sky-400 hover:text-sky-300 transition-colors"
          >
            {showRaw ? "Formatted" : "Raw"}
          </button>
        )}
        <CopyButton text={shown} />
      </div>

      {finding && (
        <div className="flex items-center gap-2 px-2.5 py-1 border-b border-slate-800/80 bg-slate-900/20">
          <Search className="w-3 h-3 text-slate-600 shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => { setQuery(e.target.value); setMatchAt(0); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
              if (e.key === "Escape") { setQuery(""); setFinding(false); }
            }}
            placeholder="Find in this value"
            aria-label="Find in this value"
            className="flex-1 min-w-0 bg-transparent text-[11px] text-slate-200 placeholder:text-slate-600 focus:outline-none"
          />
          <span className="text-[10px] text-slate-500 tabular-nums shrink-0">
            {query.trim()
              ? matchCount === 0
                ? "no matches"
                : asTree
                  ? `${Math.min(matchAt, matchCount - 1) + 1}/${matchCount}`
                  : `${matchCount} match${matchCount === 1 ? "" : "es"}`
              : ""}
          </span>
          {asTree && (
            <>
              <button
                type="button" onClick={() => step(-1)} disabled={matchCount === 0}
                title="Previous match" aria-label="Previous match"
                className="text-slate-500 hover:text-slate-200 disabled:opacity-40 transition-colors"
              >
                <ChevronUp className="w-3 h-3" />
              </button>
              <button
                type="button" onClick={() => step(1)} disabled={matchCount === 0}
                title="Next match" aria-label="Next match"
                className="text-slate-500 hover:text-slate-200 disabled:opacity-40 transition-colors"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
            </>
          )}
          <button
            type="button" onClick={() => { setQuery(""); setFinding(false); }}
            title="Close find" aria-label="Close find"
            className="text-slate-500 hover:text-slate-200 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      <div ref={bodyRef}>
        {asTree ? (
          <ValueTree
            rows={shownRows}
            markup={pretty.language === "markup"}
            query={query}
            activeId={activeId}
            matchIds={matchSet}
            onToggle={toggleNode}
          />
        ) : (
          <pre
            className="px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-200 whitespace-pre-wrap break-words overflow-x-auto"
            {...(painted
              ? { dangerouslySetInnerHTML: { __html: painted } }
              : { children: query.trim()
                  ? <MarkedText text={flatBody} query={query} />
                  : flatBody })}
          />
        )}
      </div>

      {asTree && rows.length > MAX_ROWS && (
        <button
          type="button"
          onClick={() => setAllRows((v) => !v)}
          className="w-full flex items-center justify-center gap-1 py-1 border-t border-slate-800/80 text-[10px] text-sky-400 hover:text-sky-300 hover:bg-slate-900/40 transition-colors"
        >
          {allRows
            ? <><ChevronUp className="w-3 h-3" />Draw only the first {MAX_ROWS} rows</>
            : <><ChevronDown className="w-3 h-3" />Draw all {rows.length} rows</>}
        </button>
      )}

      {!asTree && flatLines.length > COLLAPSE_LINES && (
        <button
          type="button"
          onClick={() => setExpandedFlat((v) => !v)}
          className="w-full flex items-center justify-center gap-1 py-1 border-t border-slate-800/80 text-[10px] text-sky-400 hover:text-sky-300 hover:bg-slate-900/40 transition-colors"
        >
          {expandedFlat ? (
            <><ChevronUp className="w-3 h-3" />Show less</>
          ) : (
            <><ChevronDown className="w-3 h-3" />Show all {flatLines.length} lines</>
          )}
        </button>
      )}
    </div>
  );
}
