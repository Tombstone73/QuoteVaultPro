import { describe, expect, jest, test } from "@jest/globals";
import { createOrderPreparationTools } from "../services/assistant/orderPreparationTools";
import { orderPreparationRequestSchema } from "../services/assistant/orderPreparationContract";
import { generateInboundJson } from "../services/inboundOrders/inboundJsonRecovery";
import { InboundParseDeadline } from "../services/inboundOrders/inboundParseDeadline";
import { AiProviderResponseError } from "../services/ai/providers/AiProviderAdapter";
import { resolveAiJsonMaxTokens } from "../services/ai/providers/configuredProvider";

const context = { scope: { organizationId: "org", userId: "actor" }, actor: { userId: "actor" }, conversationId: "conversation", permissions: ["assistant.orders.create", "assistant.internal_staff"] };
const prepare = jest.fn(async () => ({ handled: true as const, response: "Review before GO", cards: [] }));
const inspect = jest.fn(async () => ({ proposal: null }));
const tool = () => createOrderPreparationTools({ prepareStructuredOrder: prepare, inspectPreparation: inspect }).find(tool => tool.name === "orders.prepare_create")!;

describe("restored conversational Order adapter", () => {
  test("conversation-only multi-line input reaches the existing intake, without a PO or upload", async () => {
    const args = { header: { customerId: "customer", label: "Conversation job", shippingMethod: "pickup" }, lines: { add: [{ productId: "product-a", quantity: 10, width: 15.5, height: 24, optionsText: "double sided contour cut" }, { productId: "product-b", quantity: 25 }] } };
    expect((await tool().execute({ arguments: args, context } as never)).status).toBe("succeeded");
    expect(prepare).toHaveBeenLastCalledWith({ organizationId: "org", userId: "actor", conversationId: "conversation", request: args });
  });
  test("correction requires the actual intake version, never guessed GO authority", () => {
    expect(orderPreparationRequestSchema.safeParse({ sessionId: "session", lines: { update: [{ index: 0, changes: { quantity: 20 } }] } }).success).toBe(false);
    expect(orderPreparationRequestSchema.safeParse({ sessionId: "session", expectedIntakeVersion: "a".repeat(64), lines: { update: [{ index: 0, changes: { quantity: 20 } }] } }).success).toBe(true);
  });
  test("forged tenant, pricing snapshots, workflow states and unknown fields are rejected", async () => {
    for (const args of [{ organizationId: "other" }, { header: { status: "in_production" } }, { lines: { add: [{ productId: "p", quantity: 1, pbv2SnapshotJson: {} }] } }, { lines: { add: [{ quantity: 0 }] } }]) {
      expect((await tool().execute({ arguments: args, context } as never)).status).toBe("rejected");
    }
  });
  test("permissions are checked inside the adapter before preparation", async () => {
    const count = prepare.mock.calls.length;
    expect((await tool().execute({ arguments: {}, context: { ...context, permissions: [] } } as never)).status).toBe("permission_denied");
    expect(prepare).toHaveBeenCalledTimes(count);
  });
  test("PO totals stay separate; EOD uses the canonical semantic contract", () => {
    const parsed = orderPreparationRequestSchema.parse({ customerPoTotalCents: 71825, header: { deadlineJson: { requested: { date: "2026-11-10", kind: "eod", sourceText: "November 10 EOD" }, accepted: null } } });
    expect(parsed.header?.deadlineJson?.requested).toMatchObject({ kind: "eod", instant: null });
    expect(parsed.lines).toBeUndefined();
    expect(orderPreparationRequestSchema.safeParse({ header: { deadlineJson: { requested: { date: "2026-11-10", kind: "eod", localTime: "17:00" } } } }).success).toBe(false);
  });
});

describe("bounded inbound JSON truncation recovery", () => {
  const truncated = () => new AiProviderResponseError({ kind: "truncated_output", message: "length" });
  const request = { orgId: "org", feature: "order_parsing" as const, system: "schema", user: "same evidence", promptVersion: "test", timeoutMs: 1000 };
  const deadline = () => new InboundParseDeadline({ organizationId: "org", inboundRecordId: "request" }, 5000);
  test("one fresh retry raises only Order parsing's output cap, never combines partial JSON", async () => {
    const calls: unknown[] = [];
    const provider = { generateJson: jest.fn(async (input: typeof request) => { calls.push(input); if (calls.length === 1) throw truncated(); return { rawText: '{"complete":true}', provider: "fixture", model: "fixture", requestMetadata: {} }; }) };
    const timer = deadline();
    try {
      const response = await generateInboundJson(provider, request, timer);
      expect(response.rawText).toBe('{"complete":true}');
      expect(calls).toEqual([expect.objectContaining({ maxTokens: 8192, user: "same evidence" }), expect.objectContaining({ maxTokens: 12288, user: "same evidence" })]);
      expect(resolveAiJsonMaxTokens(12288, {}, "order_parsing")).toBe(12288);
      expect(resolveAiJsonMaxTokens(12288, {}, "assistant")).toBe(4096);
    } finally { timer.dispose(); }
  });
  test("second truncation fails visibly and other failures are never retried", async () => {
    for (const error of [truncated(), new Error("provider unavailable")]) {
      const provider = { generateJson: jest.fn(async () => { throw error; }) };
      const timer = deadline();
      try { await expect(generateInboundJson(provider, request, timer)).rejects.toBe(error); expect(provider.generateJson).toHaveBeenCalledTimes(error instanceof AiProviderResponseError ? 2 : 1); }
      finally { timer.dispose(); }
    }
  });
});
