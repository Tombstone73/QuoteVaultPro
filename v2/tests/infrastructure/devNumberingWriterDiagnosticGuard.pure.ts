import assert from "node:assert/strict";
import {
  DevNumberingWriterDiagnosticEnvironmentError,
  assertDevNumberingWriterDiagnosticEnvironment,
} from "../../../server/lib/devNumberingWriterDiagnosticGuard.js";

const base = {
  APP_ENV: "development",
  NODE_ENV: "production",
  RAILWAY_PROJECT_NAME: "PrintersHero-DEV",
  RAILWAY_ENVIRONMENT_NAME: "Development",
  APP_PUBLIC_WEB_ORIGIN: "https://dev.printershero.com",
  DATABASE_URL: "postgresql://dev_user:ignored@ep-wandering-band-aebq1qcx-pooler.c-2.us-east-2.aws.neon.tech/dev",
} as const;

assert.doesNotThrow(() => assertDevNumberingWriterDiagnosticEnvironment(base));
for (const env of [
  { ...base, APP_PUBLIC_WEB_ORIGIN: "https://printershero.com" },
  { ...base, RAILWAY_PROJECT_NAME: "PrintersHero-PRODUCTION" },
  { ...base, RAILWAY_ENVIRONMENT_NAME: "production" },
  { ...base, APP_ENV: "production" },
  { ...base, DATABASE_URL: "postgresql://prod_user:ignored@production.example.com/prod" },
]) {
  assert.throws(() => assertDevNumberingWriterDiagnosticEnvironment(env), DevNumberingWriterDiagnosticEnvironmentError);
}

console.log("dev numbering writer diagnostic guard pure checks passed");
