import React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { jest } from "@jest/globals";

jest.mock("./OptionGroupsSidebar", () => ({ OptionGroupsSidebar: () => <div /> }));
jest.mock("./OptionRulesPricingMatrixEditor", () => ({ OptionRulesPricingMatrixEditor: () => <div /> }));
jest.mock("./PBV2EditorErrorBoundary", () => ({ PBV2EditorErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.mock("./OptionEditor", () => ({
  OptionEditor: ({ onSelectOption }: { onSelectOption: (id: string) => void }) => {
    const [expanded, setExpanded] = React.useState(false);
    return <button type="button" onClick={() => { setExpanded(true); onSelectOption("option_thickness"); }}>{expanded ? "expanded" : "collapsed"}</button>;
  },
}));

import { PBV2ProductBuilderLayout } from "./PBV2ProductBuilderLayout";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("PBV2ProductBuilderLayout", () => {
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

  it("does not remount the option editor when opening an option", async () => {
    function Harness() {
      const [selectedOptionId, setSelectedOptionId] = React.useState<string | null>(null);
      return <PBV2ProductBuilderLayout
        editorModel={{ productMeta: { name: "PVC", category: "Rigid", sku: "", status: "draft", fulfillment: "pickup-only", basePrice: 0 }, groups: [{ id: "group_thickness", name: "Thickness", description: "", sortOrder: 0, isRequired: true, isMultiSelect: false, optionIds: ["option_thickness"] }], options: {}, tags: { groupPricing: new Set(), groupProduction: new Set(), groupConditionals: new Set() } }}
        treeJson={{}}
        selectedGroupId="group_thickness"
        selectedOptionId={selectedOptionId}
        onSelectGroup={jest.fn()}
        onSelectOption={setSelectedOptionId}
        onAddGroup={jest.fn()}
        onImportTemplate={jest.fn()}
        onSaveGroupAsTemplate={jest.fn()}
        onDeleteGroup={jest.fn()}
        onReorderGroup={jest.fn()}
        onAddOption={jest.fn()}
        onDeleteOption={jest.fn()}
        onUpdateGroup={jest.fn()}
        onUpdateProduct={jest.fn()}
        onUpdateOption={jest.fn()}
        onAddChoice={jest.fn()}
        onUpdateChoice={jest.fn()}
        onDeleteChoice={jest.fn()}
        onReorderChoice={jest.fn()}
        onUpdateNodePricing={jest.fn()}
        onAddPricingRule={jest.fn()}
        onDeletePricingRule={jest.fn()}
        onUpdatePricingV2Base={jest.fn()}
        onUpdatePricingV2UnitSystem={jest.fn()}
        onAddPricingV2Tier={jest.fn()}
        onUpdatePricingV2Tier={jest.fn()}
        onDeletePricingV2Tier={jest.fn()}
        onUpdateOptionRules={jest.fn()}
        onUpdatePricingMatrix={jest.fn()}
        onRepairPricingMatrix={jest.fn()}
        onSave={jest.fn()}
        onPublish={jest.fn()}
        onExportJson={jest.fn()}
        onImportJson={jest.fn()}
      />;
    }

    await act(async () => { root.render(<Harness />); });
    const toggle = container.querySelector("button");
    expect(toggle?.textContent).toBe("collapsed");
    await act(async () => { toggle?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(container.querySelector("button")?.textContent).toBe("expanded");
  });
});
