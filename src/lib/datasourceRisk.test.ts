import { describe, expect, it } from "vitest";
import {
  graphqlWrites,
  methodLevel,
  operationLevel,
  operationsRiskLevel,
  operationsRiskTitle,
} from "./datasourceRisk";

describe("methodLevel", () => {
  it("reads the verb, case- and space-insensitively", () => {
    expect(methodLevel(" get ")).toBe("read");
    expect(methodLevel("patch")).toBe("write");
    expect(methodLevel("DELETE")).toBe("delete");
  });

  it("is unknown, never red, for a verb it does not recognise", () => {
    expect(methodLevel(null)).toBe("unknown");
    expect(methodLevel("QUERY")).toBe("unknown");
  });
});

// Every GraphQL call is a POST, so reading the verb painted read-only sources
// like a GraphQL API amber with a `W` and would have put a query behind the
// approval gate. Mirrors graphql_writes in
// app/infrastructure/datasources/destructive.py.
describe("graphqlWrites", () => {
  it("treats a query as a read", () => {
    expect(graphqlWrites("query projects { projects { id } }")).toBe(false);
    expect(graphqlWrites("{ projects { id } }")).toBe(false); // shorthand form
    expect(graphqlWrites("query { statistics { received } }")).toBe(false);
  });

  it("treats a subscription as a read — it streams, it changes nothing", () => {
    expect(graphqlWrites("subscription S { events { id } }")).toBe(false);
  });

  it("treats a mutation as a write, named or anonymous", () => {
    expect(graphqlWrites("mutation { deleteMachine(id: 1) { ok } }")).toBe(true);
    expect(
      graphqlWrites("mutation Del($id: Int!) { deleteMachine(id: $id) { ok } }"),
    ).toBe(true);
  });

  it("finds a mutation alongside a query in one document", () => {
    expect(graphqlWrites("query A { a }\nmutation B { b }")).toBe(true);
  });

  it("is not fooled by the word appearing as a field, string or comment", () => {
    expect(graphqlWrites("query Q { mutationCount }")).toBe(false);
    expect(graphqlWrites('query Q { f(note: "mutation { x }") }')).toBe(false);
    expect(graphqlWrites("# mutation { x }\nquery Q { f }")).toBe(false);
  });

  it("says no for an empty document rather than guessing", () => {
    expect(graphqlWrites(null)).toBe(false);
    expect(graphqlWrites("")).toBe(false);
  });
});

describe("operationLevel", () => {
  it("reads a graphql query as read even though the verb is POST", () => {
    expect(
      operationLevel({ method: "POST", query: "query { projects { id } }" }, "graphql"),
    ).toBe("read");
  });

  it("reads a graphql mutation as a write", () => {
    expect(
      operationLevel({ method: "POST", query: "mutation { drop { ok } }" }, "graphql"),
    ).toBe("write");
  });

  it("still uses the verb for http sources", () => {
    expect(operationLevel({ method: "POST" }, "http")).toBe("write");
    expect(operationLevel({ method: "GET" }, "http")).toBe("read");
    expect(operationLevel({ method: "DELETE" }, "http")).toBe("delete");
  });

  it("defaults to http when kind is absent", () => {
    expect(operationLevel({ method: "GET" })).toBe("read");
  });

  it("lets an explicit destructive flag win in both directions", () => {
    expect(operationLevel({ method: "GET", destructive: true })).toBe("delete");
    expect(operationLevel({ method: "DELETE", destructive: false })).toBe("read");
    expect(
      operationLevel({ query: "mutation { x { ok } }", destructive: false }, "graphql"),
    ).toBe("read");
  });
});

describe("operationsRiskLevel", () => {
  it("is worst-wins across a set", () => {
    expect(
      operationsRiskLevel([{ method: "GET" }, { method: "GET" }, { method: "POST" }]),
    ).toBe("write");
    expect(
      operationsRiskLevel([{ method: "DELETE" }, { method: "POST" }, { method: "GET" }]),
    ).toBe("delete");
  });

  it("stays read for a query-only graphql source", () => {
    expect(
      operationsRiskLevel(
        [
          { method: "POST", query: "query { projects { id } }" },
          { method: "POST", query: "query { statistics { received } }" },
          { method: "POST", query: "query { machines { id } }" },
        ],
        "graphql",
      ),
    ).toBe("read");
  });

  it("goes to write as soon as one mutation is exposed", () => {
    expect(
      operationsRiskLevel(
        [
          { method: "POST", query: "query { projects { id } }" },
          { method: "POST", query: "mutation { deleteMachine(id: 1) { ok } }" },
        ],
        "graphql",
      ),
    ).toBe("write");
  });

  it("is unknown, not read, for no operations at all", () => {
    expect(operationsRiskLevel([])).toBe("unknown");
  });
});

describe("operationsRiskTitle", () => {
  it("says read-only for a query-only graphql source", () => {
    const ops = [
      { method: "POST", query: "query { a }" },
      { method: "POST", query: "query { b }" },
    ];
    expect(operationsRiskTitle(ops, "graphql")).toBe("Read-only (2 operations)");
  });

  it("counts the operations at the level it reports", () => {
    expect(operationsRiskTitle([{ method: "DELETE" }])).toBe(
      "Contains a delete operation",
    );
    expect(operationsRiskTitle([{ method: "POST" }, { method: "GET" }])).toBe(
      "1 write operation",
    );
  });

  it("distinguishes no operations from unrecognised ones", () => {
    expect(operationsRiskTitle([])).toBe("No operations — risk unknown");
    expect(operationsRiskTitle([{ method: "QUERY" }])).toBe(
      "Unknown operations — risk unknown",
    );
  });
});
