import { configureV2MigrationEnvironment } from "./v2MigrationEnvironment.js";

const main = async (): Promise<void> => {
  configureV2MigrationEnvironment();
  const { runMigrations } = await import("../../server/runMigrations.js");
  await runMigrations();
};

void main().catch((error: unknown) => {
  console.error("[v2:migrations:apply] Failed without starting the V2 service.");
  console.error(error instanceof Error ? error.message : "Unknown migration error.");
  process.exitCode = 1;
});
