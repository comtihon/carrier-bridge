/**
 * Sniffing a parameter value.
 *
 * Two failures matter here and they pull in opposite directions: a JSON body
 * left as one unreadable line, and a sentence recoloured as code because it
 * happened to start with a keyword. So the tests are as much about what is
 * *not* claimed for a grammar as about what is.
 */
import { describe, it, expect } from "vitest";
import { formatXml, prettyValue } from "./prettyValue";

describe("prettyValue", () => {
  it("leaves a short scalar inline, where it reads best", () => {
    const v = prettyValue("30d");
    expect(v.language).toBe("text");
    expect(v.inline).toBe(true);
    expect(v.text).toBe("30d");
  });

  it("renders numbers and booleans as themselves", () => {
    expect(prettyValue(42)).toMatchObject({ text: "42", inline: true, language: "text" });
    expect(prettyValue(true)).toMatchObject({ text: "true", inline: true });
    expect(prettyValue(null)).toMatchObject({ text: "null", inline: true });
  });

  it("indents an object", () => {
    const v = prettyValue({ owner: "ada", archived: true });
    expect(v.language).toBe("json");
    expect(v.text).toBe('{\n  "owner": "ada",\n  "archived": true\n}');
    expect(v.lines).toBe(4);
    expect(v.inline).toBe(false);
  });

  it("parses a JSON body that arrived as a string — the common case", () => {
    const v = prettyValue('{"filters":[{"op":"lt","value":"2024-01-01"}]}');
    expect(v.language).toBe("json");
    expect(v.text.split("\n").length).toBeGreaterThan(3);
    expect(v.reformatted).toBe(true);
    expect(v.raw).toBe('{"filters":[{"op":"lt","value":"2024-01-01"}]}');
  });

  it("keeps a numeric string a string, not JSON", () => {
    expect(prettyValue("12345").language).toBe("text");
  });

  it("does not claim a broken JSON-ish string", () => {
    const v = prettyValue('{"unclosed": ');
    expect(v.language).toBe("text");
    expect(v.text).toBe('{"unclosed": ');
  });

  it("indents XML one element per line", () => {
    const v = prettyValue("<batch><ids><id>1</id><id>2</id></ids></batch>");
    expect(v.language).toBe("markup");
    expect(v.text).toBe(
      "<batch>\n  <ids>\n    <id>1</id>\n    <id>2</id>\n  </ids>\n</batch>",
    );
    expect(v.reformatted).toBe(true);
  });

  it("does not read prose starting with a bracket as XML", () => {
    expect(prettyValue("< 3 rows remain").language).toBe("text");
  });

  it("claims a SQL statement without reflowing it", () => {
    const sql = "DELETE FROM leads\nWHERE created_at < '2024-01-01'";
    const v = prettyValue(sql);
    expect(v.language).toBe("sql");
    expect(v.text).toBe(sql);
    expect(v.reformatted).toBe(false);
  });

  it("does not claim a sentence that merely starts with a SQL word", () => {
    expect(prettyValue("update the owner before deleting").language).toBe("text");
    expect(prettyValue("select the right owner from the list").language).toBe("text");
  });

  it("claims a one-line statement that carries a clause and punctuation", () => {
    expect(prettyValue("DELETE FROM leads WHERE id = 7;").language).toBe("sql");
  });

  it("claims a GraphQL document", () => {
    const v = prettyValue("mutation Purge($id: ID!) {\n  delete(id: $id) { id }\n}");
    expect(v.language).toBe("graphql");
    expect(v.reformatted).toBe(false);
  });

  it("does not claim the word query on its own", () => {
    expect(prettyValue("query").language).toBe("text");
  });

  it("treats a long single-line string as a block, not an inline value", () => {
    const v = prettyValue("x".repeat(200));
    expect(v.language).toBe("text");
    expect(v.inline).toBe(false);
  });

  it("survives a value that cannot be serialised", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const v = prettyValue(circular);
    expect(v.language).toBe("text");
    expect(v.text).toContain("object");
  });

  it("leaves an enormous value alone rather than reformatting it", () => {
    const huge = `{"a":"${"x".repeat(200_001)}"}`;
    const v = prettyValue(huge);
    expect(v.language).toBe("text");
    expect(v.reformatted).toBe(false);
  });
});

describe("formatXml", () => {
  it("keeps a leaf element's text on its own line", () => {
    expect(formatXml("<a><b>text</b></a>")).toBe("<a>\n  <b>text</b>\n</a>");
  });

  it("does not indent past a self-closing tag", () => {
    expect(formatXml("<a><b/><c/></a>")).toBe("<a>\n  <b/>\n  <c/>\n</a>");
  });

  it("keeps a declaration at the top level", () => {
    expect(formatXml('<?xml version="1.0"?><a><b>1</b></a>')).toBe(
      '<?xml version="1.0"?>\n<a>\n  <b>1</b>\n</a>',
    );
  });

  it("indents a fragment with no single root, which a parser would reject", () => {
    expect(formatXml("<row><id>1</id></row><row><id>2</id></row>")).toBe(
      "<row>\n  <id>1</id>\n</row>\n<row>\n  <id>2</id>\n</row>",
    );
  });

  it("re-indents XML that was already broken across lines", () => {
    expect(formatXml("<a>\n<b>1</b>\n</a>")).toBe("<a>\n  <b>1</b>\n</a>");
  });
});
