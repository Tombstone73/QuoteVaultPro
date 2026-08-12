import { readFile } from "node:fs/promises";
import path from "node:path";
import { assistantToolRegistry } from "../services/assistant/toolRegistry";
import { assistantProductionCommandAllowlist } from "../services/assistant/execution/commandRegistry";
import {
  capabilityInventory,
  capabilityInventoryParityValues,
  commandPermissionMetadataGaps,
  knownCapabilityMirrorReadTools,
  knownLegacyCapabilityCatalog,
  knownReadToolNames,
  productParityInventory,
  renderCapabilityInventoryMarkdown,
} from "../services/assistant/capabilityInventory";

describe("AI Operator capability inventory", () => {
  it("uses unique provisional IDs and valid Product parity classifications", () => {
    expect(new Set(capabilityInventory.map((item) => item.id)).size).toBe(capabilityInventory.length);
    for (const item of productParityInventory) {
      expect(capabilityInventoryParityValues).toContain(item.classification);
      expect(item.id.startsWith("products.")).toBe(true);
    }
  });

  it("references registered commands, registered read tools, and traceable source files", async () => {
    const knownCommands = new Set<string>(assistantProductionCommandAllowlist);
    const knownTools = new Set<string>(knownReadToolNames);
    for (const item of capabilityInventory) {
      if (item.commandName) expect(knownCommands.has(item.commandName)).toBe(true);
      if (item.readToolName) expect(knownTools.has(item.readToolName)).toBe(true);
      for (const reference of [item.inputSchemaSource, item.resultContractSource, item.permissionSource, item.tenantScopingSource, item.lifecycleValidationSource, item.canonicalCandidate, item.audit, ...item.routes]) {
        if (!reference || reference === "unknown" || reference === "needs_extraction") continue;
        await expect(readFile(path.resolve(process.cwd(), reference.file), "utf8")).resolves.toEqual(expect.any(String));
      }
    }
  });

  it("keeps known command-permission mirror gaps explicit", () => {
    expect(commandPermissionMetadataGaps).toEqual([]);
  });

  it("keeps the incomplete descriptive mirror out of authority decisions", async () => {
    const source = await readFile(path.resolve(process.cwd(), "server/services/assistant/assistantCapabilities.ts"), "utf8");
    const actualGaps = assistantProductionCommandAllowlist.filter((command) => !source.includes(`"${command}"`));
    expect(actualGaps).toEqual([
      "products.create_inactive_draft_batch",
      "products.adjust_pricing",
      "products.rollback_pricing_change_set",
      "products.create_configurable_draft",
      "products.create_from_canonical_intent",
      "products.clone_to_inactive_draft",
      "products.replace_inactive_matrix",
      "products.replace_inactive_quantity_tiers",
    ]);
    expect(commandPermissionMetadataGaps).toEqual([]);
  });

  it("keeps AI mirrors anchored to known underlying tool or command inventory", () => {
    const tools = new Set<string>(assistantToolRegistry.keys());
    for (const tool of knownCapabilityMirrorReadTools) expect(tools.has(tool)).toBe(true);
    const commands = new Set<string>(assistantProductionCommandAllowlist);
    for (const capability of knownLegacyCapabilityCatalog) {
      for (const command of capability.commandNames) expect(commands.has(command)).toBe(true);
      for (const tool of capability.readToolNames) expect(tools.has(tool)).toBe(true);
    }
  });

  it("keeps the checked-in developer report generated from the inventory", async () => {
    const report = await readFile(path.resolve(process.cwd(), "docs/architecture/ai-operator-capability-inventory.md"), "utf8");
    expect(report).toBe(renderCapabilityInventoryMarkdown());
  });
});
