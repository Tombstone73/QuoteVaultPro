import {
  assistantCustomerSummaryInputSchema,
  assistantCustomerSummaryResultSchema,
  assistantEntitySummarySchema,
  assistantGlobalSearchInputSchema,
  assistantGlobalSearchResultSchema,
  assistantQuoteSearchInputSchema,
  assistantQuoteSearchResultSchema,
  assistantQuoteDetailInputSchema,
  assistantQuoteDetailResultSchema,
  type AssistantSourceLink,
  type AssistantToolResultEnvelope,
} from "@shared/assistantContracts";
import { createCustomerSummaryTool, createSearchGlobalTool, customerSummaryToolResultSchema } from "./searchCustomerTools";
import { createQuoteSearchTool } from "./quoteSearchTools";
import { createQuoteDetailTool } from "./quoteDetailTools";
import { createStage2OrderProductToolAdapters } from "./orderProductOperationalTools";
import { createAssistantProductionReportingToolAdapters } from "./productionReportingTools";
import { createAssistantAnalyticsReportingToolAdapters } from "./analyticsReportingTools";
import { createAssistantOrderDueSummaryToolAdapters } from "./orderDueSummaryTools";
import { createAssistantCompletedJobReportingToolAdapters } from "./completedJobReportingTools";
import type { AssistantToolAdapters, AssistantTrustedToolContext } from "./toolRegistry";

const entityTypes = new Set(["customer", "contact", "order", "quote", "product", "invoice", "production_job"]);

function sourceLink(record: { recordId: string; route: string; label: string }, entityType?: string, capturedAt?: string): AssistantSourceLink {
  return {
    label: record.label,
    href: record.route,
    ...(entityType && entityTypes.has(entityType) ? { entityType: entityType as AssistantSourceLink["entityType"] } : {}),
    entityId: record.recordId,
    ...(capturedAt ? { capturedAt } : {}),
  };
}

function contextForLegacyAdapter(context: AssistantTrustedToolContext) {
  return {
    scope: context.scope,
    correlationId: context.correlationId,
    context: context.context,
    signal: context.signal,
  };
}

/**
 * Bridges independently implemented read tools to the single registry
 * envelope. The bridge only reshapes already-reduced DTOs; it never supplies
 * tenant, actor, permission, URL, or arbitrary query data.
 */
export function createStage2AssistantToolAdapters(): AssistantToolAdapters {
  const search = createSearchGlobalTool();
  const customer = createCustomerSummaryTool();
  const quoteSearch = createQuoteSearchTool();
  const quoteDetail = createQuoteDetailTool();
  return {
    ...createStage2OrderProductToolAdapters(),
    ...createAssistantProductionReportingToolAdapters(),
    ...createAssistantOrderDueSummaryToolAdapters(),
    ...createAssistantCompletedJobReportingToolAdapters(),
    ...createAssistantAnalyticsReportingToolAdapters(),
    "search.global": {
      async execute(rawInput, context): Promise<AssistantToolResultEnvelope> {
        const input = assistantGlobalSearchInputSchema.parse(rawInput);
        const result = await search.execute(contextForLegacyAdapter(context), {
          query: input.query,
          maxResultsPerCategory: Math.min(5, input.limit ?? 5),
          ...(input.entityType ? { entityType: input.entityType } : {}),
        });
        const matches = result.data.results.map((record) => assistantEntitySummarySchema.parse({
          entityType: record.entityType,
          recordId: record.recordId,
          label: record.displayLabel,
          ...(record.secondaryDescription ? { secondaryDescription: record.secondaryDescription } : {}),
          ...(record.status ? { status: record.status } : {}),
          sourceLink: sourceLink({ recordId: record.recordId, route: record.route, label: record.displayLabel }, record.entityType, record.freshness),
          freshness: record.freshness,
        }));
        const data = assistantGlobalSearchResultSchema.parse({ matches });
        return {
          status: "succeeded",
          data,
          provenance: {
            sourceLinks: matches.slice(0, 10).map((match) => match.sourceLink),
            freshness: { capturedAt: result.freshness },
          },
        };
      },
    },
    "quotes.search": {
      async execute(rawInput, context): Promise<AssistantToolResultEnvelope> {
        const input = assistantQuoteSearchInputSchema.parse(rawInput);
        const result = await quoteSearch.execute(contextForLegacyAdapter(context), input);
        const data = assistantQuoteSearchResultSchema.parse(result.data);
        return {
          status: "succeeded",
          data,
          provenance: {
            sourceLinks: result.sourceLinks.map((link) => sourceLink(link, link.entityType, result.freshness)),
            freshness: { capturedAt: result.freshness },
          },
        };
      },
    },
    "quotes.get_detail": {
      async execute(rawInput, context): Promise<AssistantToolResultEnvelope> {
        const input = assistantQuoteDetailInputSchema.parse(rawInput);
        const result = await quoteDetail.execute(contextForLegacyAdapter(context), input);
        if (result.status === "not_found") return { status: "not_found", data: null };
        const data = assistantQuoteDetailResultSchema.parse(result.data);
        return { status: "succeeded", data, provenance: { sourceLinks: result.sourceLinks.map((link) => ({ ...link, capturedAt: result.freshness })), freshness: { capturedAt: result.freshness } } };
      },
    },
    "customers.get_summary": {
      async execute(rawInput, context): Promise<AssistantToolResultEnvelope> {
        const input = assistantCustomerSummaryInputSchema.parse(rawInput);
        const result = await customer.execute(contextForLegacyAdapter(context), input);
        if (result.status === "not_found") return { status: "not_found", data: null };
        const record = customerSummaryToolResultSchema.parse(result.data);
        const customerSummary = assistantEntitySummarySchema.parse({
          entityType: "customer",
          recordId: record.customer.id,
          label: record.customer.companyName,
          ...(record.customer.status ? { status: record.customer.status } : {}),
          sourceLink: sourceLink({ recordId: record.customer.id, route: record.customer.route, label: record.customer.companyName }, "customer", record.customer.freshness),
          freshness: record.customer.freshness,
        });
        const recentRecords = record.recentActivity.map((activity) => assistantEntitySummarySchema.parse({
          entityType: activity.kind,
          recordId: activity.id,
          label: activity.displayNumber,
          status: activity.status,
          sourceLink: sourceLink({ recordId: activity.id, route: activity.route, label: activity.displayNumber }, activity.kind, activity.freshness),
          freshness: activity.freshness,
        }));
        const data = assistantCustomerSummaryResultSchema.parse({
          customer: customerSummary,
          ...(record.customer.isActive !== null ? { active: record.customer.isActive } : {}),
          ...(record.contacts.length ? { contactSummary: record.contacts.map((contact) => ({
            name: contact.name,
            ...(contact.email ? { email: contact.email } : {}),
            ...(contact.phone ? { phone: contact.phone } : {}),
          })) } : {}),
          ...(recentRecords.length ? { recentRecords } : {}),
        });
        return {
          status: "succeeded",
          data,
          provenance: {
            sourceLinks: result.sourceLinks.slice(0, 10).map((link) => sourceLink(link)),
            freshness: { capturedAt: result.freshness },
          },
        };
      },
    },
  };
}
