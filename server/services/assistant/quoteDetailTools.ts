import {
  assistantQuoteDetailInputSchema,
  assistantQuoteDetailResultSchema,
} from "@shared/assistantContracts";
import { getEffectiveWorkflowState } from "@shared/quoteWorkflow";
import { QuotesRepository } from "../../storage/quotes.repo";

export type AssistantQuoteDetailRepository = Pick<QuotesRepository, "getQuoteById" | "getRelatedOrderForQuote">;

function iso(value: Date | string): string { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
function number(value: unknown): number | undefined { const parsed = Number(value); return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined; }
function displayQuoteNumber(quote: { displayNumber: string | null; numberCore: number | null; quoteNumber: number | null }) {
  return quote.displayNumber ?? (quote.numberCore ?? quote.quoteNumber ? String(quote.numberCore ?? quote.quoteNumber) : "Unnumbered");
}

/** Reduced read adapter over the existing canonical quote repository.  It does
 * not expose quote persistence shape or reconstruct relationships by name. */
export function createQuoteDetailTool(repository: AssistantQuoteDetailRepository = new QuotesRepository()) {
  return {
    async execute(invocation: { scope: { organizationId: string; userId: string } }, rawInput: unknown) {
      const input = assistantQuoteDetailInputSchema.parse(rawInput);
      const quote = await repository.getQuoteById(invocation.scope.organizationId, input.quoteId);
      if (!quote) return { status: "not_found" as const, data: null, sourceLinks: [] as const, freshness: new Date().toISOString() };
      const relatedOrder = await repository.getRelatedOrderForQuote(invocation.scope.organizationId, quote.id);
      const capturedAt = new Date().toISOString();
      const quoteNumber = displayQuoteNumber(quote);
      const converted = Boolean(relatedOrder);
      const customerName = quote.customer?.companyName ?? quote.customerName ?? "Unassigned customer";
      const contactName = [quote.contact?.firstName, quote.contact?.lastName].filter((part): part is string => Boolean(part?.trim())).join(" ");
      const lineItems = quote.lineItems.slice(0, 50).map((line) => {
        const dimensions = number(line.width) && number(line.height) ? { widthInches: number(line.width)!, heightInches: number(line.height)! } : undefined;
        const options = Array.isArray(line.selectedOptions)
          ? line.selectedOptions.slice(0, 12).flatMap((option) => option?.optionName && option.value != null ? [`${option.optionName}: ${String(option.value)}`] : [])
          : [];
        return {
          id: line.id,
          description: line.description?.trim() || line.productName,
          ...(line.productName ? { productName: line.productName } : {}),
          quantity: line.quantity,
          ...(dimensions ? { dimensions } : {}),
          ...(options.length ? { options } : {}),
        };
      });
      const data = assistantQuoteDetailResultSchema.parse({
        quote: { entityType: "quote", recordId: quote.id, label: `Quote ${quoteNumber}`, status: getEffectiveWorkflowState(quote.status, quote.validUntil ?? null, converted), sourceLink: { label: `Quote ${quoteNumber}`, href: `/quotes/${quote.id}`, entityType: "quote", entityId: quote.id, capturedAt }, freshness: iso(quote.createdAt) },
        ...(quote.customer ? { customer: { entityType: "customer", recordId: quote.customer.id, label: customerName, sourceLink: { label: customerName, href: `/customers/${quote.customer.id}`, entityType: "customer", entityId: quote.customer.id, capturedAt }, freshness: capturedAt } } : {}),
        ...(contactName ? { contact: { name: contactName, ...(quote.contact?.email ? { email: quote.contact.email } : {}), ...(quote.contact?.phone ? { phone: quote.contact.phone } : {}) } } : {}),
        total: Number(quote.totalPrice),
        status: getEffectiveWorkflowState(quote.status, quote.validUntil ?? null, converted),
        lineItems,
        relatedOrder: relatedOrder
          ? { state: "linked", order: { entityType: "order", recordId: relatedOrder.id, label: `Order ${relatedOrder.displayNumber ?? relatedOrder.orderNumber}`, sourceLink: { label: `Order ${relatedOrder.displayNumber ?? relatedOrder.orderNumber}`, href: `/orders/${relatedOrder.id}`, entityType: "order", entityId: relatedOrder.id, capturedAt }, freshness: capturedAt } }
          : { state: "none" },
      });
      return { status: "success" as const, data, sourceLinks: [data.quote.sourceLink, ...(data.customer ? [data.customer.sourceLink] : []), ...(data.relatedOrder.state === "linked" ? [data.relatedOrder.order.sourceLink] : [])], freshness: capturedAt };
    },
  };
}
