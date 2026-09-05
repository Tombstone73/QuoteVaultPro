import assert from "node:assert/strict";
import {
  requireV2DeploymentDatabaseUrl,
  requireV2DeploymentTarget,
  V2ConfigurationError,
} from "../../src/config/runtimeConfig.js";

const development = {
  NODE_ENV: "production",
  RAILWAY_PROJECT_NAME: "PrintersHero-DEV",
  RAILWAY_ENVIRONMENT_NAME: "Development",
  DATABASE_URL: "postgresql://development.example/printershero",
};

const production = {
  NODE_ENV: "production",
  RAILWAY_PROJECT_NAME: "PrintersHero-PRODUCTION",
  RAILWAY_ENVIRONMENT_NAME: "production",
  DATABASE_URL: "postgresql://production.example/printershero",
};

assert.equal(requireV2DeploymentTarget(development), "development");
assert.equal(requireV2DeploymentDatabaseUrl(development), development.DATABASE_URL);
assert.equal(requireV2DeploymentTarget(production), "production");
assert.equal(requireV2DeploymentDatabaseUrl(production), production.DATABASE_URL);

for (const invalid of [
  { ...development, RAILWAY_ENVIRONMENT_NAME: "production" },
  { ...production, RAILWAY_ENVIRONMENT_NAME: "Development" },
  { ...development, RAILWAY_PROJECT_NAME: "PrintersHero-PRODUCTION" },
  { ...production, RAILWAY_PROJECT_NAME: "PrintersHero-DEV" },
  { ...development, RAILWAY_PROJECT_NAME: "unknown", RAILWAY_ENVIRONMENT_NAME: "unknown" },
  { ...development, RAILWAY_PROJECT_NAME: undefined },
  { ...production, RAILWAY_ENVIRONMENT_NAME: undefined },
]) {
  assert.throws(
    () => requireV2DeploymentDatabaseUrl(invalid),
    (error: unknown) => error instanceof V2ConfigurationError && /approved Railway project\/environment identity/.test(error.message),
  );
}

assert.throws(
  () => requireV2DeploymentDatabaseUrl({ ...production, DATABASE_URL: "https://database.example/not-postgres" }),
  V2ConfigurationError,
);

console.log("[v2-deployment-environment-guard] passed");
