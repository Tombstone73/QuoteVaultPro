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

  test("maps a saved choice ID to the dropdown choice value", () => {
    const tree = {
      schemaVersion: 2,
      rootNodeIds: ["thickness_node"],
      nodes: {
        thickness_node: {
          id: "thickness_node",
          kind: "question",
          label: "Thickness",
          input: { type: "select", selectionKey: "thickness", defaultValue: "4mm" },
          choices: [
            { id: "choice_1", value: "4mm", label: "4mm" },
            { id: "choice_2", value: "10mm", label: "10mm" },
          ],
        },
      },
    } as any;

    act(() => {
      root.render(
        <ProductOptionsPanelV2
          tree={tree}
          selections={{ schemaVersion: 2, selected: { thickness: { value: "choice_2" } } }}
          onSelectionsChange={jest.fn()}
        />,
      );
    });

    expect((container.querySelector("select") as HTMLSelectElement).value).toBe("10mm");
  });

  test("normalizes draft selections stored as choice labels before rendering controls", () => {
    const tree: OptionTreeV2 = {
      schemaVersion: 2,
      rootNodeIds: ["thickness_node", "grommet_node"],
      nodes: {
        thickness_node: {
          id: "thickness_node",
          kind: "question",
          label: "Thickness",
          input: { type: "select", required: true, selectionKey: "thickness", defaultValue: "half" },
          choices: [
            { value: "three_sixteenth", label: "3/16\"" },
            { value: "half", label: "1/2\"" },
          ],
        },
        grommet_node: {
          id: "grommet_node",
          kind: "question",
          label: "Grommet Placement",
          input: { type: "select", required: false, selectionKey: "grommets", defaultValue: "every_2_feet" },
          choices: [
            { value: "none", label: "None" },
            { value: "every_2_feet", label: "Every 2 Feet" },
          ],
        },
      },
    };
    const selections: LineItemOptionSelectionsV2 = {
      schemaVersion: 2,
      selected: {
        thickness: { value: "3/16\"", note: "Default", origin: "DEFAULT", evidence: null },
        grommets: { value: "None", note: "Default", origin: "DEFAULT", evidence: null },
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
    expect(controls[0].value).toBe("three_sixteenth");
    expect(controls[1].value).toBe("none");
  });

  test("can render inbound review controls without persisting automatic defaults", () => {
    const tree: OptionTreeV2 = {
      schemaVersion: 2,
      rootNodeIds: ["thickness_node"],
      nodes: {
        thickness_node: {
          id: "thickness_node",
          kind: "question",
          label: "Thickness",
          input: { type: "select", required: true, selectionKey: "thickness", defaultValue: "half" },
          choices: [
            { value: "three_sixteenth", label: "3/16\"" },
            { value: "half", label: "1/2\"" },
          ],
        },
      },
    };
    const onSelectionsChange = jest.fn();

    act(() => {
      root.render(
        <ProductOptionsPanelV2
          tree={tree}
          selections={{ schemaVersion: 2, selected: {} }}
          onSelectionsChange={onSelectionsChange}
          persistAutomaticSelections={false}
        />,
      );
    });

    expect(onSelectionsChange).not.toHaveBeenCalled();
  });

  test("renders compact order-entry fields without permanent helper text", () => {
    const tree: OptionTreeV2 = {
      schemaVersion: 2,
      rootNodeIds: ["thickness_node", "sides_node"],
      nodes: {
        thickness_node: {
          id: "thickness_node",
          kind: "question",
          label: "Thickness",
          description: "Choose the stock thickness.",
          input: { type: "select", selectionKey: "thickness", defaultValue: "half" },
          choices: [{ value: "half", label: "1/2\"" }],
        },
        sides_node: {
          id: "sides_node",
          kind: "question",
          label: "Print Sides",
          input: { type: "select", selectionKey: "sides", defaultValue: "single" },
          choices: [{ value: "single", label: "Single Sided" }],
        },
      },
    };

    act(() => {
      root.render(
        <ProductOptionsPanelV2
          tree={tree}
          selections={{ schemaVersion: 2, selected: {} }}
          onSelectionsChange={jest.fn()}
          compact
        />,
      );
    });

    expect(container.textContent).toContain("Thickness");
    expect(container.textContent).toContain("Print Sides");
    expect(container.textContent).not.toContain("Choose the stock thickness.");
    expect(container.querySelectorAll("select")).toHaveLength(2);
  });

  test("stores typed and pasted textarea values as strings and reloads them unchanged", () => {
    const tree: OptionTreeV2 = {
      schemaVersion: 2,
      rootNodeIds: ["custom_grommet_placement"],
      nodes: {
        custom_grommet_placement: {
          id: "custom_grommet_placement",
          kind: "question",
          label: "Custom Grommet Placement",
          input: { type: "textarea", selectionKey: "custom_grommet_placement" },
        },
      },
    };
    const onSelectionsChange = jest.fn();
    const placement = "2 on top, 2 on bottom, none on sides";

    act(() => {
      root.render(
        <ProductOptionsPanelV2
          tree={tree}
          selections={{ schemaVersion: 2, selected: {} }}
          onSelectionsChange={onSelectionsChange}
        />,
      );
    });

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, placement);
    act(() => {
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onSelectionsChange).toHaveBeenLastCalledWith(expect.objectContaining({
      selected: {
        custom_grommet_placement: { value: placement },
      },
    }));

    act(() => {
      root.render(
        <ProductOptionsPanelV2
          tree={tree}
          selections={{ schemaVersion: 2, selected: { custom_grommet_placement: { value: placement } } }}
          onSelectionsChange={jest.fn()}
        />,
      );
    });

    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe(placement);
  });

  test("omits disabled product options from mounted line-item controls and prunes stale selections", () => {
    const tree: OptionTreeV2 = {
      schemaVersion: 2,
      rootNodeIds: ["thickness_node", "grommet_node"],
      nodes: {
        thickness_node: {
          id: "thickness_node",
          kind: "question",
          label: "Thickness",
          input: { type: "select", selectionKey: "thickness", defaultValue: "half" },
          choices: [{ value: "half", label: "1/2\"" }],
        },
        grommet_node: {
          id: "grommet_node",
          kind: "question",
          status: "DISABLED",
          label: "Grommet Placement",
          input: { type: "select", selectionKey: "grommets", defaultValue: "corners" },
          choices: [{ value: "corners", label: "Corners" }],
        },
      },
    };
    const onSelectionsChange = jest.fn();

    act(() => {
      root.render(
        <ProductOptionsPanelV2
          tree={tree}
          selections={{ schemaVersion: 2, selected: { grommets: { value: "corners" } } }}
          onSelectionsChange={onSelectionsChange}
        />,
      );
    });

    expect(container.textContent).toContain("Thickness");
    expect(container.textContent).not.toContain("Grommet Placement");
    expect(container.querySelectorAll("select")).toHaveLength(1);
    expect(onSelectionsChange).toHaveBeenCalledWith(expect.objectContaining({
      selected: expect.not.objectContaining({ grommets: expect.anything() }),
      resolved: expect.objectContaining({ visibleNodeIds: ["thickness_node"] }),
    }));
  });
});
