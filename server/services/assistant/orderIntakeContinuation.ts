type OrderContinuationMessage = {
  role: string;
  content: string;
  provider?: string | null;
  structuredCards?: unknown[];
};

function requestedOrderInformation(message: OrderContinuationMessage): boolean {
  return message.provider === "local_order_intake"
    && Array.isArray(message.structuredCards)
    && message.structuredCards.some((card) => {
      if (!card || typeof card !== "object") return false;
      const candidate = card as { kind?: unknown; title?: unknown };
      return candidate.kind === "missing_information"
        && (candidate.title === "Order information needed" || candidate.title === "Order pricing information needed");
    });
}

/**
 * Continue only the immediately preceding order intake turn. The caller has
 * already loaded this conversation through its tenant and actor scope; this
 * helper deliberately never searches other conversations or proposals.
 */
export function pendingOrderIntakeRequest(messages: readonly OrderContinuationMessage[]): string | null {
  const lastAssistantIndex = [...messages].map((message) => message.role).lastIndexOf("assistant");
  if (lastAssistantIndex < 1 || !requestedOrderInformation(messages[lastAssistantIndex])) return null;

  for (let index = lastAssistantIndex - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") return messages[index].content;
  }
  return null;
}
