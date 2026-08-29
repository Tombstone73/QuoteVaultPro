import assert from "node:assert/strict";
import { assertDevQaQuoteArtworkProvisioningEnvironment } from "../../../server/lib/devQaQuoteArtworkProvisioningGuard.js";

const dev = {
  PRINTERSHERO_DEV_QA_ARTWORK_PROVISION_ENABLED: "true",
  APP_ENV: "development",
  NODE_ENV: "production",
  RAILWAY_PROJECT_NAME: "PrintersHero-DEV",
  RAILWAY_ENVIRONMENT_NAME: "Development",
  APP_PUBLIC_WEB_ORIGIN: "https://dev.printershero.com",
  DATABASE_URL: "postgresql://dev@ep-wandering-band-aebq1qcx-pooler.c-2.us-east-2.aws.neon.tech/dev",
  SUPABASE_URL: "https://dev.example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-only-placeholder",
} as const;

assert.doesNotThrow(() => assertDevQaQuoteArtworkProvisioningEnvironment(dev));
assert.throws(() => assertDevQaQuoteArtworkProvisioningEnvironment({ ...dev, RAILWAY_PROJECT_NAME: "PrintersHero-PRODUCTION" }), /PrintersHero-DEV/);
assert.throws(() => assertDevQaQuoteArtworkProvisioningEnvironment({ ...dev, APP_PUBLIC_WEB_ORIGIN: "https://printershero.com" }), /dev\.printershero\.com/);
assert.throws(() => assertDevQaQuoteArtworkProvisioningEnvironment({ ...dev, PRINTERSHERO_DEV_QA_ARTWORK_PROVISION_ENABLED: "false" }), /disabled/);
assert.throws(() => assertDevQaQuoteArtworkProvisioningEnvironment({ ...dev, NODE_ENV: "development" }), /deployed DEV runtime/);
console.log("[dev-qa-quote-artwork] deployment guard passed.");
