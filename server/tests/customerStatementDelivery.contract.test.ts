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
});
