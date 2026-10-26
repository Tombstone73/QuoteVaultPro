type SavedQuote = { sessionId: string; quoteId: string; displayNumber: string | null; quoteNumber: number | null };

/** Add server-verified results to persisted preview cards after a conversation reload. */
export function attachSavedQuoteLinks<T extends { messages: Array<{ structuredCards: any[] }> }>(detail: T, savedRows: SavedQuote[]): T {
  const savedBySession = new Map(savedRows.map((row) => [row.sessionId, { id: row.quoteId, displayNumber: row.displayNumber ?? (row.quoteNumber === null ? "Quote" : String(row.quoteNumber)) }]));
  return { ...detail, messages: detail.messages.map((message) => ({ ...message, structuredCards: message.structuredCards.map((card: any) => {
    if (card.kind !== "quote_intake_summary" || !card.details || typeof card.details !== "object") return card;
    const savedQuote = savedBySession.get(card.details.quoteIntakeSessionId);
    return savedQuote ? { ...card, details: { ...card.details, savedQuote } } : card;
  }) })) };
}
