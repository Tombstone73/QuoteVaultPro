import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, jest, test, beforeAll, beforeEach } from "@jest/globals";

const startMutateAsync = jest.fn(async () => ({}));
const statusMutateAsync = jest.fn(async () => ({}));
const createRunMutateAsync = jest.fn(async () => ({}));
const returnToPrepressMutateAsync = jest.fn(async () => ({ restoredItemCount: 1 }));
const assignMachineMutateAsync = jest.fn(async () => ({ updatedItemCount: 1, assignedPrinterName: "Jetson" }));

jest.mock("@/hooks/useProduction", () => ({
  useBulkStartProductionJobs: () => ({ mutateAsync: startMutateAsync, isPending: false }),
  useBulkUpdateProductionJobStatus: () => ({ mutateAsync: statusMutateAsync, isPending: false }),
  useCreateProductionRun: () => ({ mutateAsync: createRunMutateAsync, isPending: false }),
  useReturnProductionJobsToPrepress: () => ({ mutateAsync: returnToPrepressMutateAsync, isPending: false }),
  useBulkAssignProductionPrinter: () => ({ mutateAsync: assignMachineMutateAsync, isPending: false }),
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
}));

jest.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, ...props }: any) => <input type="checkbox" checked={!!checked} onChange={(event) => onCheckedChange(event.target.checked)} {...props} />,
}));

jest.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({ open, children }: any) => open ? <div>{children}</div> : null,
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <h2>{children}</h2>,
  AlertDialogCancel: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
  AlertDialogAction: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
}));

let ProductionBulkActions: typeof import("./ProductionBulkActions").ProductionBulkActions;

beforeAll(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  ({ ProductionBulkActions } = await import("./ProductionBulkActions"));
});

beforeEach(() => {
  startMutateAsync.mockClear();
  statusMutateAsync.mockClear();
  createRunMutateAsync.mockClear();
  returnToPrepressMutateAsync.mockClear();
  assignMachineMutateAsync.mockClear();
});

const jobs = [
  { id: "job-1", lineItemId: "line-1", orderId: "order-1", status: "queued", qty: 12, jobDescription: "Panel A" },
  { id: "job-2", lineItemId: "line-2", orderId: "order-1", status: "queued", qty: 8, jobDescription: "Panel B" },
] as any;

function render(status: "queued" | "in_progress", returnJobs: any[] = [], initialSelected = new Set<string>(), sourceJobs = jobs, visibleJobs = sourceJobs) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  function Harness() {
    const [selected, setSelected] = useState(initialSelected);
    return <ProductionBulkActions station="flatbed" status={status} eligibleJobs={sourceJobs} visibleEligibleJobs={visibleJobs} returnToPrepressEligibleJobs={returnJobs} selectedJobIds={selected} onSelectedJobIdsChange={setSelected} />;
  }
  act(() => root.render(<Harness />));
  return { container, root };
}

function click(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes(label));
  if (!button) throw new Error(`Could not find button ${label}`);
  act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function cleanup(root: Root, container: HTMLElement) {
  act(() => root.unmount());
  container.remove();
}

