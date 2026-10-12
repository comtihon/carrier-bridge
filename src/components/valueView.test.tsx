/**
 * Rendering one parameter value.
 *
 * A structured value is a tree the reviewer folds and searches; an unstructured
 * one is painted text. The tests cover both, and the seams between them: the
 * Raw view is always the bytes, a search always reaches matches inside folded
 * branches, and nothing here ever renders markup it was handed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ValueView } from "./ValueView";

beforeEach(() => {
  vi.clearAllMocks();
});

function bigObject(n: number): Record<string, number> {
  const obj: Record<string, number> = {};
  for (let i = 0; i < n; i++) obj[`k${i}`] = i;
  return obj;
}

/** The rendered value, whichever way it was drawn. */
function body(container: HTMLElement): string {
  return container.querySelector("pre")?.textContent
    ?? container.textContent
    ?? "";
}

describe("ValueView: a short scalar", () => {
  it("stays beside its key, with no chrome", () => {
    const { container } = render(<ValueView value="30d" />);
    expect(screen.getByText("30d")).toBeInTheDocument();
    expect(container.querySelector("pre")).toBeNull();
    expect(screen.queryByText("JSON")).not.toBeInTheDocument();
  });
});

describe("ValueView: a JSON value", () => {
  it("draws a tree with the keys and values visible", () => {
    const { container } = render(<ValueView value={{ owner: "ada", count: 3 }} />);
    expect(screen.getByText("JSON")).toBeInTheDocument();
    expect(container.textContent).toContain("owner");
    expect(container.textContent).toContain("ada");
    expect(container.textContent).toContain("3");
  });

  it("parses a body that arrived as a string", () => {
    const { container } = render(<ValueView value='{"ids":[1,2,3],"hard":true}' />);
    expect(container.textContent).toContain("ids");
    expect(container.textContent).toContain("hard");
  });

  it("folds a branch on click and says what is inside it", () => {
    const { container } = render(<ValueView value={{ filter: { owner: "ada" } }} />);
    expect(container.textContent).toContain("owner");
    fireEvent.click(screen.getAllByLabelText("Fold")[1]);
    expect(container.textContent).not.toContain("owner");
    expect(container.textContent).toContain("1 key");
  });

  it("unfolds again", () => {
    const { container } = render(<ValueView value={{ filter: { owner: "ada" } }} />);
    fireEvent.click(screen.getAllByLabelText("Fold")[1]);
    fireEvent.click(screen.getByLabelText("Unfold"));
    expect(container.textContent).toContain("ada");
  });

  it("folds and unfolds everything from the header", () => {
    const { container } = render(<ValueView value={{ a: { b: 1 }, c: { d: 2 } }} />);
    fireEvent.click(screen.getByTitle("Fold everything"));
    expect(container.textContent).not.toContain("b");
    fireEvent.click(screen.getByTitle("Unfold everything"));
    expect(container.textContent).toContain("b");
  });

  it("opens a large value folded below the first level", () => {
    const { container } = render(<ValueView value={{ outer: bigObject(120) }} />);
    expect(container.textContent).toContain("outer");
    expect(container.textContent).not.toContain("k119");
    expect(container.textContent).toContain("120 keys");
  });

  it("numbers array items so a position can be quoted", () => {
    const { container } = render(<ValueView value={{ ids: ["a", "b"] }} />);
    const text = container.textContent ?? "";
    expect(text).toContain("0");
    expect(text).toContain("1");
  });
});

describe("ValueView: an XML value", () => {
  it("draws the tags, the attributes and the text", () => {
    const { container } = render(<ValueView value={'<batch mode="hard"><id>7</id></batch>'} />);
    expect(screen.getByText("XML")).toBeInTheDocument();
    expect(container.textContent).toContain("batch");
    expect(container.textContent).toContain("mode");
    expect(container.textContent).toContain("hard");
    expect(container.textContent).toContain("7");
  });

  it("folds an element", () => {
    const { container } = render(<ValueView value={"<a><b>seven</b></a>"} />);
    expect(container.textContent).toContain("seven");
    fireEvent.click(screen.getByLabelText("Fold"));
    expect(container.textContent).not.toContain("seven");
    expect(container.textContent).toContain("1 child");
  });
});

