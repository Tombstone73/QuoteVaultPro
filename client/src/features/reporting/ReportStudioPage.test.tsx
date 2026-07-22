import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ReportDefinition } from "@shared/aiReportingContracts";
import { ReportStudioPage } from "./ReportStudioPage";

jest.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null, XAxis: () => null, YAxis: () => null, Tooltip: () => null, Bar: () => null, Line: () => null,
}));

jest.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SheetContent: ({ children }: { children: React.ReactNode }) => <aside>{children}</aside>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

const definition: ReportDefinition = {
  version: "v1", title: "Customer sales", audience: "private", timezone: "America/New_York", dataSnapshotAt: "2026-07-21T12:00:00.000Z", filters: {}, sources: [{ label: "Finalized invoices", count: 12, freshness: "2026-07-21T12:00:00.000Z" }],
  sections: [{ kind: "narrative", title: "Findings", text: "PVC banners led customer sales." }],
};

function render(props: Partial<React.ComponentProps<typeof ReportStudioPage>> = {}) {
  const container = document.createElement("div"); document.body.appendChild(container); const root = createRoot(container);
  const defaults = { report: { id: "report-1", title: "Customer sales", status: "ready" as const, updatedAt: "2026-07-21T12:00:00.000Z", definition } };
  act(() => root.render(<ReportStudioPage {...defaults} {...props} />));
  return { container, root, ...defaults, ...props };
}

describe("ReportStudioPage", () => {
  beforeAll(() => { (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
  afterEach(() => document.body.replaceChildren());

  it("shows report status, freshness, controlled print action, and report canvas", () => {
    const onPrint = jest.fn(); const view = render({ onPrint });
    expect(view.container.textContent).toContain("Ready");
    expect(view.container.textContent).toContain("Data snapshot");
    const print = Array.from(view.container.querySelectorAll("button")).find((button) => button.textContent?.includes("Print")) as HTMLButtonElement;
    act(() => print.click()); expect(onPrint).toHaveBeenCalledTimes(1);
    expect(view.container.querySelector('[data-testid="report-renderer"]')).toBeTruthy(); act(() => view.root.unmount());
  });

  it("saves only controlled title and description metadata through its callback", async () => {
    const onSaveMetadata = jest.fn(async () => undefined); const view = render({ onSaveMetadata });
    const edit = Array.from(view.container.querySelectorAll("button")).find((button) => button.textContent?.includes("Edit title")) as HTMLButtonElement;
    await act(async () => edit.click());
    const title = view.container.querySelector("#report-title") as HTMLInputElement;
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; valueSetter?.call(title, "Updated customer sales");
    await act(async () => title.dispatchEvent(new Event("input", { bubbles: true })));
    const save = Array.from(view.container.querySelectorAll("button")).find((button) => button.textContent === "Save") as HTMLButtonElement;
    await act(async () => save.click()); expect(onSaveMetadata).toHaveBeenCalledWith({ title: "Updated customer sales", description: "" }); act(() => view.root.unmount());
  });
});
