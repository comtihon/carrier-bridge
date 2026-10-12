/**
 * Turning a value into something foldable.
 *
 * The tree is what the reviewer folds and what the find bar searches, so the
 * tests are about the two things that make it usable on a real payload: the
 * shape survives (keys, indices, attributes, text), and a malformed document
 * still produces a tree rather than an exception in the middle of an approval.
 */
import { describe, it, expect } from "vitest";
import {
  ancestorIds, branchIds, buildJsonTree, buildValueTree, countNodes,
  findMatches, parseXmlTree,
} from "./valueTree";
import { prettyValue } from "./prettyValue";

describe("buildJsonTree", () => {
  it("keeps keys, nesting and scalar types", () => {
    const root = buildJsonTree({ owner: "ada", count: 3, live: true, gone: null });
    expect(root.kind).toBe("object");
    expect(root.summary).toBe("4 keys");
    expect(root.children.map((c) => c.name)).toEqual(["owner", "count", "live", "gone"]);
    expect(root.children.map((c) => c.valueKind)).toEqual(["string", "number", "boolean", "null"]);
  });

  it("numbers an array by position", () => {
    const root = buildJsonTree([10, 20, 30]);
    expect(root.kind).toBe("array");
    expect(root.summary).toBe("3 items");
    expect(root.children.map((c) => c.id)).toEqual(["0/0", "0/1", "0/2"]);
  });

  it("gives every node an id that carries its ancestry", () => {
    const root = buildJsonTree({ a: { b: [{ c: 1 }] } });
    // root › a › b › the array's one item › c
    const leaf = root.children[0].children[0].children[0].children[0];
    expect(leaf.name).toBe("c");
    expect(leaf.id).toBe("0/0/0/0/0");
    expect(ancestorIds(leaf.id)).toEqual(["0", "0/0", "0/0/0", "0/0/0/0"]);
  });
});

describe("parseXmlTree", () => {
  it("keeps tags, attributes and nesting", () => {
    const [root] = parseXmlTree('<batch mode="hard"><id>7</id></batch>');
    expect(root.name).toBe("batch");
    expect(root.attrs).toEqual([["mode", "hard"]]);
    expect(root.children[0].name).toBe("id");
    expect(root.children[0].value).toBe("7");
  });

  it("reads an element whose only content is text as one leaf", () => {
    const [root] = parseXmlTree("<a><b>text</b></a>");
    expect(root.children[0].children).toHaveLength(0);
    expect(root.children[0].value).toBe("text");
  });

  it("handles a self-closing element", () => {
    const [root] = parseXmlTree("<a><b/><c>1</c></a>");
    expect(root.children.map((c) => c.name)).toEqual(["b", "c"]);
    expect(root.children[0].value).toBeNull();
  });

  it("parses a rootless fragment, which a strict parser would reject", () => {
    const roots = parseXmlTree("<row><id>1</id></row><row><id>2</id></row>");
    expect(roots).toHaveLength(2);
    expect(roots.map((r) => r.children[0].value)).toEqual(["1", "2"]);
  });

  it("keeps a declaration as its own node", () => {
    const roots = parseXmlTree('<?xml version="1.0"?><a>1</a>');
    expect(roots[0].name).toBe('?xml version="1.0"?');
    expect(roots[1].name).toBe("a");
  });

  it("survives a stray closing tag", () => {
    const roots = parseXmlTree("<a>1</a></b>");
    expect(roots).toHaveLength(1);
    expect(roots[0].value).toBe("1");
  });

  it("closes an unclosed element at the end of input", () => {
    const [root] = parseXmlTree("<a><b>1</b>");
    expect(root.name).toBe("a");
    expect(root.children[0].value).toBe("1");
  });

  it("reads CDATA as text rather than as tags", () => {
    const [root] = parseXmlTree("<a><![CDATA[<not a tag>]]></a>");
    expect(root.value).toBe("<not a tag>");
  });

  it("does not read an attribute out of the tag name", () => {
    const [root] = parseXmlTree("<id>7</id>");
    expect(root.attrs).toEqual([]);
  });
});

describe("searching a tree", () => {
  const roots = [buildJsonTree({
    owner: "ada",
    nested: { owner: "grace", deep: { note: "owner of record" } },
    other: 1,
  })];

  it("finds every node whose own line contains the term", () => {
    expect(findMatches(roots, "owner")).toEqual(["0/0", "0/1/0", "0/1/1/0"]);
  });

  it("ignores case and empty queries", () => {
    expect(findMatches(roots, "ADA")).toEqual(["0/0"]);
    expect(findMatches(roots, "   ")).toEqual([]);
  });

  it("matches a value as well as a key", () => {
    expect(findMatches(roots, "grace")).toEqual(["0/1/0"]);
  });
});

describe("tree bookkeeping", () => {
  it("counts every node", () => {
    // root, a, b, c
    expect(countNodes([buildJsonTree({ a: 1, b: { c: 2 } })])).toBe(4);
  });

  it("lists the branches, which are the foldable rows", () => {
    expect(branchIds([buildJsonTree({ a: 1, b: { c: 2 } })])).toEqual(["0", "0/1"]);
  });
});

describe("buildValueTree", () => {
  it("builds from a JSON string parameter", () => {
    const raw = '{"ids":[1,2]}';
    const tree = buildValueTree(raw, prettyValue(raw));
    expect(tree?.[0].children[0].name).toBe("ids");
  });

  it("builds from an object parameter", () => {
    const value = { a: 1 };
    expect(buildValueTree(value, prettyValue(value))?.[0].kind).toBe("object");
  });

  it("builds from XML", () => {
    const raw = "<a><b>1</b></a>";
    expect(buildValueTree(raw, prettyValue(raw))?.[0].name).toBe("a");
  });

  it("has nothing to fold for SQL, GraphQL or prose", () => {
    const sql = "DELETE FROM leads WHERE id = 7";
    expect(buildValueTree(sql, prettyValue(sql))).toBeNull();
    const text = "a plain sentence";
    expect(buildValueTree(text, prettyValue(text))).toBeNull();
  });

  it("has nothing to fold for an empty structure", () => {
    expect(buildValueTree({}, prettyValue({}))).toBeNull();
  });
});
