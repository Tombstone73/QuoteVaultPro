import { expect, jest, test } from "@jest/globals";
import { assistantContextEnvelopeSchema } from "@shared/assistantContracts";
import { createProductionCompletionTool } from "../services/assistant/productionCompletionTool";
import type { previewReviewedProductionCompletion } from "../services/reviewedProductionCompletion";

const scope = { organizationId: "org", actorUserId: "staff", orderId: "order_a", lineItemId: "line_b" };
const preview = jest.fn<typeof previewReviewedProductionCompletion>();
const page = assistantContextEnvelopeSchema.parse({ contextVersion: "v1", entityType: "order", entityId: scope.orderId, route: "/orders/order_a", displayedOrderLineIds: ["line_c", "line_b"], pageTitle: "Order", capturedAt: new Date().toISOString(), unsavedChanges: false });
const permissions = ["assistant.internal_staff", "assistant.production.update_job_status"];
const invoke = (goal: string, args: Record<string, unknown>, grants = permissions) => createProductionCompletionTool(preview).execute({ arguments: args, context: { goal, context: page, permissions: grants, scope: { organizationId: "org", userId: "staff" }, actor: { userId: "staff", email: null }, conversationId: "conversation", correlationId: "turn" } });

test.each(["Mark everything complete and boxed.", "Set line 2 ready to 50.", "Is line 2 production complete?", "Do not mark line 2 production complete.", "Mark line 2 production complete and ship it.", "Mark line 3 production complete."])("does not prepare a job for %s", async prompt => {
  expect((await invoke(prompt, { lineNumber: 2 })).status).toBe("rejected");
  expect(preview).not.toHaveBeenCalled();
});
test("no native lookup for wrong authority or caller-supplied job identity", async () => {
  expect((await invoke("Mark line 2 production complete.", { lineNumber: 2 }, [])).status).toBe("permission_denied");
  expect((await invoke("Mark line 2 production complete.", { jobId: "guessed", lineNumber: 2 })).status).toBe("rejected");
  expect(preview).not.toHaveBeenCalled();
});
test.each(["Mark line 2 production complete.", "Mark the production job for line 2 complete."])("binds displayed row to its native review for %s", async prompt => {
  preview.mockRejectedValueOnce(new Error("native review unavailable"));
  const call = await invoke(prompt, { lineNumber: 2 });
  expect(preview).toHaveBeenLastCalledWith(scope);
  expect(call.status).toBe("rejected"); expect(call.presentation).toBeUndefined();
});

test("returns the server-reviewed job in a GO proposal, never a completion receipt", async () => {
  const review = { version: "v1" as const, scope, jobId: "job_27", revision: "a".repeat(64),
    state: { jobStatus: "in_progress" as const, stationKey: "roll", stepKey: "print", startedAt: new Date().toISOString(), orderState: "open", orderStatus: "in_production", lineWorkflowState: "in_production", lineStatus: "open" },
    route: { stationKey: "fulfillment", stepKey: "queued", source: "step_trigger" as const } };
  preview.mockResolvedValueOnce(review);
  const outcome = await invoke("Mark line 2 production complete.", { lineNumber: 2 });
  expect(outcome.presentation?.cards[0]).toMatchObject({ kind: "action_proposal", summary: expect.stringContaining("Nothing has been submitted"), plan: { action: "production.complete_job", arguments: { preview: review } } });
});
