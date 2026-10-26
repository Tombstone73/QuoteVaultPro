import { describe, expect, test } from "@jest/globals";
import { attachSavedQuoteLinks } from "../services/assistant/savedQuoteConversationLinks";

describe("persisted Quote result links", () => {
  test("only a matching created intake receives its saved Quote identity", () => {
    const detail = { messages: [{ structuredCards: [
      { kind: "quote_intake_summary", details: { quoteIntakeSessionId: "created", totalCents: 2800 } },
      { kind: "quote_intake_summary", details: { quoteIntakeSessionId: "pending", totalCents: 900 } },
      { kind: "action_proposal", plan: { quoteIntakeSessionId: "created" } },
    ] }] };
    const result = attachSavedQuoteLinks(detail, [{ sessionId: "created", quoteId: "quote-1", displayNumber: "1206", quoteNumber: 1206 }]);
    expect(result.messages[0].structuredCards[0].details).toEqual({ quoteIntakeSessionId: "created", totalCents: 2800, savedQuote: { id: "quote-1", displayNumber: "1206" } });
    expect(result.messages[0].structuredCards[1]).toEqual(detail.messages[0].structuredCards[1]);
    expect(result.messages[0].structuredCards[2]).toEqual(detail.messages[0].structuredCards[2]);
    expect(detail.messages[0].structuredCards[0].details).not.toHaveProperty("savedQuote");
  });
});