describe("ProductionBulkActions", () => {
  test("never submits a selected job hidden by the current filter", async () => {
    const view = render("queued", [], new Set(["job-1", "job-2"]), jobs, [jobs[0]]);
    expect(view.container.textContent).toContain("1 selected");
    click(view.container, "Put selected into production");
    click(view.container, "Confirm");
    await act(async () => undefined);
    expect(startMutateAsync).toHaveBeenCalledWith({ station: "flatbed", jobIds: ["job-1"] });
    cleanup(view.root, view.container);
  });

  test("prevents a double submit while the canonical bulk request is pending", async () => {
    let finish!: (value: any) => void;
    startMutateAsync.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = render("queued", [], new Set(["job-1"]));
    click(view.container, "Put selected into production");
    click(view.container, "Confirm");
    click(view.container, "Confirm");
    expect(startMutateAsync).toHaveBeenCalledTimes(1);
    await act(async () => finish({ updatedJobIds: ["job-1"], updatedItemCount: 1 }));
    cleanup(view.root, view.container);
  });

  test("bulk machine suggestions use tenant job choices without appending legacy machines",()=>{
    const view=render("queued",[],new Set(["job-1"]),jobs.map((job:any)=>({...job,printerOptions:["Digitech ST"]})));
    click(view.container,"Assign Machine");
    expect(Array.from(view.container.querySelectorAll("datalist option")).map(option=>option.getAttribute("value"))).toEqual(["Digitech ST"]);
    expect(assignMachineMutateAsync).not.toHaveBeenCalled();cleanup(view.root,view.container);
  });

  test("explicit empty job machine options stay empty in bulk controls",()=>{
    const view=render("queued",[],new Set(["job-1"]),jobs.map((job:any)=>({...job,printerOptions:[]})));
    click(view.container,"Assign Machine");expect(view.container.querySelectorAll("datalist option")).toHaveLength(0);
    expect(assignMachineMutateAsync).not.toHaveBeenCalled();cleanup(view.root,view.container);
  });
  test("selects visible queued Flatbed jobs and submits one bulk start", async () => {
    const view = render("queued");
    const selectAll = view.container.querySelector('input[aria-label="Select all eligible jobs currently visible"]') as HTMLInputElement;
    act(() => selectAll.click());
    expect(view.container.textContent).toContain("2 selected");

    click(view.container, "Put selected into production");
    click(view.container, "Confirm");
    await act(async () => undefined);

    expect(startMutateAsync).toHaveBeenCalledWith({ station: "flatbed", jobIds: ["job-1", "job-2"] });
    expect(view.container.textContent).toContain("0 selected");
    cleanup(view.root, view.container);
  });

  test("uses the bulk status endpoint for active jobs", async () => {
    const view = render("in_progress");
    const selectAll = view.container.querySelector('input[aria-label="Select all eligible jobs currently visible"]') as HTMLInputElement;
    act(() => selectAll.click());
    click(view.container, "Update selected to completed");
    click(view.container, "Confirm");
    await act(async () => undefined);

    expect(statusMutateAsync).toHaveBeenCalledWith({ station: "flatbed", jobIds: ["job-1", "job-2"], status: "done" });
    cleanup(view.root, view.container);
  });

  test("creates a same-order combined production run from selected jobs", async () => {
    const view = render("queued");
    const selectAll = view.container.querySelector('input[aria-label="Select all eligible jobs currently visible"]') as HTMLInputElement;
    act(() => selectAll.click());

    click(view.container, "Create combined run");
    click(view.container, "Create draft run");
    await act(async () => undefined);

    expect(createRunMutateAsync).toHaveBeenCalledWith({
      orderId: "order-1",
      stationKey: "flatbed",
      members: [
        { productionJobId: "job-1", allocatedQuantity: 12 },
        { productionJobId: "job-2", allocatedQuantity: 8 },
      ],
      plannedSheetCount: null,
      nominalPiecesPerSheet: null,
      sheetWidth: null,
      sheetHeight: null,
      notes: null,
      compatibilityOverrideReason: null,
    });
    expect(view.container.textContent).toContain("0 selected");
    cleanup(view.root, view.container);
  });

  test("allows a Return to Prepress-only selection without enabling production grouping", async () => {
    const returnOnlyJob = { id: "job-return", lineItemId: "line-return", orderId: "order-1", status: "queued", qty: 3, jobDescription: "Corrected panel" } as any;
    const view = render("queued", [returnOnlyJob], new Set(["job-return"]));
    expect(view.container.textContent).toContain("1 selected");
    const productionButton = Array.from(view.container.querySelectorAll("button")).find((candidate) => candidate.textContent?.includes("Put selected into production")) as HTMLButtonElement;
    expect(productionButton.disabled).toBe(true);
    click(view.container, "Return Selected to Prepress");
    const confirmButtons = Array.from(view.container.querySelectorAll("button")).filter((candidate) => candidate.textContent?.trim() === "Return to Prepress");
    act(() => confirmButtons[confirmButtons.length - 1].dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => undefined);
    expect(returnToPrepressMutateAsync).toHaveBeenCalledWith({ station: "flatbed", jobIds: ["job-return"], reason: "Re-nesting required" });
    cleanup(view.root, view.container);
  });

  test("assigns one machine through the bulk mutation rather than per-row requests", async () => {
    const view = render("queued");
    const selectAll = view.container.querySelector('input[aria-label="Select all eligible jobs currently visible"]') as HTMLInputElement;
    act(() => selectAll.click());
    click(view.container, "Assign Machine");
    const input = view.container.querySelector('input[aria-label="Printer / Machine"]') as HTMLInputElement;
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(input, "Jetson");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const actions = Array.from(view.container.querySelectorAll("button")).filter((candidate) => candidate.textContent?.trim() === "Assign Machine");
    act(() => actions[actions.length - 1].dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => undefined);
    expect(assignMachineMutateAsync).toHaveBeenCalledWith({ station: "flatbed", jobIds: ["job-1", "job-2"], assignedPrinterId: null, assignedPrinterName: "Jetson" });
    cleanup(view.root, view.container);
  });
});
