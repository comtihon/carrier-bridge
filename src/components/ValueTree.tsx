"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { clsx } from "clsx";
import type { TreeNode } from "@/lib/valueTree";

/**
 * A foldable JSON or XML value.
 *
 * Rows rather than nested boxes: a branch renders an opening line, its children
 * and a closing line, which is what makes indentation, folding and "jump to the
 * next match" all the same operation on one flat list. Colours are the Prism
 * `.token.*` classes from globals.css, so a folded value and the code editors
 * agree on what a string looks like.
 */

export type RowKind = "open" | "close" | "leaf";

export interface TreeRow {
  node: TreeNode;
  depth: number;
  kind: RowKind;
  /** Last child of its parent — decides the trailing comma in JSON. */
  last: boolean;
  /** Position when the parent is an array, so items can be numbered. */
  index: number | null;
  collapsed: boolean;
}

/** Rows for everything currently visible, in document order. */
export function flattenTree(
  nodes: TreeNode[],
  collapsed: ReadonlySet<string>,
  depth = 0,
  parentIsArray = false,
): TreeRow[] {
  const rows: TreeRow[] = [];
  nodes.forEach((node, i) => {
    const last = i === nodes.length - 1;
    const index = parentIsArray ? i : null;
    const isBranch = node.children.length > 0;
    const isCollapsed = collapsed.has(node.id);

    if (!isBranch) {
      rows.push({ node, depth, kind: "leaf", last, index, collapsed: false });
      return;
    }
    rows.push({ node, depth, kind: "open", last, index, collapsed: isCollapsed });
    if (isCollapsed) return;
    rows.push(...flattenTree(node.children, collapsed, depth + 1, node.kind === "array"));
    rows.push({ node, depth, kind: "close", last, index, collapsed: false });
  });
  return rows;
}

