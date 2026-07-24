import { describe, expect, it } from "@jest/globals";
import { assistantProductionCommandAllowlist, createProductionAssistantCommandRegistry } from "../services/assistant/execution/commandRegistry";
import { createPaymentOperationCommandDefinition, createPaymentOperationExecutionCommand, paymentOperationInputSchema } from "../services/assistant/execution/paymentOperationsCommands";
import { paymentOperationCommandNames, PaymentOperationsService } from "../services/assistant/paymentOperationsService";

const fingerprint = "a".repeat(64);
let executedInput: any = null;
const service: any = {
  revalidateProposal: async () => ({ valid: true, proposal: { paymentIntakeSessionId: "payment_1", proposalFingerprint: fingerprint, summary: "Record a manual payment.", sourceLinks: [{ label: "Open invoice", href: "/invoices/invoice_1" }] } }),
  executeConfirmed: async (input: any) => { executedInput = input; return { sourceLinks: [{ label: "Open payment", href: "/invoices/payments/payment_1" }], summary: input.idempotencyKey }; },
};

describe("assistant payment operations commands", () => {
  it("extends the reviewed registry to twenty-eight implemented commands", () => {
    expect(assistantProductionCommandAllowlist).toHaveLength(28);
    expect(assistantProductionCommandAllowlist).toEqual(expect.arrayContaining([...paymentOperationCommandNames]));
    const registry = createProductionAssistantCommandRegistry(...paymentOperationCommandNames.map((name) => createPaymentOperationCommandDefinition(name, service)));
    expect(registry.list().map((item) => item.name).sort()).toEqual([...paymentOperationCommandNames].sort());
    expect(registry.list().every((item) => item.confirmationRequired && item.idempotencyPolicy === "server_generated_with_request_hash")).toBe(true);
  });

  it("uses opaque persisted proposals, passes the server idempotency key, and rejects stale payment proposals", async () => {
    expect(() => paymentOperationInputSchema.parse({ paymentIntakeSessionId: "payment_1", proposalFingerprint: fingerprint, amount: 10 })).toThrow();
    const command = createPaymentOperationExecutionCommand("payments.record_manual_payment", service);
    const scope = { organizationId: "org_1", userId: "user_1", permissions: ["assistant.payments.record_manual_payment"], environment: "test" as const };
    const built = await command.buildPreview({ scope, context: { version: "v1", route: "/invoices", entity: null, selection: [], filters: {}, capturedAt: new Date().toISOString() }, arguments: { paymentIntakeSessionId: "payment_1", proposalFingerprint: fingerprint } });
    expect(built.preview.sideEffects.join(" ")).toContain("No EPS, customer portal, card/ACH processing");
    const plan: any = { id: "plan_1", organizationId: "org_1", userId: "user_1", conversationId: "conversation_1", commandName: "payments.record_manual_payment", commandVersion: "v1", normalizedAction: "payments.record_manual_payment", sanitizedArguments: built.arguments, contextHash: "hash", permissionSnapshot: [], environment: "test", preview: built.preview, affectedRecords: built.preview.affectedRecords, riskLevel: "high", status: "awaiting_confirmation", version: 1, idempotencyKey: "aicmd_00000000-0000-0000-0000-000000000000", correlationId: "corr_1", expiresAt: new Date(), createdAt: new Date(), updatedAt: new Date() };
    await command.execute({ plan, scope });
    expect(executedInput.idempotencyKey).toBe(plan.idempotencyKey);
    service.revalidateProposal = async () => ({ valid: false, code: "PAYMENT_PROPOSAL_STALE", summary: "Changed" });
    await expect(command.revalidate({ plan, scope })).resolves.toEqual({ valid: false, code: "PAYMENT_PROPOSAL_STALE", summary: "Changed" });
  });

  it("does not interpret card or ACH processing as an assistant payment command", async () => {
    const result = await new PaymentOperationsService().respond({ organizationId: "org_1", userId: "user_1", conversationId: "conversation_1", message: "record manual payment for invoice invoice_1 10 via credit card" });
    expect(result.handled).toBe(false);
  });
});
