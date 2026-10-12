/**
 * A parameter value as a tree, so it can be folded.
 *
 * Indenting a 400-line body is only half the problem: the reviewer still has
 * to scroll past the parts they have already cleared to reach the one filter
 * that decides whether the deletion is safe. A tree lets them shut the parts
 * they have read, and — with the search in `ValueView` — jump to the part they
 * have not.
 *
 * JSON and XML share one node shape on purpose. They are different grammars but
 * the same reading problem, and one shape means one renderer, one fold state
 * and one search index rather than two of each.
 */

import type { PrettyValue } from "./prettyValue";

export type TreeNodeKind = "object" | "array" | "element" | "scalar" | "text";

export type ScalarKind = "string" | "number" | "boolean" | "null" | "text";

export interface TreeNode {
  /** Position path — "0/2/1". Stable across renders, and its own ancestry. */
  id: string;
  kind: TreeNodeKind;
  /** Object key or element tag. Null for array items and bare text. */
  name: string | null;
  /** XML attributes, in source order. */
  attrs: Array<[string, string]>;
  /** A scalar's text, or an element's inline text when it has no children. */
  value: string | null;
  valueKind: ScalarKind | null;
  children: TreeNode[];
  /** What a folded branch says about what is inside it: "3 keys", "12 items". */
  summary: string;
  /** This node's own line, as text — what the search matches against. */
  self: string;
}

/** Every id from the root down to (but not including) `id`. */
export function ancestorIds(id: string): string[] {
  const parts = id.split("/");
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) out.push(parts.slice(0, i).join("/"));
  return out;
}

export function countNodes(nodes: TreeNode[]): number {
  let n = 0;
  for (const node of nodes) n += 1 + countNodes(node.children);
  return n;
}