/** Split on the search term so every occurrence can be marked. */
export function Highlighted({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts: React.ReactNode[] = [];
  let at = 0;
  let found = lower.indexOf(needle, at);
  if (found === -1) return <>{text}</>;
  while (found !== -1) {
    if (found > at) parts.push(text.slice(at, found));
    parts.push(
      <mark key={`${found}`} className="bg-amber-500/30 text-amber-100 rounded-[2px]">
        {text.slice(found, found + needle.length)}
      </mark>,
    );
    at = found + needle.length;
    found = lower.indexOf(needle, at);
  }
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

function Punct({ children }: { children: React.ReactNode }) {
  return <span className="token punctuation">{children}</span>;
}

function scalarClass(node: TreeNode): string {
  switch (node.valueKind) {
    case "number":
    case "boolean": return "token number";
    case "null": return "token comment";
    case "string": return "token string";
    default: return "text-slate-200";
  }
}

function JsonRow({ row, query }: { row: TreeRow; query: string }) {
  const { node, kind, last, index } = row;
  const comma = last ? "" : ",";
  const key = node.name !== null
    ? <><span className="token property">&quot;<Highlighted text={node.name} query={query} />&quot;</span><Punct>: </Punct></>
    : index !== null
      ? <span className="token comment mr-1.5 select-none">{index}</span>
      : null;

  if (kind === "leaf") {
    const quoted = node.valueKind === "string";
    return (
      <>
        {key}
        <span className={scalarClass(node)}>
          {quoted && <>&quot;</>}
          <Highlighted text={node.value ?? ""} query={query} />
          {quoted && <>&quot;</>}
        </span>
        <Punct>{comma}</Punct>
      </>
    );
  }

  const open = node.kind === "array" ? "[" : "{";
  const close = node.kind === "array" ? "]" : "}";

  if (kind === "close") return <><Punct>{close}{comma}</Punct></>;

  if (row.collapsed) {
    return (
      <>
        {key}
        <Punct>{open} … {close}{comma}</Punct>
        <span className="ml-2 text-[10px] text-slate-600">{node.summary}</span>
      </>
    );
  }
  return <>{key}<Punct>{open}</Punct></>;
}

function XmlAttrs({ node, query }: { node: TreeNode; query: string }) {
  if (node.attrs.length === 0) return null;
  return (
    <>
      {node.attrs.map(([k, v]) => (
        <span key={k}>
          {" "}
          <span className="token attr-name"><Highlighted text={k} query={query} /></span>
          <Punct>=</Punct>
          <span className="token string">&quot;<Highlighted text={v} query={query} />&quot;</span>
        </span>
      ))}
    </>
  );
}

function XmlRow({ row, query }: { row: TreeRow; query: string }) {
  const { node, kind } = row;

  if (node.kind === "text") {
    return <span className="text-slate-300"><Highlighted text={node.value ?? ""} query={query} /></span>;
  }

  const name = <span className="token keyword"><Highlighted text={node.name ?? ""} query={query} /></span>;

  if (kind === "close") return <><Punct>&lt;/</Punct>{name}<Punct>&gt;</Punct></>;

  if (kind === "leaf") {
    // A declaration keeps its own punctuation; an empty element self-closes.
    if (node.name?.startsWith("?") || node.name?.startsWith("!")) {
      return <span className="token comment">&lt;{node.name}&gt;</span>;
    }
    if (node.value === null) {
      return <><Punct>&lt;</Punct>{name}<XmlAttrs node={node} query={query} /><Punct>/&gt;</Punct></>;
    }
    return (
      <>
        <Punct>&lt;</Punct>{name}<XmlAttrs node={node} query={query} /><Punct>&gt;</Punct>
        <span className="text-slate-200"><Highlighted text={node.value} query={query} /></span>
        <Punct>&lt;/</Punct>{name}<Punct>&gt;</Punct>
      </>
    );
  }

  if (row.collapsed) {
    return (
      <>
        <Punct>&lt;</Punct>{name}<XmlAttrs node={node} query={query} /><Punct>&gt; … &lt;/</Punct>
        {name}<Punct>&gt;</Punct>
        <span className="ml-2 text-[10px] text-slate-600">{node.summary}</span>
      </>
    );
  }
  return <><Punct>&lt;</Punct>{name}<XmlAttrs node={node} query={query} /><Punct>&gt;</Punct></>;
}

export function ValueTree({
  rows, markup, query, activeId, matchIds, onToggle,
}: {
  rows: TreeRow[];
  /** XML rows read differently from JSON ones — same tree, two grammars. */
  markup: boolean;
  query: string;
  /** The match the find bar is currently sitting on. */
  activeId: string | null;
  matchIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="px-2 py-2 font-mono text-[11px] leading-[1.6] text-slate-200 overflow-x-auto">
      {rows.map((row, i) => {
        const branch = row.node.children.length > 0 && row.kind === "open";
        const isMatch = row.kind !== "close" && matchIds.has(row.node.id);
        return (
          <div
            key={`${row.node.id}:${row.kind}:${i}`}
            data-node-id={row.kind === "close" ? undefined : row.node.id}
            className={clsx(
              "flex items-start whitespace-pre rounded-sm",
              isMatch && "bg-amber-500/5",
              row.node.id === activeId && row.kind !== "close" &&
                "ring-1 ring-amber-500/70 bg-amber-500/10",
            )}
            style={{ paddingLeft: row.depth * 14 }}
          >
            {branch ? (
              <button
                type="button"
                onClick={() => onToggle(row.node.id)}
                aria-label={row.collapsed ? "Unfold" : "Fold"}
                className="shrink-0 -ml-1 mr-0.5 mt-[3px] text-slate-500 hover:text-slate-200 transition-colors"
              >
                {row.collapsed
                  ? <ChevronRight className="w-3 h-3" />
                  : <ChevronDown className="w-3 h-3" />}
              </button>
            ) : (
              <span className="shrink-0 w-3 mr-0.5" />
            )}
            <span className="min-w-0 break-words whitespace-pre-wrap">
              {markup
                ? <XmlRow row={row} query={query} />
                : <JsonRow row={row} query={query} />}
            </span>
          </div>
        );
      })}
    </div>
  );
}
