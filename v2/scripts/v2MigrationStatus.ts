import { configureV2MigrationEnvironment } from "./v2MigrationEnvironment.js";

const main = async (): Promise<void> => {
  configureV2MigrationEnvironment();
  await import("../../scripts/db-status.js");
};

void main().catch((error: unknown) => {
  console.error("[v2:migrations:status] Failed without starting the V2 service.");
  console.error(error instanceof Error ? error.message : "Unknown migration status error.");
  process.exitCode = 1;
});
