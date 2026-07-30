import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { jest } from "@jest/globals";
import { TextDecoder, TextEncoder } from "node:util";

Object.assign(globalThis, { TextEncoder, TextDecoder });

jest.mock("./OptionDetailsEditor", () => ({
  OptionDetailsEditor: ({ treeJson, option }: { treeJson: { nodes: Record<string, { choices?: Array<{ label: string }> }> }; option: { id: string } }) => (
    <div>{treeJson.nodes[option.id]?.choices?.map((choice) => choice.label).join(", ")}</div>
  ),
}));

import { OptionEditor } from "./OptionEditor";
import type { EditorOption, EditorOptionGroup } from "@/lib/pbv2/pbv2ViewModel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const group: EditorOptionGroup = {
  id: "group_thickness",
  name: "Thickness",
  description: "",
  sortOrder: 0,
  isRequired: true,
  isMultiSelect: false,
  optionIds: ["option_thickness"],
};

const option: EditorOption = {
  id: "option_thickness",
  name: "Thickness",
  description: "",
  type: "dropdown",
  sortOrder: 0,
  isDefault: false,
  isRequired: true,
  selectionKey: "thickness",
  hasPricing: false,
  hasProductionFlags: false,
  hasConditionals: false,
  hasWeight: false,
};

describe("OptionEditor", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("keeps an opened single-select option expanded so its ordered choices are visible", async () => {
    const onSelectOption = jest.fn();
    await act(async () => {
      root.render(
        <OptionEditor
          selectedGroup={group}
          options={{ [option.id]: option }}
          selectedOptionId={null}
          onSelectOption={onSelectOption}
          onAddOption={jest.fn()}
          onDeleteOption={jest.fn()}
          onUpdateGroup={jest.fn()}
          onUpdateOption={jest.fn()}
          onAddChoice={jest.fn()}
          onUpdateChoice={jest.fn()}
          onDeleteChoice={jest.fn()}
          onReorderChoice={jest.fn()}
          onUpdateNodePricing={jest.fn()}
          onAddPricingRule={jest.fn()}
          onDeletePricingRule={jest.fn()}
          treeJson={{
            nodes: {
              option_thickness: {
                id: "option_thickness",
                label: "Thickness",
                input: { type: "select", required: true, selectionKey: "thickness" },
                choices: [
                  { value: "3mm", label: "3mm", sortOrder: 1 },
                  { value: "6mm", label: "6mm", sortOrder: 2 },
                  { value: "12mm", label: "12mm", sortOrder: 3 },
                  { value: "18mm", label: "18mm", sortOrder: 4 },
                ],
              },
            },
          }}
        />,
      );
    });

    const toggle = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Thickness"));
    expect(toggle).toBeTruthy();
    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSelectOption).toHaveBeenCalledWith("option_thickness");
    expect(container.textContent).toContain("3mm");
    expect(container.textContent).toContain("6mm");
    expect(container.textContent).toContain("12mm");
    expect(container.textContent).toContain("18mm");
  });
});
