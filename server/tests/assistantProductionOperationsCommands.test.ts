import { describe, expect, it } from "@jest/globals";
import { assistantProductionCommandAllowlist, createProductionAssistantCommandRegistry } from "../services/assistant/execution/commandRegistry";
import { createProductionOperationCommandDefinition, createProductionOperationExecutionCommand, productionOperationInputSchema } from "../services/assistant/execution/productionOperationsCommands";
import { productionOperationCommandNames } from "../services/assistant/productionOperationsService";

const fingerprint = "d".repeat(64);
const service: any = { revalidateProposal: async () => ({ valid: true, proposal: { productionIntakeSessionId: "production_1", proposalFingerprint: fingerprint, summary: "Route selected line item.", sourceLinks: [{ label: "Open order", href: "/orders/order_1" }] } }), executeConfirmed: async () => ({ sourceLinks: [], summary: "Routed." }) };
describe("assistant production operations commands", () => {
  it("registers exactly four confirmation-bound production operations for the final seventeen-command allowlist", () => {
    expect(assistantProductionCommandAllowlist).toHaveLength(17);
    const registry = createProductionAssistantCommandRegistry(...productionOperationCommandNames.map((name) => createProductionOperationCommandDefinition(name, service)));
    expect(registry.list().map((command) => command.name).sort()).toEqual([...productionOperationCommandNames].sort());
    expect(registry.list().every((command) => command.confirmationRequired && command.idempotencyPolicy === "server_generated_with_request_hash")).toBe(true);
  });
  it("accepts only opaque persisted proposal references and revalidates before execution", async () => {
    expect(() => productionOperationInputSchema.parse({ productionIntakeSessionId: "production_1", proposalFingerprint: fingerprint, stationKey: "print" })).toThrow();
    const command = createProductionOperationExecutionCommand("production.intake_line_items", service);
    const preview = await command.buildPreview({ scope: { organizationId: "org_1", userId: "user_1", permissions: ["assistant.production.intake_line_items"], environment: "test" }, context: { version: "v1", route: "/production", entity: null, selection: [], filters: {}, capturedAt: new Date().toISOString() }, arguments: { productionIntakeSessionId: "production_1", proposalFingerprint: fingerprint } });
    expect(preview.preview.sideEffects.join(" ")).toContain("No fulfillment");
    service.revalidateProposal = async () => ({ valid: false, code: "PRODUCTION_PROPOSAL_STALE", summary: "Changed" });
    await expect(command.revalidate({ plan: { id: "plan_1", organizationId: "org_1", userId: "user_1", conversationId: "conversation_1", commandName: "production.intake_line_items", commandVersion: "v1", normalizedAction: "production.intake_line_items", sanitizedArguments: preview.arguments, contextHash: "hash", permissionSnapshot: [], environment: "test", preview: preview.preview, affectedRecords: preview.preview.affectedRecords, riskLevel: "high", status: "awaiting_confirmation", version: 1, idempotencyKey: "aicmd_00000000-0000-0000-0000-000000000000", correlationId: "corr_1", expiresAt: new Date(), createdAt: new Date(), updatedAt: new Date() }, scope: { organizationId: "org_1", userId: "user_1", permissions: [], environment: "test" } })).resolves.toEqual({ valid: false, code: "PRODUCTION_PROPOSAL_STALE", summary: "Changed" });
  });
});
