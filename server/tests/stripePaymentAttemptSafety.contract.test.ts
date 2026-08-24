import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";

const source = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8");

describe("Stripe PaymentIntent attempt safety", () => {
  test("staff and portal guard old different-amount pending intents and advance terminal retries", () => {
    const staff = source("server/routes/mvpInvoicing.routes.ts");
    const portal = source("server/services/portal.service.ts");
    expect(staff).toContain("STRIPE_PENDING_AMOUNT_MISMATCH");
    expect(staff).toContain("staff:v2:${terminalAttempts.length + 1}");
    expect(portal).toContain("portal:v2:${terminalAttempts.length + 1}");
    expect(portal).toContain("previous portal payment is still awaiting completion");
  });

  test("all payment paths use the shared fail-closed runtime configuration boundary", () => {
    expect(source("server/routes/stripe.routes.ts")).toContain("STRIPE_MODE_MISMATCH");
    expect(source("server/routes/mvpInvoicing.routes.ts")).toContain("resolveStripeRuntimeConfig(organizationId)");
    expect(source("server/services/portal.service.ts")).toContain("resolveStripeRuntimeConfig(organizationId)");
  });

  test("the browser loads server-authoritative runtime config before requesting an intent", () => {
    const dialog = source("client/src/components/payments/StripePayDialog.tsx");
    expect(dialog).not.toContain("VITE_STRIPE_PUBLISHABLE_KEY");
    expect(dialog).toContain("/payments/stripe/runtime-config");
    expect(dialog.indexOf("/payments/stripe/runtime-config")).toBeLessThan(dialog.indexOf("/payments/stripe/create-intent"));
  });
});
