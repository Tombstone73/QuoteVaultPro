import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routes = readFileSync(resolve(process.cwd(), "server/routes/mvpInvoicing.routes.ts"), "utf8");
const page = readFileSync(resolve(process.cwd(), "client/src/pages/invoices.tsx"), "utf8");
const toolbar = readFileSync(resolve(process.cwd(), "client/src/components/invoices/InvoiceBulkActions.tsx"), "utf8");
const authority = readFileSync(resolve(process.cwd(), "server/lib/invoiceBulkActionAuthority.ts"), "utf8");

test("bulk payment preview and recording share tenant-scoped payment permission enforcement", () => {
  expect(routes).toMatch(/customer-payment\/preview', isAuthenticated, tenantContext, requireInvoiceBulkAction\('payment'\)/);
  expect(routes).toMatch(/customer-payment', isAuthenticated, tenantContext, requireInvoiceBulkAction\('payment'\)/);
  expect(authority).toContain("membership.is_active = true");
  expect(authority).toContain("permission_set.principal_kind = 'staff'");
  expect(authority).toContain("assignment.organization_id = ${organizationId}");
});

test("bulk delivery, manual sent state, and accounting approval each enforce their operation", () => {
  expect(routes).toContain("requireInvoiceBulkAction('send')");
  expect(routes).toContain("requireInvoiceBulkAction('markSent')");
  expect(routes).toContain("requireInvoiceBulkAction('approve')");
  expect(toolbar).toContain("permissions?.send &&");
  expect(toolbar).toContain("permissions?.markSent &&");
  expect(toolbar).toContain("permissions?.approve &&");
  expect(toolbar).toContain("permissions?.payment &&");
});

test("selection count and existing payment dialog are independent of the Admin/Owner page header gate", () => {
  expect(toolbar).toContain('role="status">{selectedCount} selected');
  expect(page).toContain("<InvoiceBulkActions selectedCount={selectedCount} permissions={bulkPermissions}");
  expect(page).toContain("setCustomerPaymentOpen(true)");
  expect(page).toContain("<MultiInvoicePaymentDialog open={customerPaymentOpen && bulkPermissions?.payment === true}");
  expect(page).toContain("applyVisibleRowSelection");
  expect(page).toContain("invoiceSelectionScope");
});
