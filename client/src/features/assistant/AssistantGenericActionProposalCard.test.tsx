import { toGenericActionProposal } from "./AssistantGenericActionProposalCard";

const fingerprint = "a".repeat(64);

function proposal(action: string) {
  const sessionKey = action.startsWith("customers.") || action.startsWith("contacts.") ? "crmIntakeSessionId"
    : action.startsWith("orders.") || action === "quotes.convert_to_order" ? "orderIntakeSessionId"
      : action.startsWith("production.") ? "productionIntakeSessionId"
        : action.startsWith("fulfillment.") ? "fulfillmentIntakeSessionId"
          : action.startsWith("billing.") ? "billingIntakeSessionId" : "paymentIntakeSessionId";
  return { kind: "action_proposal", title: "Server action", summary: "Only server-supplied preview text.", plan: { action, [sessionKey]: "session_1", proposalFingerprint: fingerprint }, proposal: { action, [sessionKey]: "session_1", proposalFingerprint: fingerprint, turnId: "turn_1" } };
}

describe("generic assistant action proposal adapter", () => {
  test.each([
    "customers.create", "contacts.update", "quotes.convert_to_order", "production.update_job_status", "fulfillment.mark_shipped", "billing.send_invoice", "payments.record_manual_payment",
  ])("accepts the registered %s proposal shape", (action) => {
    const parsed = toGenericActionProposal(proposal(action));
    expect(parsed).toMatchObject({ turnId: "turn_1", command: action, summary: "Only server-supplied preview text." });
  });

  test("rejects unknown, malformed, and dedicated-card proposals", () => {
    expect(toGenericActionProposal(proposal("orders.cancel_everything"))).toBeNull();
    expect(toGenericActionProposal({ ...proposal("customers.create"), proposal: { action: "customers.create", turnId: "turn_1", crmIntakeSessionId: "session_1", proposalFingerprint: "not-a-fingerprint" } })).toBeNull();
    expect(toGenericActionProposal({ kind: "action_proposal", plan: { action: "quotes.add_internal_note" }, proposal: { action: "quotes.add_internal_note", turnId: "turn_1" } })).toBeNull();
    expect(toGenericActionProposal({ kind: "action_proposal", plan: { action: "products.create_inactive_draft" }, proposal: { action: "products.create_inactive_draft", turnId: "turn_1" } })).toBeNull();
  });

  test("uses only related server details for records, parameters, risks, and warnings", () => {
    const card = proposal("customers.update_profile");
    const parsed = toGenericActionProposal(card, [{ kind: "crm_operation_proposal", sourceLinks: [{ label: "Open Acme", href: "/customers/customer_1" }], details: { commandName: "customers.update_profile", summary: "Update Acme's contact preferences.", riskLevel: "high", changes: [{ field: "phone", after: "555-0100" }], warnings: ["Verify the new number."] } }]);
    expect(parsed).toMatchObject({ riskLevel: "high", affectedEntities: [{ label: "Open Acme", href: "/customers/customer_1" }], parameters: [{ label: "phone", value: "555-0100" }], warnings: ["Verify the new number."] });
  });
});
