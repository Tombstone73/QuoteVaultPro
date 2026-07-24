import { describe, expect, it } from "@jest/globals";
import { assistantProductionCommandAllowlist, createProductionAssistantCommandRegistry } from "../services/assistant/execution/commandRegistry";
import { createCrmManagementCommandDefinition, createCrmManagementExecutionCommand } from "../services/assistant/execution/crmManagementCommands";
import { crmCommandNames } from "../services/assistant/crmManagementService";

const fingerprint = "c".repeat(64);
const proposal = { crmIntakeSessionId: "crm_1", commandName: "customers.update_commercial_terms" as const, proposalFingerprint: fingerprint, expectedFingerprint: "record", changes: [{ field: "pricingTier", before: "retail", after: "wholesale" }], warnings: [], duplicateCandidates: [], sourceLinks: [{ label: "Open Acme", href: "/customers/customer_1" }], summary: "pricingTier → wholesale.", downstreamActionsExcluded: ["quote_creation", "order_creation"] };
const service: any = { revalidateProposal: async () => ({ valid: true as const, proposal }), executeConfirmed: async () => ({ id: "customer_1", entityType: "customer", sourceLink: "/customers/customer_1" }) };

describe("assistant CRM management commands", () => {
  it("completes the reviewed thirteen-command production allowlist", () => {
    expect(assistantProductionCommandAllowlist).toHaveLength(13);
    const registry = createProductionAssistantCommandRegistry(...crmCommandNames.map((name) => createCrmManagementCommandDefinition(name, service)));
    expect(registry.list().map((command) => command.name).sort()).toEqual([...crmCommandNames].sort());
    for (const command of registry.list()) {
      expect(command.confirmationRequired).toBe(true);
      expect(command.maxAffectedRecords).toBe(1);
      expect(command.idempotencyPolicy).toBe("server_generated_with_request_hash");
    }
  });

  it("shows commercial snapshot protection and rejects stale proposals", async () => {
    const command = createCrmManagementExecutionCommand("customers.update_commercial_terms", service);
    const built = await command.buildPreview({ scope: { organizationId: "org_1", userId: "user_1", permissions: ["assistant.customers.update_commercial_terms"], environment: "test" }, context: { version: "v1", route: "/customers", entity: null, selection: [], filters: {}, capturedAt: new Date().toISOString() }, arguments: { crmIntakeSessionId: "crm_1", proposalFingerprint: fingerprint } });
    expect(built.preview.summary).toContain("Existing quote, order, and invoice snapshots remain unchanged");
    expect(built.preview.sideEffects.join(" ")).toContain("No quote, order, invoice, payment, production, or fulfillment");
    service.revalidateProposal = async () => ({ valid: false as const, code: "CRM_PROPOSAL_STALE", summary: "Changed" });
    await expect(command.revalidate({ plan: { id: "plan_1", organizationId: "org_1", userId: "user_1", conversationId: "conversation_1", commandName: "customers.update_commercial_terms", commandVersion: "v1", normalizedAction: "customers.update_commercial_terms", sanitizedArguments: { crmIntakeSessionId: "crm_1", proposalFingerprint: fingerprint }, contextHash: "hash", permissionSnapshot: [], environment: "test", preview: built.preview, affectedRecords: built.preview.affectedRecords, riskLevel: "high", status: "awaiting_confirmation", version: 1, idempotencyKey: "aicmd_00000000-0000-0000-0000-000000000000", correlationId: "corr_1", expiresAt: new Date(), createdAt: new Date(), updatedAt: new Date() }, scope: { organizationId: "org_1", userId: "user_1", permissions: [], environment: "test" } })).resolves.toEqual({ valid: false, code: "CRM_PROPOSAL_STALE", summary: "Changed" });
  });
});
