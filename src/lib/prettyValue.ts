/**
 * What a parameter actually is, and how it reads best.
 *
 * A held deletion's parameters arrive as whatever the workflow put in them:
 * a number, a nested object, or — most often, and most dangerously — a string
 * carrying a whole request body, a SQL statement or an XML document. Rendered
 * as one long line, a `WHERE` clause with the wrong scope looks exactly like
 * one with the right scope. So the value is sniffed, reformatted where that is
 * lossless, and handed to the view with the grammar to paint it in.
 *
 * Sniffing is deliberately conservative: a value is only claimed for a grammar
 * when it parses (JSON), or when its opening token cannot plausibly be prose
 * (`<tag`, `SELECT`, `query {`). Anything else stays text, because a wrong
 * guess would recolour a value the reviewer is trying to read literally.
 */

/** Grammars the value view can paint. `text` means "render it plainly". */
export type ValueLanguage = "json" | "markup" | "sql" | "graphql" | "text";

export interface PrettyValue {
  language: ValueLanguage;
  /** What to show: reformatted where that was lossless, else the original. */
  text: string;
  /** Exactly what was in the parameter, as a string. */
  raw: string;
  /** True when `text` differs from `raw` — the view offers the raw form too. */
  reformatted: boolean;
  /** True for a value that belongs on the same line as its key. */
  inline: boolean;
  lines: number;
}

/** Past this, reformatting and highlighting cost more than they return. */
const MAX_FORMAT_CHARS = 200_000;

/** A value with no newline and no bulk reads fine beside its key. */
const INLINE_MAX_CHARS = 88;

const SQL_HEAD =
  /^\s*(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|WITH|CREATE|DROP|ALTER|TRUNCATE|MERGE|UPSERT)\b/i;

/** A clause keyword, and punctuation prose almost never carries. */
const SQL_CLAUSE = /\b(FROM|INTO|SET|VALUES|WHERE|TABLE|JOIN|USING|RETURNING)\b/i;
const SQL_SHAPE = /[=<>*();'"]|\n/;

/**
 * "update the owner before deleting" is a sentence, not a statement. A head
 * keyword alone is far too cheap a signal, so a statement must also carry a
 * clause keyword and at least one character of SQL punctuation.
 */
function looksLikeSql(text: string): boolean {
  return SQL_HEAD.test(text) && SQL_CLAUSE.test(text) && SQL_SHAPE.test(text);
}

const GRAPHQL_HEAD = /^\s*(query|mutation|subscription|fragment)\b[\s\S]*\{/;

const XML_HEAD = /^\s*<(\?xml|!DOCTYPE|[a-zA-Z_][\w.-]*)/;

function countLines(text: string): number {
  return text.length === 0 ? 0 : text.split("\n").length;
}

/**
 * Indent an XML document one tag per line.
 *
 * A hand-rolled walk rather than DOMParser: the parameter is frequently an XML
 * *fragment* with no single root, and a parser rejects those outright — where
 * the reviewer most needs to read one. Text short enough to sit inside its
 * element stays on the element's line, so a document of leaf values does not
 * become three lines per field.
 */
export function formatXml(src: string): string {
  const compact = src.replace(/>\s+</g, "><").trim();
  const tokens = compact.split(/(<[^>]*>)/g).filter((t) => t.trim().length > 0);
  const out: string[] = [];
  let depth = 0;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].trim();
    const isTag = token.startsWith("<") && token.endsWith(">");

    if (!isTag) {
      out.push("  ".repeat(depth) + token);
      continue;
    }
    if (token.startsWith("</")) {
      depth = Math.max(0, depth - 1);
      out.push("  ".repeat(depth) + token);
      continue;
    }

    const selfClosing = token.endsWith("/>");
    const declaration = token.startsWith("<?") || token.startsWith("<!");

    // <name>value</name> is one line — the pair is the value, not a structure.
    const next = tokens[i + 1]?.trim();
    const after = tokens[i + 2]?.trim();
    if (
      !selfClosing && !declaration &&
      next && !next.startsWith("<") &&
      after && after.startsWith("</")
    ) {
      out.push("  ".repeat(depth) + token + next + after);
      i += 2;
      continue;
    }

    out.push("  ".repeat(depth) + token);
    if (!selfClosing && !declaration) depth++;
  }

  return out.join("\n");
}

/** JSON only when it parses *and* is a structure — "12" is a number, not JSON. */
function asJson(text: string): string | null {
  const head = text.trimStart()[0];
  if (head !== "{" && head !== "[") return null;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

/**
 * The formatted form of one parameter value.
 *
 * Scalars stay scalars. Objects are JSON. Strings are sniffed, and a string
 * that turns out to be JSON is parsed and re-emitted — the single most common
 * case, because a request body crosses a workflow boundary as a string.
 */
export function prettyValue(value: unknown): PrettyValue {
  if (value === null || value === undefined) {
    const raw = value === null ? "null" : "undefined";
    return { language: "text", text: raw, raw, reformatted: false, inline: true, lines: 1 };
  }

  if (typeof value !== "string") {
    if (typeof value === "object") {
      let raw: string;
      try {
        raw = JSON.stringify(value) ?? String(value);
      } catch {
        // Circular or otherwise unserialisable — say so rather than throwing
        // inside a render that the reviewer needs to see the rest of.
        const fallback = String(value);
        return {
          language: "text", text: fallback, raw: fallback,
          reformatted: false, inline: true, lines: 1,
        };
      }
      const pretty = raw.length <= MAX_FORMAT_CHARS
        ? JSON.stringify(value, null, 2) ?? raw
        : raw;
      return {
        language: "json",
        text: pretty,
        raw,
        reformatted: pretty !== raw,
        inline: false,
        lines: countLines(pretty),
      };
    }
    const raw = String(value);
    return { language: "text", text: raw, raw, reformatted: false, inline: true, lines: 1 };
  }

  const raw = value;
  const plain = (): PrettyValue => ({
    language: "text",
    text: raw,
    raw,
    reformatted: false,
    inline: !raw.includes("\n") && raw.length <= INLINE_MAX_CHARS,
    lines: countLines(raw),
  });

  if (raw.trim().length === 0 || raw.length > MAX_FORMAT_CHARS) return plain();

  const json = asJson(raw);
  if (json !== null) {
    return {
      language: "json",
      text: json,
      raw,
      reformatted: json !== raw,
      inline: false,
      lines: countLines(json),
    };
  }

  if (XML_HEAD.test(raw) && raw.includes(">")) {
    const xml = formatXml(raw);
    return {
      language: "markup",
      text: xml,
      raw,
      reformatted: xml !== raw,
      inline: false,
      lines: countLines(xml),
    };
  }

  // SQL and GraphQL are painted, never reflowed: the author's line breaks in a
  // statement carry meaning a reformatter would flatten, and getting a WHERE
  // clause wrong on screen is the failure this whole gate exists to prevent.
  if (GRAPHQL_HEAD.test(raw)) {
    return {
      language: "graphql", text: raw, raw,
      reformatted: false, inline: false, lines: countLines(raw),
    };
  }
  if (looksLikeSql(raw)) {
    return {
      language: "sql", text: raw, raw,
      reformatted: false, inline: false, lines: countLines(raw),
    };
  }

  return plain();
}
