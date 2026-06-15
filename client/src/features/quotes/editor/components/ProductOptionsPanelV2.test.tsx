import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import { ProductOptionsPanelV2 } from "./ProductOptionsPanelV2";
import type { LineItemOptionSelectionsV2, OptionTreeV2 } from "@shared/optionTreeV2";

jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

jest.mock("@/components/ui/checkbox", () => ({
  Checkbox: (props: any) => <input type="checkbox" {...props} />,
}));

jest.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

jest.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

jest.mock("@/components/ui/radio-group", () => ({
  RadioGroup: ({ children }: any) => <div>{children}</div>,
  RadioGroupItem: (props: any) => <input type="radio" {...props} />,
}));

jest.mock("@/components/ui/select", () => ({
  Select: ({ children, value, onValueChange }: any) => (
    <select value={value} onChange={(event) => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: () => null,
}));

jest.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, ...props }: any) => (
    <input type="checkbox" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} {...props} />
  ),
}));

jest.mock("@/components/ui/textarea", () => ({
  Textarea: (props: any) => <textarea {...props} />,
}));

describe("ProductOptionsPanelV2", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test("renders draft selections stored under legacy node ids instead of falling back to product defaults", () => {
    const tree: OptionTreeV2 = {
      schemaVersion: 2,
      rootNodeIds: ["thickness_node", "sides_node"],
      nodes: {
        thickness_node: {
          id: "thickness_node",
          kind: "question",
          label: "Thickness",
          input: { type: "select", required: true, selectionKey: "thickness", defaultValue: "half" },
          choices: [
            { value: "3_16", label: "3/16\"" },
            { value: "half", label: "1/2\"" },
          ],
        },
        sides_node: {
          id: "sides_node",
          kind: "question",
          label: "Print Sides",
          input: { type: "select", required: true, selectionKey: "sides", defaultValue: "double" },
          choices: [
            { value: "single", label: "Single Sided 4/0" },
            { value: "double", label: "Double Sided 4/4" },
          ],
        },
      },
    };
    const selections: LineItemOptionSelectionsV2 = {
      schemaVersion: 2,
      selected: {
        thickness_node: { value: "3_16", note: "Default", origin: "DEFAULT", evidence: null },
        sides_node: { value: "single", note: "Source evidence", origin: "SOURCE_EVIDENCE", evidence: "single sided" },
      },
    };

    act(() => {
      root.render(
        <ProductOptionsPanelV2
          tree={tree}
          selections={selections}
          onSelectionsChange={jest.fn()}
        />,
      );
    });

    const controls = Array.from(container.querySelectorAll("select")) as HTMLSelectElement[];
    expect(controls).toHaveLength(2);
    expect(controls[0].value).toBe("3_16");
    expect(controls[1].value).toBe("single");
  });
});
