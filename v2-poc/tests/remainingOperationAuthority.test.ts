import { describe, expect, test } from "@jest/globals";
import type { Pool } from "pg";

import { PostgresFinancialLifecycleApplication } from "../src/postgres/postgresFinancialLifecycle";
import { PostgresProductionFulfillmentApplication } from "../src/postgres/postgresProductionFulfillment";

const neverConnect = {
  connect: async () => {
    throw new Error("a rejected principal must not open a database connection");
  },
} as unknown as Pool;

const portal = {
  kind: "portal" as const,
  organizationId: "org-a",
  customerId: "customer-a",
  portalSubjectId: "portal-subject-a",
  capabilities: ["fulfillment.pickup", "finance.record"] as const,
};
const service = {
  kind: "service" as const,
  organizationId: "org-a",
  clientId: "scanner-a",
  capabilities: ["fulfillment.pickup", "finance.record"] as const,
};

describe("remaining canonical operation authority boundaries", () => {
  test("portal pickup fails closed even when a caller incorrectly grants the capability", async () => {
    await expect(new PostgresProductionFulfillmentApplication(neverConnect).recordPickupHandoffAs(portal, {
      organizationId: "org-a", orderId: "order-a", lineItemId: "line-a", quantity: 1, requestId: "pickup-a",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("physical and financial writes never turn a portal or service identity into a staff user", async () => {
    const finance = new PostgresFinancialLifecycleApplication(neverConnect);
    await expect(finance.recordPaymentAs(portal, {
      organizationId: "org-a", invoiceId: "invoice-a", requestId: "payment-a", amountCents: 1, method: "cash",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(finance.recordPaymentAs(service, {
      organizationId: "org-a", invoiceId: "invoice-a", requestId: "payment-b", amountCents: 1, method: "cash",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
