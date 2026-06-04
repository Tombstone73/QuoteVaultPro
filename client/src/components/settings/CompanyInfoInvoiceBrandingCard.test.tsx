import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { TextDecoder, TextEncoder } from "util";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as any).TextEncoder = TextEncoder;
(globalThis as any).TextDecoder = TextDecoder;

jest.mock("@/lib/queryClient", () => ({
  apiRequest: jest.fn(),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, id }: { checked?: boolean; id?: string }) => (
    <input id={id} type="checkbox" readOnly checked={checked} />
  ),
}));

const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
const { CompanyInfoInvoiceBrandingCard } = require("./CompanyInfoInvoiceBrandingCard") as typeof import("./CompanyInfoInvoiceBrandingCard");

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
});