describe("ValueView: find", () => {
  it("counts the matches and marks them", () => {
    const { container } = render(
      <ValueView value={{ owner: "ada", nested: { owner: "grace" } }} />,
    );
    fireEvent.click(screen.getByTitle("Find in this value"));
    fireEvent.change(screen.getByLabelText("Find in this value"), {
      target: { value: "owner" },
    });
    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(container.querySelectorAll("mark").length).toBeGreaterThan(1);
  });

  it("says so when nothing matches", () => {
    render(<ValueView value={{ owner: "ada" }} />);
    fireEvent.click(screen.getByTitle("Find in this value"));
    fireEvent.change(screen.getByLabelText("Find in this value"), {
      target: { value: "zzz" },
    });
    expect(screen.getByText("no matches")).toBeInTheDocument();
  });

  it("unfolds the branches a match is hiding in", () => {
    const { container } = render(<ValueView value={{ outer: bigObject(120) }} />);
    expect(container.textContent).not.toContain("k117");
    fireEvent.click(screen.getByTitle("Find in this value"));
    fireEvent.change(screen.getByLabelText("Find in this value"), {
      target: { value: "k117" },
    });
    expect(container.textContent).toContain("k117");
  });

  it("steps between matches", () => {
    render(<ValueView value={{ a: "hit", b: "hit", c: "hit" }} />);
    fireEvent.click(screen.getByTitle("Find in this value"));
    fireEvent.change(screen.getByLabelText("Find in this value"), {
      target: { value: "hit" },
    });
    expect(screen.getByText("1/3")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Next match"));
    expect(screen.getByText("2/3")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Previous match"));
    expect(screen.getByText("1/3")).toBeInTheDocument();
  });

  it("wraps around at the ends", () => {
    render(<ValueView value={{ a: "hit", b: "hit" }} />);
    fireEvent.click(screen.getByTitle("Find in this value"));
    fireEvent.change(screen.getByLabelText("Find in this value"), {
      target: { value: "hit" },
    });
    fireEvent.click(screen.getByLabelText("Previous match"));
    expect(screen.getByText("2/2")).toBeInTheDocument();
  });

  it("Enter walks forward, Escape closes", () => {
    render(<ValueView value={{ a: "hit", b: "hit" }} />);
    fireEvent.click(screen.getByTitle("Find in this value"));
    const input = screen.getByLabelText("Find in this value");
    fireEvent.change(input, { target: { value: "hit" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("2/2")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByLabelText("Find in this value")).not.toBeInTheDocument();
  });

  it("marks matches in a flat value too", () => {
    const { container } = render(
      <ValueView value={"DELETE FROM leads\nWHERE owner = 'ada'\nAND archived"} />,
    );
    fireEvent.click(screen.getByTitle("Find in this value"));
    fireEvent.change(screen.getByLabelText("Find in this value"), {
      target: { value: "owner" },
    });
    expect(screen.getByText("1 match")).toBeInTheDocument();
    expect(container.querySelectorAll("mark").length).toBe(1);
  });
});

describe("ValueView: the raw bytes", () => {
  it("shows exactly what was sent, and comes back", () => {
    const raw = '{"a":1,"b":2}';
    const { container } = render(<ValueView value={raw} />);
    fireEvent.click(screen.getByText("Raw"));
    expect(body(container)).toBe(raw);
    fireEvent.click(screen.getByText("Formatted"));
    expect(container.textContent).toContain("a");
  });

  it("offers no raw toggle when nothing was reformatted", () => {
    render(<ValueView value={"DELETE FROM leads\nWHERE id = 7"} />);
    expect(screen.getByText("SQL")).toBeInTheDocument();
    expect(screen.queryByText("Raw")).not.toBeInTheDocument();
  });
});

describe("ValueView: an unstructured value", () => {
  it("paints a recognised grammar with Prism tokens", () => {
    const { container } = render(
      <ValueView value={"SELECT * FROM leads\nWHERE id = 7"} />,
    );
    expect(container.querySelector("pre .token")).not.toBeNull();
  });

  it("renders prose without touching innerHTML", () => {
    const { container } = render(<ValueView value={"a plain sentence\nover two lines"} />);
    const pre = container.querySelector("pre");
    expect(pre?.textContent).toContain("a plain sentence");
    expect(pre?.querySelector(".token")).toBeNull();
  });

  it("clamps a long flat value so the decision stays on screen", () => {
    const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`).join("\n");
    const { container } = render(<ValueView value={lines} />);
    expect(container.querySelector("pre")?.textContent?.split("\n").length).toBe(14);
    fireEvent.click(screen.getByText("Show all 40 lines"));
    expect(container.querySelector("pre")?.textContent?.split("\n").length).toBe(40);
  });
});

describe("ValueView: safety and utility", () => {
  it("escapes markup in a value rather than rendering it", () => {
    const { container } = render(
      <ValueView value={'{"note":"<img src=x onerror=alert(1)>"}'} />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img src=x");
  });

  it("copies the value that is on screen", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText }, configurable: true, writable: true,
    });
    render(<ValueView value='{"a":1}' />);
    fireEvent.click(screen.getByText("Copy"));
    expect(writeText).toHaveBeenCalledWith('{\n  "a": 1\n}');
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("draws only the first screenfuls of an enormous tree", () => {
    const { container } = render(<ValueView value={bigObject(600)} />);
    // Keys render with their JSON quotes, inside one span each.
    const rows = within(container).getAllByText(/^"k\d+"$/);
    expect(rows.length).toBeLessThanOrEqual(400);
    expect(screen.getByText(/Draw all \d+ rows/)).toBeInTheDocument();
  });
});
