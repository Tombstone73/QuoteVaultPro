import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

import { OptionEditor } from "./OptionEditor";

jest.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

jest.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));

jest.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

jest.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectValue: () => null,
}));

jest.mock("@/components/ui/separator", () => ({
  Separator: (props: any) => <hr {...props} />,
}));

jest.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, ...props }: any) => (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.target.checked)}
      {...props}
    />
  ),
}));

jest.mock("@/components/ui/textarea", () => ({
  Textarea: (props: any) => <textarea {...props} />,
}));

jest.mock("./OptionDetailsEditor", () => ({
  OptionDetailsEditor: () => <div />,
}));

describe("OptionEditor product option enablement", () => {
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

  test("shows disabled options and lets staff re-enable the product option", () => {
    const onUpdateOption = jest.fn();

    act(() => {
      root.render(
        <OptionEditor
          selectedGroup={{
            id: "group_finishing",
            name: "Finishing",
            description: "",
            sortOrder: 0,
            isRequired: false,
            isMultiSelect: false,
            optionIds: ["grommets"],
          }}
          options={{
            grommets: {
              id: "grommets",
              name: "Grommets",
              description: "",
              type: "checkbox",
              enabled: false,
              sortOrder: 0,
              isDefault: false,
              isRequired: false,
              selectionKey: "grommets",
              hasPricing: true,
              hasProductionFlags: false,
              hasConditionals: false,
              hasWeight: false,
            },
          }}
          selectedOptionId={null}
          onSelectOption={jest.fn()}
          onAddOption={jest.fn()}
          onDeleteOption={jest.fn()}
          onUpdateGroup={jest.fn()}
          onUpdateOption={onUpdateOption}
          onAddChoice={jest.fn()}
          onUpdateChoice={jest.fn()}
          onDeleteChoice={jest.fn()}
          onReorderChoice={jest.fn()}
          onUpdateNodePricing={jest.fn()}
          onAddPricingRule={jest.fn()}
          onDeletePricingRule={jest.fn()}
          treeJson={{ nodes: {}, edges: [] }}
        />,
      );
    });

    expect(container.textContent).toContain("Grommets");
    expect(container.textContent).toContain("Disabled");

    const toggle = container.querySelector('input[aria-label="Enable Grommets"]') as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    act(() => {
      toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onUpdateOption).toHaveBeenCalledWith("grommets", { enabled: true });
  });
});
