import {
  DEFAULT_PORTAL_TEST_INVOICE_AMOUNT_CENTS,
  getPortalValidationSeedSafetyErrors,
  parsePortalValidationSeedConfig,
} from "../lib/portalValidationSeedConfig";

describe("portal validation seed config", () => {
  test("requires explicit seed flag and password", () => {
    const config = parsePortalValidationSeedConfig({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://user:secret@localhost:5432/titanos_dev",
      PORTAL_TEST_EMAIL: "portal@example.test",
    });

    expect(getPortalValidationSeedSafetyErrors(config)).toEqual(
      expect.arrayContaining(["ALLOW_DEV_PORTAL_SEED=1 is required.", "PORTAL_TEST_PASSWORD is required."]),
    );
  });

  test("refuses production runtime and production database", () => {
    const config = parsePortalValidationSeedConfig({
      NODE_ENV: "production",
      APP_ENV: "production",
      DATABASE_URL: "postgresql://user:secret@prod-db.neon.tech/prod",
      ALLOW_DEV_PORTAL_SEED: "1",
      PORTAL_TEST_EMAIL: "portal@example.test",
      PORTAL_TEST_PASSWORD: "secret",
    });

    expect(getPortalValidationSeedSafetyErrors(config)).toEqual(
      expect.arrayContaining([
        "Refusing to run when NODE_ENV=production.",
        "Refusing to run against a production-cloud database.",
      ]),
    );
  });

  test("builds deterministic ids and invoice defaults", () => {
    const configA = parsePortalValidationSeedConfig({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://user:secret@localhost:5432/titanos_dev",
      ALLOW_DEV_PORTAL_SEED: "1",
      PORTAL_TEST_EMAIL: "portal@example.test",
      PORTAL_TEST_PASSWORD: "secret",
    });
    const configB = parsePortalValidationSeedConfig({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://user:secret@localhost:5432/titanos_dev",
      ALLOW_DEV_PORTAL_SEED: "1",
      PORTAL_TEST_EMAIL: "portal@example.test",
      PORTAL_TEST_PASSWORD: "secret",
    });

    expect(configA.userId).toBe(configB.userId);
    expect(configA.customerId).toBe(configB.customerId);
    expect(configA.invoiceIds.payable).toContain("portal-validation-invoice-payable");
    expect(configA.invoiceAmountCents).toBe(DEFAULT_PORTAL_TEST_INVOICE_AMOUNT_CENTS);
    expect(getPortalValidationSeedSafetyErrors(configA)).toEqual([]);
  });
});

