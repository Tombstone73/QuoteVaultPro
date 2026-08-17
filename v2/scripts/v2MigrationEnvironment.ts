import { requireV2DeploymentDatabaseUrl } from "../src/config/runtimeConfig.js";

/**
 * The DEV cutover migration runner deliberately uses the canonical DEV
 * DATABASE_URL. The deployment guard verifies the exact Railway DEV context
 * before the existing additive migration runner is allowed to use it.
 */
export const configureV2MigrationEnvironment = (): void => {
  const databaseUrl = requireV2DeploymentDatabaseUrl(process.env);
  process.env.DATABASE_URL = databaseUrl;
  process.env.MIGRATION_DATABASE_URL = databaseUrl;
  delete process.env.DIRECT_DATABASE_URL;
};
