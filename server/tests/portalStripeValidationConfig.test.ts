import {
  getPortalStripeValidationSafetyErrors,
  parsePortalStripeValidationConfig,
} from "../lib/portalStripeValidationConfig";

describe("portal Stripe validation config", () => {
  test("requires explicit DEV validation flag, password, test Stripe key, and webhook secret", () => {
    const config = parsePortalStripeValidationConfig({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://user:secret@localhost:5432/titanos_dev",
      STRIPE_SECRET_KEY: "sk_test_example",
      STRIPE_PUBLISHABLE_KEY: "pk_test_example",
      PORTAL_TEST_EMAIL: "portal@example.test",
    });

    expect(getPortalStripeValidationSafetyErrors(config)).toEqual(
      expect.arrayContaining([
        "ALLOW_DEV_STRIPE_VALIDATION=1 is required.",
        "PORTAL_TEST_PASSWORD or PLAYWRIGHT_PASSWORD is required.",
        "STRIPE_WEBHOOK_SECRET must be configured with a whsec_ test webhook secret.",
      ]),
    );
  });

  test("refuses production runtime, production database, and live Stripe keys", () => {
    const config = parsePortalStripeValidationConfig({
      NODE_ENV: "production",
      APP_ENV: "production",
      DATABASE_URL: "postgresql://prod_owner:secret@ep-prod-db.us-east-2.aws.neon.tech/prod",
      ALLOW_DEV_STRIPE_VALIDATION: "1",
      STRIPE_SECRET_KEY: "sk_live_example",
      STRIPE_WEBHOOK_SECRET: "whsec_example",
      PORTAL_TEST_PASSWORD: "secret",
    });

    expect(getPortalStripeValidationSafetyErrors(config)).toEqual(
      expect.arrayContaining([
        "Refusing to run when NODE_ENV=production.",
        "Refusing to run against a production-cloud database.",
        "STRIPE_SECRET_KEY must be configured in Stripe test mode.",
      ]),
    );
  });

  test("accepts explicitly enabled non-production test Stripe setup", () => {
    const config = parsePortalStripeValidationConfig({
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://user:secret@localhost:5432/titanos_dev",
      ALLOW_DEV_STRIPE_VALIDATION: "1",
      STRIPE_SECRET_KEY: "sk_test_example",
      STRIPE_WEBHOOK_SECRET: "whsec_example",
      STRIPE_PUBLISHABLE_KEY: "pk_test_example",
      PORTAL_TEST_EMAIL: "portal@example.test",
      PORTAL_TEST_PASSWORD: "secret",
    });

    expect(config.stripeMode).toBe("test");
    expect(config.publishableKeyMode).toBe("test");
    expect(config.canRunStripeApi).toBe(true);
    expect(config.canRunWebhookReplay).toBe(true);
    expect(getPortalStripeValidationSafetyErrors(config)).toEqual([]);
  });
});
