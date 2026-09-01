import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hasUsableInvoiceRecipientEmail } from "../../shared/invoiceRecipientContact";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("customer invoice recipient controls contract", () => {
  const customerView = source("client/src/features/customers/EnhancedCustomerView.tsx");
  const control = source("client/src/features/customers/InvoiceRecipientContactControl.tsx");
  const routes = source("server/routes/customerRelations.routes.ts");
  const canonicalOperations = source("server/services/customers/canonicalCustomerContactOperations.ts");
  const repository = source("server/storage/customers.repo.ts");
  const invoiceRoutes = source("server/routes/mvpInvoicing.routes.ts");

  test("renders a visible control for each contact and restores canonical isBilling state", () => {
    expect(customerView).toContain("contacts.map((contact)");
    expect(customerView).toContain("<InvoiceRecipientContactControl");
    expect(customerView).toContain("checked={contact.isBilling === true}");
    expect(control).toContain("Receives Invoices");
    expect(repository).toContain("isBilling: link.isBilling");
  });

  test("updates only the selected tenant-scoped customer relationship", () => {
    expect(customerView).toContain("relationshipCustomerId: customer.id");
    expect(customerView).toContain("contactId: contact.id");
    expect(routes).toContain('app.patch("/api/customer-contacts/:id", isAuthenticated, tenantContext');
    expect(routes).toContain("customerId: relationshipCustomerId");
    expect(routes).toContain("isBilling,");
    expect(canonicalOperations).toContain("eq(customerContactLinks.organizationId, input.organizationId)");
    expect(canonicalOperations).toContain("eq(customerContactLinks.id, relationship.id)");
    expect(canonicalOperations).toContain("{ isBilling: input.isBilling }");
  });

  test("does not infer recipients from role or alter portal access", () => {
    expect(canonicalOperations).toContain("...(input.role === undefined ? {} : { role: input.role })");
    expect(canonicalOperations).toContain("...(input.isBilling === undefined ? {} : { isBilling: input.isBilling })");
    expect(canonicalOperations).not.toContain("isPortal: input.isBilling");
    expect(control).not.toContain("role");
  });

  test("rejects enabling delivery without a usable email", () => {
    expect(hasUsableInvoiceRecipientEmail("billing@example.com")).toBe(true);
    expect(hasUsableInvoiceRecipientEmail(" billing@example.com ")).toBe(true);
    expect(hasUsableInvoiceRecipientEmail(null)).toBe(false);
    expect(hasUsableInvoiceRecipientEmail("not-an-email")).toBe(false);
    expect(canonicalOperations).toContain('CanonicalCustomerContactError("CONTACT_EMAIL_REQUIRED"');
    expect(control).toContain("Email required");
  });

  test("keeps multi-recipient expansion and zero-selection fallback in invoice delivery", () => {
    expect(invoiceRoutes).toContain("billingContacts.length > 0");
    expect(invoiceRoutes).toContain("recipientResolution.recipients.length > 1");
    expect(invoiceRoutes).toContain("for (const recipient of recipientResolution.recipients)");
  });
});
