import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { PrinterProfileForm } from "./PrinterProfileForm";
const save = jest.fn<Promise<any>, [any]>(async () => ({}));
jest.mock("@/hooks/usePrinterProfiles", () => ({ useCreatePrinterProfile: () => ({ isPending: false, mutateAsync: save }), useUpdatePrinterProfile: () => ({ isPending: false, mutateAsync: save }) }));
jest.mock("@/components/ui/button", () => ({ Button: ({ children, variant, ...props }: any) => <button {...props}>{children}</button> }));
jest.mock("@/components/ui/input", () => ({ Input: (props: any) => <input {...props} /> }));
jest.mock("@/components/ui/label", () => ({ Label: (props: any) => <label {...props} /> }));
jest.mock("@/components/ui/switch", () => ({ Switch: ({ checked, disabled, onCheckedChange }: any) => <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onCheckedChange(event.target.checked)} /> }));
jest.mock("@/components/ui/select", () => ({ Select: ({ children }: any) => <div>{children}</div>, SelectContent: ({ children }: any) => <div>{children}</div>, SelectItem: ({ children }: any) => <div>{children}</div>, SelectTrigger: ({ children }: any) => <div>{children}</div>, SelectValue: () => null }));
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
