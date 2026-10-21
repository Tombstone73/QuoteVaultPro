import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { PrinterProfileForm } from "./PrinterProfileForm";
const save = jest.fn<Promise<any>, [any]>(async () => ({}));
jest.mock("@tanstack/react-query", () => ({ useQuery: () => ({ data: [
  { id: "old-agent", machineLabel: "SHOP-PC", agentVersion: "1.0.25", configuredTravelerPrinterName: "EPSON TM-L90 Liner-Free 1", knownWindowsQueues: [], servesMultipleQueues: false, status: "active", lastSeenAt: "2026-10-19T12:00:00Z" },
  { id: "new-agent", machineLabel: "SHOP-PC", agentVersion: "1.0.28", configuredTravelerPrinterName: "EPSON TM-L90 Liner-Free 1", knownWindowsQueues: ["EPSON TM-L90 Liner-Free 1", "Zebra ZD421"], servesMultipleQueues: true, status: "active", lastSeenAt: "2026-10-20T12:00:00Z" },
  { id: "other-agent", machineLabel: "OTHER-PC", agentVersion: "1.0.24", configuredTravelerPrinterName: "Other queue", knownWindowsQueues: [], servesMultipleQueues: false, status: "active", lastSeenAt: "2026-10-20T12:00:00Z" },
], isError: false }) }));
jest.mock("@/lib/queryClient", () => ({ apiFetch: jest.fn() }));
jest.mock("@/hooks/usePrinterProfiles", () => ({
  PrinterProfileApiError: class extends Error { constructor(message: string, public details: Array<{ path: string[]; message: string }>) { super(message); } },
  useCreatePrinterProfile: () => ({ isPending: false, mutateAsync: save }), useUpdatePrinterProfile: () => ({ isPending: false, mutateAsync: save }),
}));
jest.mock("@/components/ui/button", () => ({ Button: ({ children, variant, ...props }: any) => <button {...props}>{children}</button> }));
jest.mock("@/components/ui/input", () => ({ Input: (props: any) => <input {...props} /> }));
jest.mock("@/components/ui/label", () => ({ Label: (props: any) => <label {...props} /> }));
jest.mock("@/components/ui/switch", () => ({ Switch: ({ checked, disabled, onCheckedChange }: any) => <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onCheckedChange(event.target.checked)} /> }));
jest.mock("@/components/ui/select", () => ({ Select: ({ children, value, onValueChange }: any) => <select value={value} onChange={(event) => onValueChange?.(event.target.value)}>{children}</select>, SelectContent: ({ children }: any) => <>{children}</>, SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>, SelectTrigger: ({ children, "aria-label": label }: any) => <>{label}{children}</>, SelectValue: () => null }));
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; save.mockClear(); });
test.each([[["traveler", "quick_note", "packing_slip", "shipment_manifest", "package_ticket"]], [["packing_slip"]], [["traveler", "quick_note"]]])("saving existing profile safely preserves capabilities %j", async (supportedDocuments) => {
  const container = document.createElement("div"); const root = createRoot(container);
  try {
    await act(async () => { root.render(<PrinterProfileForm profile={{ id: "printer", displayName: "Office", printerType: "office_document", supportedDocuments, isActive: true, defaultCopies: 2 } as any} />); });
    const button = container.querySelector('button[type="submit"]') as HTMLButtonElement; expect(button.disabled).toBe(false);
    await act(async () => { Simulate.submit(container.querySelector("form")!); });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ supportedDocuments }));
  } finally { act(() => root.unmount()); }
});
test("legacy Traveler profile is not silently opted into shipping capabilities", async () => {
  const container = document.createElement("div"); const root = createRoot(container);
  try {
    await act(async () => { root.render(<PrinterProfileForm profile={{ id: "printer", displayName: "Legacy", printerType: "production_ticket", supportedDocuments: ["traveler"] } as any} />); });
    await act(async () => Simulate.submit(container.querySelector("form")!));
    expect(save.mock.calls[0][0].supportedDocuments).toEqual(["traveler"]);
  } finally { act(() => root.unmount()); }
});

test("re-pairing keeps the Epson queue and changes only the selected agent identity", async () => {
  const container = document.createElement("div"); const root = createRoot(container);
  try {
    await act(async () => { root.render(<PrinterProfileForm profile={{ id: "printer", displayName: "Dale's office", printerType: "production_ticket", windowsQueueName: "EPSON TM-L90 Liner-Free 1", printAgentId: "old-agent", supportedDocuments: ["traveler"], isActive: true } as any} />); });
    const agentSelect = Array.from(container.querySelectorAll("select")).find((item) => item.textContent?.includes("1.0.28"))!;
    expect(agentSelect).toBeDefined();
    expect(agentSelect.textContent).toContain("OTHER-PC");
    await act(async () => { Simulate.change(agentSelect, { target: { value: "new-agent" } } as any); });
    await act(async () => { Simulate.submit(container.querySelector("form")!); });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ printAgentId: "new-agent", windowsQueueName: "EPSON TM-L90 Liner-Free 1", supportedDocuments: ["traveler"] }));
  } finally { act(() => root.unmount()); }
});

test("one updated workstation exposes a second Zebra queue without replacing its Epson mapping", async () => {
  const container = document.createElement("div"); const root = createRoot(container);
  try {
    await act(async () => root.render(<PrinterProfileForm defaultType="shipping_label" />));
    const agentSelect = Array.from(container.querySelectorAll("select")).find(item => item.textContent?.includes("1.0.28"))!;
    await act(async () => Simulate.change(agentSelect, { target: { value: "new-agent" } } as any));
    const queueSelect = Array.from(container.querySelectorAll("select")).find(item => item.textContent?.includes("Zebra ZD421"))!;
    expect(queueSelect.textContent).toContain("EPSON TM-L90 Liner-Free 1");
    await act(async () => Simulate.change(queueSelect, { target: { value: "Zebra ZD421" } } as any));
    const name = container.querySelector('input[placeholder="Epson TM-L90 Ticket Printer"]') as HTMLInputElement;
    await act(async () => Simulate.change(name, { target: { value: "Zebra labels" } } as any));
    await act(async () => Simulate.submit(container.querySelector("form")!));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ printAgentId: "new-agent", windowsQueueName: "Zebra ZD421",
      printerType: "shipping_label", supportedDocuments: expect.arrayContaining(["ups_label"]) }));
  } finally { act(() => root.unmount()); }
});

test("a rejected profile save keeps the entered queue and shows the server field error", async () => {
  const container = document.createElement("div"); const root = createRoot(container);
  try {
    const { PrinterProfileApiError } = jest.requireMock("@/hooks/usePrinterProfiles") as { PrinterProfileApiError: new (message: string, details: Array<{ path: string[]; message: string }>) => Error };
    save.mockRejectedValueOnce(new PrinterProfileApiError("Invalid printer profile", [
      { path: ["windowsQueueName"], message: "Choose the paired agent's exact Windows queue." },
    ]));
    await act(async () => root.render(<PrinterProfileForm profile={{ id: "printer", displayName: "Label printer",
      printerType: "shipping_label", windowsQueueName: "Zebra ZP 450-200 dpi", supportedDocuments: ["ups_label"], isActive: true } as any} />));
    await act(async () => Simulate.submit(container.querySelector("form")!));
    expect(container.textContent).toContain("Choose the paired agent's exact Windows queue.");
    expect((Array.from(container.querySelectorAll("input")).find(input => input.value === "Zebra ZP 450-200 dpi") as HTMLInputElement).value)
      .toBe("Zebra ZP 450-200 dpi");
  } finally { act(() => root.unmount()); }
});
