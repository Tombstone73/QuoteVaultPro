import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { INVOICE_LOGO_MAX_BYTES, INVOICE_LOGO_TOO_LARGE_MESSAGE, INVOICE_LOGO_UNSUPPORTED_TYPE_MESSAGE } from "@shared/companyInfoInvoiceBranding";

(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;

const mockApiRequest = jest.fn();
const mockToast = jest.fn();

jest.mock("@/lib/queryClient", () => ({
  apiRequest: mockApiRequest,
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, id }: { checked?: boolean; id?: string }) => (
    <input id={id} type="checkbox" readOnly checked={checked} />
  ),
}));

const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
const { CompanyInfoInvoiceBrandingCard } = require("./CompanyInfoInvoiceBrandingCard") as typeof import("./CompanyInfoInvoiceBrandingCard");

beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  mockApiRequest.mockClear();
  mockToast.mockClear();
});

afterEach(() => {
  document.body.innerHTML = "";
});

function renderWithCompanySettings(settings: Record<string, unknown>) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: async () => settings },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(["/api/company-settings"], settings);

  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <CompanyInfoInvoiceBrandingCard />
    </QueryClientProvider>,
  );
}

function renderInteractive(settings: Record<string, unknown> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: async () => settings },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(["/api/company-settings"], settings);

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <CompanyInfoInvoiceBrandingCard />
      </QueryClientProvider>,
    );
  });

  return { container, root };
}

function cleanup(root: Root, container: HTMLElement) {
  act(() => root.unmount());
  container.remove();
}

function file(name: string, size: number, type: string): File {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

function attachLogo(container: HTMLElement, selected: File) {
  const input = container.querySelector("input[type='file']") as HTMLInputElement;
  Object.defineProperty(input, "files", { value: [selected], configurable: true });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("CompanyInfoInvoiceBrandingCard", () => {
  it("groups company identity fields separately from invoice payment details", () => {
    const html = renderWithCompanySettings({
      id: "settings_1",
      companyDisplayName: "Acme Print",
      legalCompanyName: "Acme Print LLC",
      phone: "555-0100",
      email: "billing@acme.test",
      website: "https://acme.test",
      physicalAddress: { line1: "1 Shop Way", city: "Dayton", state: "OH" },
      remittanceAddress: { enabled: true, line1: "PO Box 100", city: "Dayton", state: "OH" },
      checksPayableTo: "Acme Print LLC",
      invoicePaymentInstructions: "ACH on request",
      invoiceFooterNote: "Thank you",
    });

    expect(html).toContain("Company Info &amp; Branding");
    expect(html).toContain("Display name");
    expect(html).toContain("Legal name");
    expect(html).toContain("Invoice logo");
    expect(html).toContain("Physical address");
    expect(html).toContain("Invoice &amp; Payment Details");
    expect(html).toContain("Use separate remittance address");
    expect(html).toContain("Checks payable to");
    expect(html).toContain("Payment instructions");
    expect(html).toContain("Invoice footer note");
  });

  it("does not render separate remittance address inputs when disabled", () => {
    const html = renderWithCompanySettings({
      id: "settings_1",
      companyDisplayName: "Acme Print",
      remittanceAddress: { enabled: false, line1: "PO Box 100" },
    });

    expect(html).toContain("Invoice &amp; Payment Details");
    expect(html).toContain("Use separate remittance address");
    expect(html).not.toContain("Send payments to");
    expect(html).not.toContain("PO Box 100");
  });

  it("rejects oversized invoice logos before calling the upload endpoint", () => {
    const { container, root } = renderInteractive({ id: "settings_1" });

    attachLogo(container, file("large-logo.png", INVOICE_LOGO_MAX_BYTES + 1, "image/png"));

    expect(mockApiRequest).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Logo upload rejected",
      description: INVOICE_LOGO_TOO_LARGE_MESSAGE,
      variant: "destructive",
    }));

    cleanup(root, container);
  });

  it("rejects unsupported invoice logo types before calling the upload endpoint", () => {
    const { container, root } = renderInteractive({ id: "settings_1" });

    attachLogo(container, file("logo.gif", 1000, "image/gif"));

    expect(mockApiRequest).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Logo upload rejected",
      description: INVOICE_LOGO_UNSUPPORTED_TYPE_MESSAGE,
      variant: "destructive",
    }));

    cleanup(root, container);
  });
});
