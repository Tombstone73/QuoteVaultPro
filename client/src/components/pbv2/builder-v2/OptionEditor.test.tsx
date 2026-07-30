import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { TextDecoder, TextEncoder } from "node:util";

Object.assign(globalThis, { TextEncoder, TextDecoder });

jest.mock("@/components/ui/badge", () => ({ Badge: ({ children }: any) => <span>{children}</span> }));
jest.mock("@/components/ui/button", () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
jest.mock("@/components/ui/input", () => ({ Input: (props: any) => <input {...props} /> }));
jest.mock("@/components/ui/label", () => ({ Label: ({ children, ...props }: any) => <label {...props}>{children}</label> }));
jest.mock("@/components/ui/select", () => ({ Select: ({ children }: any) => <div>{children}</div>, SelectContent: ({ children }: any) => <>{children}</>, SelectItem: ({ children }: any) => <div>{children}</div>, SelectTrigger: ({ children }: any) => <>{children}</>, SelectValue: () => null }));
jest.mock("@/components/ui/separator", () => ({ Separator: (props: any) => <hr {...props} /> }));
jest.mock("@/components/ui/switch", () => ({ Switch: ({ checked, onCheckedChange, ...props }: any) => <input type="checkbox" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} {...props} /> }));
jest.mock("@/components/ui/textarea", () => ({ Textarea: (props: any) => <textarea {...props} /> }));
jest.mock("./OptionDetailsEditor", () => ({
  OptionDetailsEditor: ({ treeJson, option }: any) => <div>{treeJson.nodes?.[option.id]?.choices?.map((choice: any) => choice.label).join(", ")}</div>,
}));

import { OptionEditor } from "./OptionEditor";
import type { EditorOption, EditorOptionGroup } from "@/lib/pbv2/pbv2ViewModel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const thicknessGroup: EditorOptionGroup = { id: "group_thickness", name: "Thickness", description: "", sortOrder: 0, isRequired: true, isMultiSelect: false, optionIds: ["option_thickness"] };
const thicknessOption: EditorOption = { id: "option_thickness", name: "Thickness", description: "", type: "dropdown", sortOrder: 0, isDefault: false, isRequired: true, selectionKey: "thickness", hasPricing: false, hasProductionFlags: false, hasConditionals: false, hasWeight: false };

function sharedProps() {
  return { onAddChoice: jest.fn(), onUpdateChoice: jest.fn(), onDeleteChoice: jest.fn(), onReorderChoice: jest.fn(), onUpdateNodePricing: jest.fn(), onAddPricingRule: jest.fn(), onDeletePricingRule: jest.fn() };
}

describe("OptionEditor", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); });
  afterEach(() => { act(() => root.unmount()); container.remove(); });

  test("shows disabled options and lets staff re-enable the product option", () => {
    const onUpdateOption = jest.fn();
    act(() => root.render(<OptionEditor selectedGroup={{ id: "group_finishing", name: "Finishing", description: "", sortOrder: 0, isRequired: false, isMultiSelect: false, optionIds: ["grommets"] }} options={{ grommets: { id: "grommets", name: "Grommets", description: "", type: "checkbox", enabled: false, sortOrder: 0, isDefault: false, isRequired: false, selectionKey: "grommets", hasPricing: true, hasProductionFlags: false, hasConditionals: false, hasWeight: false } }} selectedOptionId={null} onSelectOption={jest.fn()} onAddOption={jest.fn()} onDeleteOption={jest.fn()} onUpdateGroup={jest.fn()} onUpdateOption={onUpdateOption} treeJson={{ nodes: {}, edges: [] }} {...sharedProps()} />));
    expect(container.textContent).toContain("Grommets");
    expect(container.textContent).toContain("Disabled");
    const toggle = container.querySelector('input[aria-label="Enable Grommets"]') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
    act(() => toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onUpdateOption).toHaveBeenCalledWith("grommets", { enabled: true });
  });

  test("keeps an opened single-select option expanded so ordered choices are visible", async () => {
    const onSelectOption = jest.fn();
    await act(async () => root.render(<OptionEditor selectedGroup={thicknessGroup} options={{ [thicknessOption.id]: thicknessOption }} selectedOptionId={null} onSelectOption={onSelectOption} onAddOption={jest.fn()} onDeleteOption={jest.fn()} onUpdateGroup={jest.fn()} onUpdateOption={jest.fn()} treeJson={{ nodes: { option_thickness: { id: "option_thickness", label: "Thickness", input: { type: "select", required: true, selectionKey: "thickness" }, choices: [{ value: "3mm", label: "3mm", sortOrder: 1 }, { value: "6mm", label: "6mm", sortOrder: 2 }, { value: "12mm", label: "12mm", sortOrder: 3 }, { value: "18mm", label: "18mm", sortOrder: 4 }] } }} {...sharedProps()} />));
    const toggle = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Thickness"));
    expect(toggle).toBeTruthy();
    await act(async () => toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onSelectOption).toHaveBeenCalledWith("option_thickness");
    for (const choice of ["3mm", "6mm", "12mm", "18mm"]) expect(container.textContent).toContain(choice);
  });
});
