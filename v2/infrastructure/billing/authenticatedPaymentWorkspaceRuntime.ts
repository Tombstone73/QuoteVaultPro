import type { Pool } from "pg";
import type { PaymentWorkspaceHttpDependencies } from "../../src/interfaces/http/paymentWorkspaceRoutes.js";
import { PaymentWorkspaceApplicationService } from "../../src/modules/billing/paymentWorkspace.js";
import type { BillingPaymentsApplicationService } from "../../src/modules/billing/paymentApplication.js";
import { PostgresPaymentWorkspaceReadRunner } from "./postgresPaymentWorkspace.js";

/** Reuses the authenticated Billing runtime's Principal provider and payment owner. */
export function createPaymentWorkspaceDependencies(input: Readonly<{
  pool: Pool;
  principals: PaymentWorkspaceHttpDependencies["principals"];
  payments: Pick<BillingPaymentsApplicationService, "recordManualPaymentAllocations">;
  requireCsrf: PaymentWorkspaceHttpDependencies["requireCsrf"];
}>): PaymentWorkspaceHttpDependencies {
  return {
    service: new PaymentWorkspaceApplicationService(new PostgresPaymentWorkspaceReadRunner(input.pool), input.payments),
    principals: input.principals,
    requireCsrf: input.requireCsrf,
  };
}
