import { requireV2DeploymentDatabaseUrl } from "../src/config/runtimeConfig.js";

/**
 * The shared migration runner still names its input DATABASE_URL. Set it only
 * inside this short-lived V2 command after validating V2_DATABASE_URL, so the
 * deployed V2 service never falls back to a legacy database.
 */
export const configureV2MigrationEnvironment = (): void => {
  const databaseUrl = requireV2DeploymentDatabaseUrl(process.env);
  process.env.DATABASE_URL = databaseUrl;
  process.env.MIGRATION_DATABASE_URL = databaseUrl;
  delete process.env.DIRECT_DATABASE_URL;
};
