import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { RollOrderGroupRow } from "./RollOrderGroupRow";
import { groupRollProductionJobs } from "./rollProductionGrouping";

jest.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, ...props }: any) => <input type="checkbox" checked={checked === true} data-indeterminate={checked === "indeterminate" ? "true" : "false"} onChange={(event) => onCheckedChange(event.target.checked)} {...props} />,
}));

const grouped = groupRollProductionJobs([
  { id: "art-a", orderId: "20949", status: "queued", qty: 5, media: "Avery", order: { id: "20949", orderNumber: "20949", customerName: "Bright Signs Marketing" } },
  { id: "art-b", orderId: "20949", status: "in_progress", qty: 7, media: "Vinyl", order: { id: "20949", orderNumber: "20949", customerName: "Bright Signs Marketing" } },
] as any);
const group = grouped[0];
if (group.kind !== "group") throw new Error("Expected a group fixture");

test("header expansion never changes selection; checkbox selects only eligible jobs and reflects partial selection", () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  function Harness() {
    const [expanded, setExpanded] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    return <table><tbody><RollOrderGroupRow group={group} orderNumber="20949" selectableIds={new Set(["art-a"])} selectedIds={selected} expanded={expanded} onToggle={() => setExpanded(!expanded)} onSelectionChange={setSelected} /></tbody><tfoot><tr><td data-selected={Array.from(selected).join(",")} /></tr></tfoot></table>;
  }
  act(() => root.render(<Harness />));
  const button = host.querySelector('button[aria-label="Expand Order 20949"]') as HTMLButtonElement;
  expect(button.textContent).toContain("Mixed Materials");
  act(() => button.click());
  expect(host.querySelector('button[aria-label="Collapse Order 20949"]')).not.toBeNull();
  expect(host.querySelector("[data-selected]")?.getAttribute("data-selected")).toBe("");
  const checkbox = host.querySelector('input[aria-label="Select eligible jobs in Order 20949"]') as HTMLInputElement;
  act(() => checkbox.click());
  expect(host.querySelector("[data-selected]")?.getAttribute("data-selected")).toBe("art-a");
  expect(checkbox.checked).toBe(true);
  act(() => checkbox.click());
  expect(host.querySelector("[data-selected]")?.getAttribute("data-selected")).toBe("");
  act(() => root.unmount());
  host.remove();
});

test("group checkbox displays indeterminate for a partial eligible selection", () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(<table><tbody><RollOrderGroupRow group={group} orderNumber="20949" selectableIds={new Set(["art-a", "art-b"])} selectedIds={new Set(["art-a"])} expanded={false} onToggle={() => undefined} onSelectionChange={() => undefined} /></tbody></table>));
  expect(host.querySelector("input")?.getAttribute("data-indeterminate")).toBe("true");
  act(() => root.unmount());
});
