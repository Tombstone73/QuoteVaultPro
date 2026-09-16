import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { useQuery } from "@tanstack/react-query";

const mockToast = jest.fn();
const mockUser = { id: "user-a", lastActiveOrgId: "org-a" };

jest.mock("@tanstack/react-query", () => ({ useQuery: jest.fn() }));
jest.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: mockUser }) }));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: any) => <>{children}</>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
  DialogFooter: ({ children }: any) => <footer>{children}</footer>,
  DialogHeader: ({ children }: any) => <header>{children}</header>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
}));
jest.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled }: any) => <button onClick={onClick} disabled={disabled}>{children}</button>,
}));
jest.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}));
jest.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));
jest.mock("@/components/ui/textarea", () => ({
  Textarea: (props: any) => <textarea {...props} />,
}));
jest.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, ...props }: any) => (
    <input {...props} type="checkbox" checked={checked} onChange={(event) => onCheckedChange(event.target.checked)} />
  ),
}));
jest.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
}));

import { TravelerPrintDialog } from "./TravelerPrintDialog";
import { readPersistedTravelerPrinterPreferences } from "@/lib/travelerPrinterPreferences";

const useQueryMock = jest.mocked(useQuery);
const destinations = [
  { id: "prepress", displayName: "Prepress", location: "RIP", defaultCopies: 2, isDefault: true, available: true },
  { id: "shipping", displayName: "Shipping", location: null, defaultCopies: 1, isDefault: false, available: true },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  localStorage.clear();
  mockToast.mockReset();
  useQueryMock.mockReturnValue({ data: destinations, isLoading: false } as any);
  (globalThis as any).fetch = jest.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { randomUUID: () => "request-key" },
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  jest.clearAllMocks();
});

describe("TravelerPrintDialog", () => {
  test("preserves print fields and saves the selected direct-print profile only after a successful checked print", async () => {
    await act(async () => {
      root.render(<TravelerPrintDialog orderId="order-1" open onOpenChange={() => undefined} />);
      await Promise.resolve();
    });

    const copies = container.querySelector<HTMLInputElement>("#traveler-copies");
    const note = container.querySelector<HTMLTextAreaElement>("#traveler-print-note");
    const checkbox = container.querySelector<HTMLInputElement>("#set-default-traveler-printer");
    expect(copies?.value).toBe("2");
    expect(note).toBeTruthy();

    await act(async () => {
      checkbox?.click();
      copies?.dispatchEvent(new Event("input", { bubbles: true }));
      note!.value = "Ship with proof";
      note!.dispatchEvent(new Event("input", { bubbles: true }));
      container.querySelectorAll("button")[2].click();
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledWith("/api/orders/order-1/direct-print/traveler", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"destinationId":"prepress"'),
    }));
    expect(readPersistedTravelerPrinterPreferences("user-a", "org-a").defaultDestinationId).toBe("prepress");
  });
});
