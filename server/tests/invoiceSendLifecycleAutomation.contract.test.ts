import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@jest/globals";

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

test("direct and bulk invoice delivery share the provider-success lifecycle handler", () => {
  const routes = read("server/routes/mvpInvoicing.routes.ts");
  const queue = read("server/services/invoiceBulkEmailQueue.service.ts");
  const lifecycle = read("server/services/invoiceSendLifecycleAutomation.ts");

  expect(routes).toContain("applyInvoiceSendSuccessLifecycle");
  expect(routes).toContain("await applyInvoiceSendSuccessLifecycle");
  expect(routes).toContain("invoiceForCustomerDelivery");
  expect(routes).toContain("successfulSendCandidateAt");
  expect(routes).toContain("registerCanonicalInvoiceEmailSender(sendInvoiceEmailForOperations)");
  expect(queue).toContain("await canonicalInvoiceEmailSender(");
  expect(lifecycle).toContain("approveInvoicesForAccounting");
  expect(lifecycle).toContain("source: \"invoice_delivery_automation\"");
});

test("organization settings expose normalized default-off automation only through the owner/admin preferences boundary", () => {
  const organizationRoutes = read("server/routes/organization.routes.ts");
  const schema = read("shared/schema.ts");

  expect(organizationRoutes).toContain("resolveInvoiceSendAutomationPreferences(preferences)");
  expect(organizationRoutes).toContain("app.get('/api/organization/preferences', isAuthenticated, tenantContext, requireOrgOwnerAdmin");
  expect(organizationRoutes).toContain("app.put('/api/organization/preferences', isAuthenticated, tenantContext, requireOrgOwnerAdmin");
  expect(schema).toContain("invoiceSendAutomation?:");
});

test("provider failure, queueing, and delivery review cannot invoke send-success automation", () => {
  const routes = read("server/routes/mvpInvoicing.routes.ts");
  const queue = read("server/services/invoiceBulkEmailQueue.service.ts");
  const lifecycleIndex = routes.indexOf("await applyInvoiceSendSuccessLifecycle");
  const deliveryPersistenceIndex = routes.indexOf("logQueueDeliveryStage(\"delivery_persistence_completed\"");

  expect(deliveryPersistenceIndex).toBeGreaterThan(-1);
  expect(lifecycleIndex).toBeGreaterThan(deliveryPersistenceIndex);
  expect(queue).toContain("status: needsReview ? \"needs_review\"");
  expect(queue).toContain("SET status = 'processing'");
});
