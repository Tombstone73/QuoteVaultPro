import { configureV2MigrationEnvironment } from "./v2MigrationEnvironment.js";

const main = async (): Promise<void> => {
  configureV2MigrationEnvironment();
  if (process.env.M77B_DEV_RECONCILIATION === "1") {
    const { runM77BDevSchemaReconciliation } = await import("./runM77BDevSchemaReconciliation.js");
    await runM77BDevSchemaReconciliation();
  }
  const { runMigrations } = await import("../../server/runMigrations.js");
  await runMigrations();
};

void main().catch((error: unknown) => {
  console.error("[v2:migrations:apply] Failed without starting the V2 service.");
  console.error(error instanceof Error ? error.message : "Unknown migration error.");
  process.exitCode = 1;
});
