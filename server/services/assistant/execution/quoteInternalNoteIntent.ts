import type { AssistantContextEnvelope } from "@shared/assistantContracts";

/**
 * This is deliberately a narrow server-side recognizer, not a general write
 * parser.  It may only propose the single Stage 4 quote-note command and the
 * resulting text is still validated by the canonical quote domain service.
 */
export type QuoteInternalNoteIntent =
  | { kind: "resolved"; noteText: string; quoteId?: string; expectedQuoteNumber?: string }
  | { kind: "clarification"; message: string }
  | { kind: "unsupported" };

const MAX_NOTE_LENGTH = 4_000;
const DISALLOWED_MUTATION = /\b(?:customer[-\s]?facing|public|email|price|pricing|quote status|order state|production|invoice|payment|bulk|all quotes|every quote)\b/i;
const NOTE_REQUEST = /\b(?:add|append|put|leave|record)\b[^.]{0,120}\b(?:internal\s+)?note\b/i;
const QUOTE_REFERENCE = /\bquote\s*(?:#|no\.?\s*)?([A-Za-z]*-?\d+)\b/i;

function normalizeNote(value: string): string | null {
  const normalized = value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:that|saying|reading)\s+/i, "")
    .replace(/^[:\-–—]\s*/, "")
    .replace(/^['\"“”]+|['\"“”]+$/g, "")
    .trim();
  return normalized.length > 0 && normalized.length <= MAX_NOTE_LENGTH ? normalized : null;
}

function noteTextFromRequest(message: string): string | null {
  const afterThat = message.match(/\b(?:that|saying|reading)\b\s*[:\-–—]?\s*(.+)$/i)?.[1];
  if (afterThat) return normalizeNote(afterThat);

  const afterColon = message.match(/\b(?:internal\s+)?note\b[^:]{0,100}:\s*(.+)$/i)?.[1];
  if (afterColon) return normalizeNote(afterColon);

  // Accept “add an internal note … customer supplied artwork” only where a
  // quote is already bound by the trusted page context.
  const afterNote = message.match(/\b(?:internal\s+)?note\b(?:\s+(?:to|on|for)\s+(?:this\s+)?quote)?\s+(.+)$/i)?.[1];
  return afterNote ? normalizeNote(afterNote) : null;
}

export function resolveQuoteInternalNoteIntent(message: string, context: AssistantContextEnvelope): QuoteInternalNoteIntent {
  const request = message.trim();
  if (!request || !NOTE_REQUEST.test(request)) return { kind: "unsupported" };
  if (DISALLOWED_MUTATION.test(request)) return { kind: "unsupported" };

  const noteText = noteTextFromRequest(request);
  if (!noteText) {
    return { kind: "clarification", message: "Please provide the internal note text to add." };
  }

  const explicitQuote = request.match(QUOTE_REFERENCE)?.[1];
  const quoteId = context.entityType === "quote" ? context.entityId : undefined;
  if (!quoteId && !explicitQuote) {
    return { kind: "clarification", message: "Please identify the quote for this internal note." };
  }

  return {
    kind: "resolved",
    noteText,
    ...(quoteId ? { quoteId } : {}),
    ...(explicitQuote ? { expectedQuoteNumber: explicitQuote } : {}),
  };
}

export { MAX_NOTE_LENGTH as quoteInternalNoteMaximumLength };