/** Ids of every branch in the tree, in document order. */
export function branchIds(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      if (node.children.length > 0) out.push(node.id);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/** Ids of every node whose own line contains `needle`, in document order. */
export function findMatches(nodes: TreeNode[], needle: string): string[] {
  const q = needle.trim().toLowerCase();
  if (!q) return [];
  const out: string[] = [];
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      if (node.self.toLowerCase().includes(q)) out.push(node.id);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

function scalarKind(value: unknown): ScalarKind {
  if (value === null) return "null";
  switch (typeof value) {
    case "number": return "number";
    case "boolean": return "boolean";
    default: return "string";
  }
}

function scalarText(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  return String(value);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** One JSON value and everything under it. */
export function buildJsonTree(value: unknown, id = "0", name: string | null = null): TreeNode {
  const base = { id, name, attrs: [] as Array<[string, string]> };

  if (Array.isArray(value)) {
    const children = value.map((child, i) => buildJsonTree(child, `${id}/${i}`, null));
    return {
      ...base,
      kind: "array",
      value: null,
      valueKind: null,
      children,
      summary: plural(children.length, "item", "items"),
      self: name ?? "",
    };
  }

  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const children = entries.map(([key, child], i) => buildJsonTree(child, `${id}/${i}`, key));
    return {
      ...base,
      kind: "object",
      value: null,
      valueKind: null,
      children,
      summary: plural(children.length, "key", "keys"),
      self: name ?? "",
    };
  }

  const text = scalarText(value);
  return {
    ...base,
    kind: "scalar",
    value: text,
    valueKind: scalarKind(value),
    children: [],
    summary: "",
    self: name === null ? text : `${name} ${text}`,
  };
}

const TAG_OR_TEXT = /<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<[^>]*>|[^<]+/g;
const ATTR = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

function parseAttrs(tag: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  // Skip the tag name, so an element called `id=` cannot be read as one.
  const body = tag.replace(/^<\/?[\w:.-]*/, "").replace(/\/?>$/, "");
  let m: RegExpExecArray | null;
  ATTR.lastIndex = 0;
  while ((m = ATTR.exec(body)) !== null) out.push([m[1], m[3] ?? m[4] ?? ""]);
  return out;
}

function tagName(tag: string): string {
  const m = /^<\/?\s*([\w:.-]+)/.exec(tag);
  return m ? m[1] : tag.replace(/^<|>$/g, "").trim();
}

function elementSelf(node: TreeNode): string {
  const attrs = node.attrs.map(([k, v]) => `${k}="${v}"`).join(" ");
  return [node.name ?? "", attrs, node.value ?? ""].filter(Boolean).join(" ");
}

/**
 * XML into the same node shape, forgivingly.
 *
 * Hand-rolled rather than DOMParser for the same reason the formatter is: a
 * parameter is often a rootless fragment, and a strict parser answers a
 * fragment with an error document — exactly when the reviewer needs to read it.
 * A stray closing tag is skipped rather than fatal, and an unclosed element is
 * closed by the end of input.
 */
export function parseXmlTree(src: string): TreeNode[] {
  const roots: TreeNode[] = [];
  const stack: TreeNode[] = [];
  const counters = new Map<string, number>();

  const nextId = (): string => {
    const parentId = stack.length > 0 ? stack[stack.length - 1].id : "";
    const seen = counters.get(parentId) ?? 0;
    counters.set(parentId, seen + 1);
    return parentId === "" ? String(seen) : `${parentId}/${seen}`;
  };

  const push = (node: TreeNode) => {
    if (stack.length > 0) stack[stack.length - 1].children.push(node);
    else roots.push(node);
  };

  const tokens = src.match(TAG_OR_TEXT) ?? [];
  for (const token of tokens) {
    const isTag = token.startsWith("<") && token.endsWith(">") && !token.startsWith("<![CDATA[");

    if (!isTag) {
      const text = token.startsWith("<![CDATA[")
        ? token.slice(9, -3)
        : token;
      if (text.trim().length === 0) continue;
      const node: TreeNode = {
        id: nextId(), kind: "text", name: null, attrs: [],
        value: text.trim(), valueKind: "text", children: [],
        summary: "", self: text.trim(),
      };
      push(node);
      continue;
    }

    if (token.startsWith("</")) {
      const name = tagName(token);
      const at = [...stack].reverse().findIndex((n) => n.name === name);
      // A close with no open is a malformed document, not a reason to stop.
      if (at === -1) continue;
      stack.length = stack.length - 1 - at;
      continue;
    }

    const declaration = token.startsWith("<?") || token.startsWith("<!");
    const selfClosing = token.endsWith("/>") || declaration;
    const node: TreeNode = {
      id: nextId(),
      kind: "element",
      name: declaration ? token.replace(/^<|>$/g, "").trim() : tagName(token),
      attrs: declaration ? [] : parseAttrs(token),
      value: null,
      valueKind: null,
      children: [],
      summary: "",
      self: "",
    };
    node.self = elementSelf(node);
    push(node);
    if (!selfClosing) stack.push(node);
  }

  // An element whose only content is text reads as one line, not as a branch.
  const settle = (list: TreeNode[]) => {
    for (const node of list) {
      if (
        node.kind === "element" &&
        node.children.length === 1 &&
        node.children[0].kind === "text"
      ) {
        node.value = node.children[0].value;
        node.valueKind = "text";
        node.children = [];
      }
      node.summary = plural(node.children.length, "child", "children");
      node.self = node.kind === "element" ? elementSelf(node) : node.self;
      settle(node.children);
    }
  };
  settle(roots);

  return roots;
}

/**
 * The foldable form of a value, or null when the value has no structure to
 * fold — SQL, GraphQL and prose are read as text, and pretending otherwise
 * would hide lines rather than reveal them.
 */
export function buildValueTree(value: unknown, pretty: PrettyValue): TreeNode[] | null {
  try {
    if (pretty.language === "json") {
      const data = typeof value === "string" ? JSON.parse(value) : value;
      const root = buildJsonTree(data);
      return root.children.length > 0 ? [root] : null;
    }
    if (pretty.language === "markup") {
      const roots = parseXmlTree(pretty.raw);
      return roots.length > 0 ? roots : null;
    }
  } catch {
    // Sniffed as structured but would not build — fall back to the flat text,
    // which is still exactly what the call will send.
    return null;
  }
  return null;
}
