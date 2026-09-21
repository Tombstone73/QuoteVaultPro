import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("customer statement delivery contract", () => {
  test("freezes a snapshot before queueing a durable statement delivery", () => {
    const route = source("server/routes/customerStatements.routes.ts");
    const queue = source("server/services/invoiceBulkEmailQueue.service.ts");
    const migration = source("server/db/migrations_v2/0208_customer_statement_delivery.sql");
    expect(route).toContain("customerStatementSnapshots");
    expect(route).toContain("enqueueCustomerStatementEmailDelivery");
    expect(route).toContain("registerCanonicalCustomerStatementEmailSender");
    expect(route).toContain("generateCustomerStatementPdfBytes(statement)");
    expect(queue).toContain("deliveryType: \"customer_statement\"");
    expect(queue).toContain("canonicalCustomerStatementEmailSender");
    expect(migration).toContain("customer_statement_snapshots");
    expect(migration).toContain("customer_statement_snapshot_id");
  });

  test("uses canonical accounts-receivable data rather than frontend arithmetic", () => {
    const service = source("server/services/customerStatement.service.ts");
    const client = source("client/src/features/customers/CurrentCustomerStatement.tsx");
    expect(service).toContain("getAccountsReceivableReport");
    expect(service).toContain("getCustomerAccountCreditSummary");
    expect(client).toContain("customer-current-statement");
    expect(client).toContain("Queue Statement Email");
  });

  test("serves a real PDF inline or as an attachment and routes statement requests through the canonical API client", () => {
    const route = source("server/routes/customerStatements.routes.ts");
    const client = source("client/src/features/customers/CurrentCustomerStatement.tsx");
    expect(route).toContain('app.get("/api/customers/:id/current-statement/pdf"');
    expect(route).toContain('res.setHeader("Content-Type", "application/pdf")');
    expect(route).toContain('req.query.download === "1" ? "attachment" : "inline"');
    expect(route).toContain("customerStatementPdfFilename(statement)");
    expect(client).toContain("apiFetch(statementPath");
    expect(client).toContain("openAuthenticatedFile(`${statementPath}/pdf`)");
    expect(client).toContain("downloadAuthenticatedFile(`${statementPath}/pdf?download=1`");
    expect(client).not.toContain('window.open(`/api/customers/${customerId}/current-statement/pdf`');
  });

  test("resolves statement recipients from the same active billing relationship policy as invoices", () => {
    const service = source("server/services/customerStatement.service.ts");
    expect(service).toContain("customerContactLinks");
    expect(service).toContain("buildCustomerStatementRecipients");
    expect(service).toContain("customerContactLinks.isBilling");
    expect(service).not.toContain("customerContacts.isBilling");
  });

  test("persists the operator-confirmed compose fields and sends them from the queue", () => {
    const route = source("server/routes/customerStatements.routes.ts");
    const queue = source("server/services/invoiceBulkEmailQueue.service.ts");
    expect(route).toContain("normalizeExplicitInvoiceRecipientEmails");
    expect(route).toContain("selectedContactIds");
    expect(route).toContain("subject: input.subject");
    expect(queue).toContain("manuallyEnteredRecipients");
    expect(queue).toContain("subject: input.subject");
    expect(queue).toContain("message: input.message");
    expect(queue).toContain("subject: job.metadata?.subject");
  });
});
