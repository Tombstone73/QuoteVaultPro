import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("V1 payment processor enablement contract", () => {
  test("adds a fail-closed Stripe enablement column and repairs legacy invalid defaults", () => {
    const migration = source("server/db/migrations_v2/0185_payment_processor_enablement.sql");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS stripe_enabled boolean NOT NULL DEFAULT false");
    expect(migration).toContain("provider = 'eps' AND eps_enabled = false");
    expect(migration).toContain("provider = 'stripe'");
  });

  test("the payment-settings API persists enablement and rejects invalid default selections", () => {
    const route = source("server/routes/paymentProvider.routes.ts");
    const service = source("server/services/payments/paymentProvider.service.ts");
    expect(route).toContain("stripeEnabled: z.boolean().optional()");
    expect(service).toContain("stripeEnabled: input.stripeEnabled");
    expect(service).toContain('"STRIPE_NOT_ENABLED"');
    expect(service).toContain('"EPS_NOT_ENABLED"');
    expect(service).toContain("resolveStripeReadiness(organizationId)");
  });

  test("payment routing and disconnect use the same enablement boundary", () => {
    const orchestrator = source("server/services/payments/paymentOrchestrator.service.ts");
    const staff = source("server/routes/mvpInvoicing.routes.ts");
    const portal = source("server/services/portal.service.ts");
    const stripeRoutes = source("server/routes/stripe.routes.ts");
    expect(orchestrator).toContain("settings.stripeEnabled && stripeReadiness.readyForPayments");
    expect(staff).toContain("code: 'STRIPE_NOT_ENABLED'");
    expect(portal).toContain("Stripe is disabled for this organization");
    expect(stripeRoutes).toContain("stripeEnabled: false");
    expect(stripeRoutes).toContain("CASE WHEN");
  });
});
