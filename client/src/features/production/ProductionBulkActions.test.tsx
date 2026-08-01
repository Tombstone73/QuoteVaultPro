import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, jest, test, beforeAll, beforeEach } from "@jest/globals";

const startMutateAsync = jest.fn(async () => ({}));
const statusMutateAsync = jest.fn(async () => ({}));
const createRunMutateAsync = jest.fn(async () => ({}));
const returnToPrepressMutateAsync = jest.fn(async () => ({ restoredItemCount: 1 }));

jest.mock("@/hooks/useProduction", () => ({
  useBulkStartProductionJobs: () => ({ mutateAsync: startMutateAsync, isPending: false }),
  useBulkUpdateProductionJobStatus: () => ({ mutateAsync: statusMutateAsync, isPending: false }),
  useCreateProductionRun: () => ({ mutateAsync: createRunMutateAsync, isPending: false }),
  useReturnProductionJobsToPrepress: () => ({ mutateAsync: returnToPrepressMutateAsync, isPending: false }),
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
});

const jobs = [
  { id: "job-1", lineItemId: "line-1", orderId: "order-1", status: "queued", qty: 12, jobDescription: "Panel A" },
  { id: "job-2", lineItemId: "line-2", orderId: "order-1", status: "queued", qty: 8, jobDescription: "Panel B" },
] as any;

function render(status: "queued" | "in_progress", returnJobs: any[] = [], initialSelected = new Set<string>()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  function Harness() {
    const [selected, setSelected] = useState(initialSelected);
    return <ProductionBulkActions station="flatbed" status={status} eligibleJobs={jobs} returnToPrepressEligibleJobs={returnJobs} selectedJobIds={selected} onSelectedJobIdsChange={setSelected} />;
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
});
