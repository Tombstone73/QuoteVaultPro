import { expect, jest, test } from "@jest/globals";
import { assistantContextEnvelopeSchema } from "@shared/assistantContracts";
import { createPhysicalReadinessTool } from "../services/assistant/physicalReadinessTool";
import type { readOrderFulfillmentReadiness } from "../services/assistant/orderFulfillmentReadinessRead";
import type { previewPhysicalReadinessAdjustment } from "../services/assistant/physicalReadinessAdjustment";

const orderId = "30000000-0000-4000-8000-000000000001";
const page = assistantContextEnvelopeSchema.parse({ contextVersion: "v1", entityType: "order", entityId: orderId, route: `/fulfillment/orders/${orderId}`, displayedFulfillmentLineIds: ["other-line", "selected-line"], pageTitle: "Fulfillment", capturedAt: new Date().toISOString(), unsavedChanges: false });
const reason = "piece count verified";
const args = { quantity: 5, lineNumber: 2, mode: "target", reason };
const read = jest.fn<typeof readOrderFulfillmentReadiness>();
const preview = jest.fn<typeof previewPhysicalReadinessAdjustment>();
function prepare(goal: string, input: Record<string, unknown> = args, context = page) {
  return createPhysicalReadinessTool(read, preview).execute({ arguments: input, context: { goal, context, permissions: ["assistant.internal_staff", "assistant.fulfillment.add_note"], scope: { organizationId: "org", userId: "actor" }, actor: { userId: "actor", email: null }, conversationId: "conversation", correlationId: "turn" } });
}
test.each([
  ["Is line 2 ready? Do not override anything.", args],
  ["Set line 2 ready to 5", { ...args, reason: "Set line 2 ready to 5" }],
  [`Increase line 2 unready quantity by 5 because ${reason}`, { ...args, mode: "delta" }],
  [`Set line 2 ready to 5; don\u2019t apply it because ${reason}`, args],
  [`Set line 2 ready to 3 because ${reason}`, args],
  [`Set line 1 ready to 5 because ${reason}`, args],
  [`Set line 2 ready to 5 because ${reason}`, { ...args, mode: "delta" }],
  [`Remove 5 ready units from line 2 because ${reason}`, { ...args, mode: "delta" }],
  [`Set line 2 ready to 5 on order ABC because ${reason}`, args],
  [`Mark line 2 production complete. All 5 pieces are finished because ${reason}`, args],
  [`Set line 2 ready to 5 because ${reason}`, { ...args, reason: "made up reason" }],
] as Array<[string, typeof args]>)("clarifies inconsistent/ambiguous intent: %s", async (text, supplied) => {
  expect((await prepare(text, supplied)).status).toBe("rejected"); expect(read).not.toHaveBeenCalled();
});

test.each([false, true])("review uses displayed ID rather than native query order, with explicit override=%s", async override => {
  // Only the consumed fields of the M2 native projection are material to this test.
  read.mockResolvedValueOnce({ status: "available", operationAuthority: { canConfirmPhysicalReadiness: true }, navigation: { fulfillment: page.route }, lines: [{ id: "selected-line", productName: "Fixture", quantities: { readyWaitingQuantity: 2 } }] } as Awaited<ReturnType<typeof readOrderFulfillmentReadiness>>);
  preview.mockImplementationOnce(async (scope, input) => ({ scope, input, expectedReadyQuantity: 2, productionCompleteQuantity: 0, nativeStatus: "in_progress", organizationRole: "employee", limitation: "Physical quantity confirmation/correction only. Production jobs stay open; this does not complete production, ship, hand off pickup, notify customers, or invoice." }));
  const result = await prepare(override ? "Override line 2 ready to 5" : `Set line 2 ready to 5 because ${reason}`, override ? { ...args, reason: undefined } : args);
  expect(result.status).toBe("succeeded"); expect(result.presentation?.cards[0]).toMatchObject({ summary: expect.stringContaining("2 to 5 (+3)") });
  expect(preview).toHaveBeenLastCalledWith({ organizationId: "org", userId: "actor", orderId }, { orderLineItemId: "selected-line", quantityDelta: 3, reason: override ? "AI Override" : reason });
});
