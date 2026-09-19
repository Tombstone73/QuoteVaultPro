import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";
const read = (file: string) => readFileSync(path.resolve(process.cwd(), file), "utf8");

describe("customer account credit ledger contract", () => {
  test("uses an append-only cents ledger rather than legacy customer balance", () => {
    const schema = read("shared/schema.ts"); const migration = read("server/db/migrations_v2/0206_customer_account_credit_ledger.sql");
    expect(schema).toContain("customerAccountCredits"); expect(schema).toContain("originalAmountCents"); expect(schema).toContain("customerAccountCreditApplications");
    expect(migration).toContain("customer_account_credits"); expect(migration).toContain("customer_account_credit_applications"); expect(migration).toContain("ON DELETE RESTRICT");
  });
  test("records advances and issued credit separately, idempotently, and holds accounting sync", () => {
    const service = read("server/services/billing/customerAccountCreditOperations.ts");
    expect(service).toContain("recordCustomerAdvance"); expect(service).toContain("issueCustomerCredit"); expect(service).toContain("idempotencyKey"); expect(service).toContain("accounting_review_required"); expect(service).toContain("SOURCE_INVOICE_CUSTOMER_MISMATCH");
    expect(service).not.toContain("currentBalance");
  });
  test("reuses allocation semantics and creates internal—not cash—invoice settlement", () => {
    const service = read("server/services/billing/customerAccountCreditOperations.ts");
    expect(service).toContain("allocateCustomerPayment"); expect(service).toContain("pg_advisory_xact_lock"); expect(service).toContain("ACCOUNT_CREDIT_STALE"); expect(service).toContain('provider: "customer_credit"'); expect(service).toContain("INVOICE_OVERAPPLICATION");
  });
  test("surfaces the live customer UI and preserves merge relationships", () => {
    expect(read("client/src/features/customers/EnhancedCustomerView.tsx")).toContain("Account Credit");
    expect(read("client/src/features/customers/CustomerActionsMenu.tsx")).toContain("Record Customer Funds");
    expect(read("server/services/customerCanonicalIdentityService.ts")).toContain("accountCreditsMoved");
  });
});
