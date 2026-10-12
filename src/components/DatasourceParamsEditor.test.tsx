import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  DatasourceParamsEditor,
  isStateTemplate,
  paginationParamNames,
  textToValue,
  valueToText,
} from "./DatasourceParamsEditor";
import type { DataSourceParamSpec } from "@/lib/api";

const spec = (over: Partial<DataSourceParamSpec> = {}): DataSourceParamSpec => ({
  name: "pagination",
  type: "object",
  required: false,
  description: "PaginationInput: {limit, skip}",
  ...over,
});

// The bug this file exists for: `params: { pagination: {limit: 50, skip: 0} }`
// went into a text input typed `Record<string, string>`, so the editor showed
// `[object Object]` and there was no way to author one.
describe("valueToText", () => {
  it("renders an object as JSON, not [object Object]", () => {
    const text = valueToText({ limit: 50, skip: 0 });
    expect(text).not.toContain("[object Object]");
    expect(JSON.parse(text)).toEqual({ limit: 50, skip: 0 });
  });

  it("leaves strings and numbers alone", () => {
    expect(valueToText("Sheet1!A1")).toBe("Sheet1!A1");
    expect(valueToText(50)).toBe("50");
    expect(valueToText(true)).toBe("true");
  });

  it("renders empty for nothing set", () => {
    expect(valueToText(null)).toBe("");
    expect(valueToText(undefined)).toBe("");
  });
});

describe("isStateTemplate", () => {
  it("recognises a lone state reference", () => {
    expect(isStateTemplate("{rows}")).toBe(true);
    expect(isStateTemplate("{rows[values]}")).toBe(true);
    expect(isStateTemplate(" {cc_projects} ")).toBe(true);
  });

  it("does not treat JSON or prose as a template", () => {
    expect(isStateTemplate('{"limit": 50}')).toBe(false);
    expect(isStateTemplate("rows: {rows}")).toBe(false);
  });
});

describe("textToValue", () => {
  it("parses an object param into an object", () => {
    expect(textToValue('{"limit": 50, "skip": 0}', "object")).toEqual({
      value: { limit: 50, skip: 0 },
    });
  });

  it("keeps a {state_key} template as a string for an object param", () => {
    // The runtime substitutes the whole value, so this is correct input and
    // must not be JSON-parsed.
    expect(textToValue("{rows}", "object")).toEqual({ value: "{rows}" });
  });

  it("reports invalid JSON without discarding what was typed", () => {
    const got = textToValue('{"limit": ', "object");
    expect(got.error).toBe("Not valid JSON");
    expect(got.value).toBe('{"limit": ');
  });

  it("insists on the right JSON shape", () => {
    expect(textToValue("[1,2]", "object").error).toBe("Expected a JSON object");
    expect(textToValue('{"a":1}', "array").error).toBe("Expected a JSON array");
  });

  it("coerces numbers and booleans", () => {
    expect(textToValue("50", "number")).toEqual({ value: 50 });
    expect(textToValue("true", "boolean")).toEqual({ value: true });
    expect(textToValue("nope", "number").error).toBe("Not a number");
  });

  it("leaves a string param as typed", () => {
    expect(textToValue("Sheet1!A1", "string")).toEqual({ value: "Sheet1!A1" });
  });
});

describe("DatasourceParamsEditor", () => {
  it("shows an object param as editable JSON", () => {
    render(
      <DatasourceParamsEditor
        specs={[spec()]}
        value={{ pagination: { limit: 50, skip: 0 } }}
        onChange={() => {}}
      />,
    );

    const field = screen.getByLabelText("pagination") as HTMLTextAreaElement;
    expect(field.value).not.toContain("[object Object]");
    expect(JSON.parse(field.value)).toEqual({ limit: 50, skip: 0 });
  });

  it("surfaces the declared type, requiredness and description", () => {
    render(
      <DatasourceParamsEditor
        specs={[spec({ required: true })]}
        value={{}}
        onChange={() => {}}
      />,
    );

    expect(screen.getByText("object")).toBeInTheDocument();
    expect(screen.getByText("required")).toBeInTheDocument();
    expect(screen.getByText(/PaginationInput/)).toBeInTheDocument();
  });

  it("emits a parsed object when JSON is typed", () => {
    const onChange = vi.fn();
    render(
      <DatasourceParamsEditor specs={[spec()]} value={{}} onChange={onChange} />,
    );

    fireEvent.change(screen.getByLabelText("pagination"), {
      target: { value: '{"limit": 25, "skip": 100}' },
    });

    expect(onChange).toHaveBeenLastCalledWith({
      pagination: { limit: 25, skip: 100 },
    });
  });

  it("says so when an operation takes no inputs", () => {
    render(<DatasourceParamsEditor specs={[]} value={{}} onChange={() => {}} />);
    expect(screen.getByText(/declares no inputs/)).toBeInTheDocument();
  });

  it("flags params the operation does not declare, which the runtime drops", () => {
    render(
      <DatasourceParamsEditor
        specs={[spec()]}
        value={{ pagination: {}, offset: 0 }}
        onChange={() => {}}
      />,
    );

    expect(screen.getByText(/the runtime drops these/)).toBeInTheDocument();
    expect(screen.getByText(/offset=0/)).toBeInTheDocument();
  });

  it("can remove a stray param", () => {
    const onChange = vi.fn();
    render(
      <DatasourceParamsEditor
        specs={[spec()]}
        value={{ pagination: {}, offset: 0 }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByLabelText("Remove offset"));

    expect(onChange).toHaveBeenCalledWith({ pagination: {} });
  });
});

// Pagination is the data source's business. Showing `pagination` invited a
// workflow to set it — and as an object param it rendered `[object Object]`,
// which looked like something you were supposed to fill in.
describe("pagination params are the source's business", () => {
  const paginate = {
    type: "offset",
    param: "pagination.skip",
    size_param: "pagination.limit",
    page_size: 100,
  };

  it("extracts the param names a paginate block drives, dotted paths included", () => {
    expect([...paginationParamNames(paginate)]).toEqual(["pagination"]);
    expect([...paginationParamNames({ param: "page" })]).toEqual(["page"]);
    expect([...paginationParamNames(null)]).toEqual([]);
    expect([...paginationParamNames({})]).toEqual([]);
  });

  it("hides a paginated param from the form", () => {
    render(
      <DatasourceParamsEditor
        specs={[spec(), spec({ name: "filterBy", type: "object" })]}
        value={{}}
        paginate={paginate}
        onChange={() => {}}
      />,
    );

    expect(screen.queryByLabelText("pagination")).toBeNull();
    expect(screen.getByLabelText("filterBy")).toBeInTheDocument();
    expect(screen.getByText(/Paged automatically/)).toBeInTheDocument();
  });

  it("does not flag a paginated param as a stray leftover", () => {
    render(
      <DatasourceParamsEditor
        specs={[spec()]}
        value={{ pagination: { limit: 50, skip: 0 } }}
        paginate={paginate}
        onChange={() => {}}
      />,
    );

    expect(screen.queryByText(/the runtime drops these/)).toBeNull();
  });

  it("says so when pagination was the operation's only input", () => {
    render(
      <DatasourceParamsEditor
        specs={[spec()]}
        value={{}}
        paginate={paginate}
        onChange={() => {}}
      />,
    );

    expect(screen.getByText(/handles itself/)).toBeInTheDocument();
  });
});
