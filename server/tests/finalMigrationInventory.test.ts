import { readFile } from "node:fs/promises";
import path from "node:path";
import { canonicalCapabilityRegistry } from "../services/assistant/canonicalCapabilityRegistry";
import { finalMigrationInventoryRows, renderFinalMigrationInventoryMarkdown } from "../services/assistant/finalMigrationInventory";

describe("final AI Operator migration inventory", () => {
  it("classifies every canonical descriptor and keeps hard-denied/UI-only states explicit", () => {
    const rows = finalMigrationInventoryRows();
    expect(rows.filter((row) => !row.id.startsWith("product.")).length).toBe(canonicalCapabilityRegistry.length);
    expect(rows.some((row) => row.classification === "hard_denied")).toBe(true);
    expect(rows.some((row) => row.classification === "ui_only_reviewed")).toBe(true);
    expect(rows.some((row) => row.classification === "underlying_model_unsupported")).toBe(true);
  });

  it("keeps the checked-in final inventory generated", async () => {
    await expect(readFile(path.resolve(process.cwd(), "docs/architecture/ai-operator-final-migration-inventory.md"), "utf8")).resolves.toBe(renderFinalMigrationInventoryMarkdown());
  });
});
