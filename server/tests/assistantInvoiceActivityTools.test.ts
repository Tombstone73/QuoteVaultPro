import { describe, expect, jest, test } from "@jest/globals";

// The adapter's production defaults use the real tenant services. These unit
// tests inject both dependencies, so prevent module initialization from
// requiring a database URL.
jest.mock("../invoicesService", () => ({ listInvoicesForOrganization: jest.fn() }));
jest.mock("../storage/assistantAnalyticsReporting.repo", () => ({
  AssistantAnalyticsReportingRepository: class {
    async getOrganizationTimezone() { return "UTC"; }
  },
}));

import { createAssistantInvoiceActivityToolAdapters } from "../services/assistant/invoiceActivityTools";
import { createAssistantToolRegistry } from "../services/assistant/toolRegistry";

const context: any = {
  scope: { organizationId: "org_alpha", userId: "user_1" },
  actor: { userId: "user_1", email: "owner@example.test" },
  permissions: ["finance_read"],
  context: { contextVersion: "v1", route: "/invoices", pageTitle: "Invoices", selectedRecordIds: [], activeFilters: [], capturedAt: "2026-08-07T12:00:00.000Z", unsavedChanges: false },
  correlationId: "corr_1",
  signal: new AbortController().signal,
};

function invoice(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `invoice_${index}`,
    invoiceNumber: index,
    displayNumber: `INV-${index}`,
    customerId: "customer_1",
    customerName: "Acme Print",
    status: "partially_paid",
    issuedAt: new Date("2026-08-03T15:00:00.000Z"),
    issueDate: new Date("2026-08-03T15:00:00.000Z"),
    dueDate: new Date("2026-08-20T15:00:00.000Z"),
    totalCents: 12550,
    total: "125.50",
    amountPaid: "25.50",
    balanceDue: "100.00",
    currency: "USD",
    ...overrides,
  } as any;
}

describe("assistant invoice activity tool", () => {
  test("binds analytical invoice facts to the trusted tenant and releases only reduced canonical fields", async () => {
    const listInvoices = jest.fn(async () => [invoice(7)]);
    const adapters = createAssistantInvoiceActivityToolAdapters({
      listInvoices,
      getOrganizationTimezone: async () => "America/New_York",
      now: () => new Date("2026-08-07T16:00:00.000Z"),
    });
    const result = await adapters["analytics.invoice_activity"]!.execute({
      dateRange: { start: "2026-08-01", end: "2026-08-07" },
      limit: 25,
    }, context);

    expect(listInvoices).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org_alpha",
      statuses: ["finalized", "billed", "sent", "partially_paid", "overdue", "paid"],
      limit: 26,
    }));
    expect(result).toMatchObject({
      status: "succeeded",
      data: {
        truncated: false,
        invoices: [{ invoiceId: "invoice_7", totalCents: 12550, amountPaidCents: 2550, balanceDueCents: 10000, sourceLink: { href: "/invoices/invoice_7" } }],
      },
    });
    expect((result.data as any).invoices[0]).not.toHaveProperty("notesInternal");
  });

  test("reports truncation truthfully without releasing more than the tool limit", async () => {
    const adapters = createAssistantInvoiceActivityToolAdapters({
      listInvoices: async () => Array.from({ length: 201 }, (_, index) => invoice(index + 1)),
      getOrganizationTimezone: async () => "UTC",
    });
    const result = await adapters["analytics.invoice_activity"]!.execute({ dateRange: { start: "2026-08-01", end: "2026-08-31" }, limit: 200 }, context);
    expect(result).toMatchObject({ status: "succeeded", data: { truncated: true } });
    expect((result.data as any).invoices).toHaveLength(200);
  });

  test("remains a finance-read, registered semantic tool rather than a dynamic query endpoint", () => {
    const tool = createAssistantToolRegistry().get("analytics.invoice_activity");
    expect(tool).toMatchObject({ requiredPermission: "finance_read", readOnly: true, maxResults: 200, dataClassification: "restricted_finance" });
    expect(() => tool!.inputSchema.parse({ dateRange: { start: "2026-08-01", end: "2026-08-31" }, sql: "select * from invoices" })).toThrow();
    expect(() => tool!.inputSchema.parse({ dateRange: { start: "2026-08-01", end: "2026-08-31" }, organizationId: "other_tenant" })).toThrow();
  });
});
