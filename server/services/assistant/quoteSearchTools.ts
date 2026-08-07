import { z } from "zod";
import {
  assistantQuoteSearchInputSchema,
  assistantQuoteSearchResultSchema,
} from "@shared/assistantContracts";
import {
  DrizzleAssistantQuoteSearchRepository,
  type AssistantQuoteSearchRepository,
} from "../../storage/assistantQuoteSearch.repo";

export const quoteSearchToolInputSchema = assistantQuoteSearchInputSchema;
export const quoteSearchToolResultSchema = assistantQuoteSearchResultSchema;

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/** Read-only business adapter for tenant-wide quote investigation. The server
 * owns tenant scope, canonical lifecycle filtering, and all record IDs. */
export function createQuoteSearchTool(repository: AssistantQuoteSearchRepository = new DrizzleAssistantQuoteSearchRepository()) {
  return {
    definition: {
      name: "quotes.search",
      version: "v1",
      readOnly: true,
      inputSchema: quoteSearchToolInputSchema,
      resultSchema: quoteSearchToolResultSchema,
      maxResults: 20,
      sourceLinks: "optional",
    },
    async execute(invocation: { scope: { organizationId: string; userId: string } }, rawInput: unknown) {
      const input = quoteSearchToolInputSchema.parse(rawInput);
      const result = await repository.search(invocation.scope.organizationId, input);
      const capturedAt = new Date().toISOString();
      const data = quoteSearchToolResultSchema.parse({
        totalMatchingQuotes: result.totalMatchingQuotes,
        quotes: result.quotes.map((quote) => ({
          ...quote,
          createdAt: toIso(quote.createdAt),
        })),
        appliedFilters: {
          ...(input.lifecycle ? { lifecycle: input.lifecycle } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.customer ? { customer: input.customer } : {}),
          recencyField: "createdAt",
          sentAtAvailable: false,
        },
      });
      return {
        status: "success" as const,
        data,
        // Provenance stays bounded even when a caller requests 20 rows. The
        // complete reduced entity set remains in the validated result data.
        sourceLinks: data.quotes.slice(0, 10).map((quote) => ({
          recordId: quote.quoteId,
          route: quote.sourceLink.href,
          label: quote.sourceLink.label,
          entityType: "quote" as const,
        })),
        freshness: capturedAt,
      };
    },
  };
}
