import { describe, expect, it } from "@jest/globals";
import { assistantProductionCommandAllowlist, createProductionAssistantCommandRegistry } from "../services/assistant/execution/commandRegistry";
import { createBillingInvoiceOperationCommandDefinition, createBillingInvoiceOperationExecutionCommand, billingInvoiceOperationInputSchema } from "../services/assistant/execution/billingInvoiceOperationsCommands";
import { billingInvoiceOperationCommandNames } from "../services/assistant/billingInvoiceOperationsService";

const fingerprint = "f".repeat(64);
const service: any = {
  revalidateProposal: async () => ({ valid: true, proposal: { billingIntakeSessionId: "billing_1", proposalFingerprint: fingerprint, summary: "Create eligible invoice.", sourceLinks: [{ label: "Open order", href: "/orders/order_1" }] } }),
  executeConfirmed: async () => ({ sourceLinks: [{ label: "Open invoice", href: "/invoices/invoice_1" }], summary: "Done." }),
};

describe("assistant billing invoice operations commands", () => {
  it("extends the reviewed registry to twenty-eight implemented commands", () => {
    expect(assistantProductionCommandAllowlist).toHaveLength(28);
    const registry = createProductionAssistantCommandRegistry(...billingInvoiceOperationCommandNames.map((name) => createBillingInvoiceOperationCommandDefinition(name, service)));
    expect(registry.list().map((item) => item.name).sort()).toEqual([...billingInvoiceOperationCommandNames].sort());
    expect(registry.list().every((item) => item.confirmationRequired && item.idempotencyPolicy === "server_generated_with_request_hash")).toBe(true);
  });

  it("uses only opaque persisted billing proposal references and revalidates before execution", async () => {
    expect(() => billingInvoiceOperationInputSchema.parse({ billingIntakeSessionId: "billing_1", proposalFingerprint: fingerprint, totalCents: 1 })).toThrow();
    const command = createBillingInvoiceOperationExecutionCommand("billing.create_invoice", service);
    const scope = { organizationId: "org_1", userId: "user_1", permissions: ["assistant.billing.create_invoice"], environment: "test" as const };
    const built = await command.buildPreview({ scope, context: { version: "v1", route: "/invoices", entity: null, selection: [], filters: {}, capturedAt: new Date().toISOString() }, arguments: { billingIntakeSessionId: "billing_1", proposalFingerprint: fingerprint } });
    expect(built.preview.sideEffects.join(" ")).toContain("No payment, paid status");
    service.revalidateProposal = async () => ({ valid: false, code: "BILLING_PROPOSAL_STALE", summary: "Changed" });
    await expect(command.revalidate({ plan: { id: "plan_1", organizationId: "org_1", userId: "user_1", conversationId: "conversation_1", commandName: "billing.create_invoice", commandVersion: "v1", normalizedAction: "billing.create_invoice", sanitizedArguments: built.arguments, contextHash: "hash", permissionSnapshot: [], environment: "test", preview: built.preview, affectedRecords: built.preview.affectedRecords, riskLevel: "high", status: "awaiting_confirmation", version: 1, idempotencyKey: "aicmd_00000000-0000-0000-0000-000000000000", correlationId: "corr_1", expiresAt: new Date(), createdAt: new Date(), updatedAt: new Date() }, scope: { ...scope, permissions: [] } })).resolves.toEqual({ valid: false, code: "BILLING_PROPOSAL_STALE", summary: "Changed" });
  });
});
