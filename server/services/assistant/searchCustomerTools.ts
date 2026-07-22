import { z } from "zod";
import {
  ASSISTANT_SEARCH_MAX_RESULTS_PER_CATEGORY,
  DrizzleAssistantSearchCustomerRepository,
  type AssistantCustomerSummaryRecord,
  type AssistantDirectSearchEntityType,
  type AssistantSearchCustomerRepository,
  type AssistantSearchRecord,
} from "../../storage/assistantSearchCustomer.repo";

const safeIdentifierSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
const freshnessSchema = z.string().datetime();

export const assistantSearchResultSchema = z.object({
  entityType: z.enum(["customer", "contact", "order", "quote", "invoice", "production_job", "product"]),
  recordId: safeIdentifierSchema,
  displayLabel: z.string().min(1).max(300),
  secondaryDescription: z.string().max(500).nullable(),
  status: z.string().max(100).nullable(),
  route: z.string().regex(/^\/(?:customers|contacts|orders|quotes|invoices|production\/jobs)\/[A-Za-z0-9_-]+$|^\/products\/[A-Za-z0-9_-]+\/edit$/),
  freshness: freshnessSchema,
});

export const searchGlobalToolInputSchema = z.object({
  query: z.string().trim().min(2).max(120),
  maxResultsPerCategory: z.coerce.number().int().min(1).max(ASSISTANT_SEARCH_MAX_RESULTS_PER_CATEGORY).default(ASSISTANT_SEARCH_MAX_RESULTS_PER_CATEGORY),
  // Only deterministic server routing supplies this discriminator. Provider
  // planning still uses the conservative generic search contract.
  entityType: z.enum(["customer", "product"]).optional(),
}).strict();

export const searchGlobalToolResultSchema = z.object({
  results: z.array(assistantSearchResultSchema).max(ASSISTANT_SEARCH_MAX_RESULTS_PER_CATEGORY * 7),
  counts: z.record(z.enum(["customer", "contact", "order", "quote", "invoice", "production_job", "product"]), z.number().int().min(0).max(ASSISTANT_SEARCH_MAX_RESULTS_PER_CATEGORY)),
});

export const customerSummaryToolInputSchema = z.object({
  customerId: safeIdentifierSchema,
}).strict();

export const customerSummaryToolResultSchema = z.object({
  customer: z.object({
    id: safeIdentifierSchema,
    companyName: z.string().min(1).max(255),
    isActive: z.boolean().nullable(),
    status: z.string().max(100).nullable(),
    route: z.string().regex(/^\/customers\/[A-Za-z0-9_-]+$/),
    freshness: freshnessSchema,
  }),
  contacts: z.array(z.object({
    id: safeIdentifierSchema,
    name: z.string().min(1).max(255),
    title: z.string().max(100).nullable(),
    email: z.string().max(255).nullable(),
    phone: z.string().max(50).nullable(),
    isPrimary: z.boolean(),
    route: z.string().regex(/^\/contacts\/[A-Za-z0-9_-]+$/),
    freshness: freshnessSchema,
  })).max(ASSISTANT_SEARCH_MAX_RESULTS_PER_CATEGORY),
  recentActivity: z.array(z.object({
    kind: z.enum(["order", "quote"]),
    id: safeIdentifierSchema,
    displayNumber: z.string().min(1).max(100),
    status: z.string().max(100),
    route: z.string().regex(/^\/(?:orders|quotes)\/[A-Za-z0-9_-]+$/),
    freshness: freshnessSchema,
  })).max(ASSISTANT_SEARCH_MAX_RESULTS_PER_CATEGORY),
});

export interface TrustedAssistantToolInvocation {
  scope: { organizationId: string; userId: string };
  correlationId: string;
  context?: unknown;
  signal?: AbortSignal;
}

export interface AssistantToolExecution<T> {
  status: "success" | "not_found";
  data: T;
  sourceLinks: Array<{ recordId: string; route: string; label: string }>;
  freshness: string;
  warning?: string;
}

function toFreshness(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function normalizedSearchRecord(record: AssistantSearchRecord) {
  return { ...record, freshness: toFreshness(record.freshness) };
}

function normalizedCustomerSummary(record: AssistantCustomerSummaryRecord) {
  return {
    customer: {
      id: record.id,
      companyName: record.companyName,
      isActive: record.isActive,
      status: record.status,
      route: record.route,
      freshness: toFreshness(record.freshness),
    },
    contacts: record.contacts.map((contact) => ({ ...contact, freshness: toFreshness(contact.freshness) })),
    recentActivity: record.recentActivity.map((activity) => ({ ...activity, freshness: toFreshness(activity.freshness) })),
  };
}

/**
 * Read-only, tenant-scoped adapter. This deliberately omits balances, invoices,
 * payment data, tax documents, internal notes, and any finance-only field.
 */
export function createSearchGlobalTool(repository: AssistantSearchCustomerRepository = new DrizzleAssistantSearchCustomerRepository()) {
  return {
    definition: {
      name: "search.global",
      version: "stage-2",
      readOnly: true,
      inputSchema: searchGlobalToolInputSchema,
      resultSchema: searchGlobalToolResultSchema,
      maxResults: ASSISTANT_SEARCH_MAX_RESULTS_PER_CATEGORY,
      sourceLinks: "required",
    },
    async execute(invocation: TrustedAssistantToolInvocation, rawInput: unknown): Promise<AssistantToolExecution<z.infer<typeof searchGlobalToolResultSchema>>> {
      const input = searchGlobalToolInputSchema.parse(rawInput);
      const records = input.entityType
        ? await repository.searchByEntity(invocation.scope.organizationId, input.query, input.maxResultsPerCategory, input.entityType as AssistantDirectSearchEntityType)
        : await repository.search(invocation.scope.organizationId, input.query, input.maxResultsPerCategory);
      const results = records.map(normalizedSearchRecord);
      const counts = results.reduce<Record<z.infer<typeof assistantSearchResultSchema>["entityType"], number>>((accumulator, result) => {
        accumulator[result.entityType] += 1;
        return accumulator;
      }, { customer: 0, contact: 0, order: 0, quote: 0, invoice: 0, production_job: 0, product: 0 });
      const data = searchGlobalToolResultSchema.parse({ results, counts });
      return {
        status: "success",
        data,
        sourceLinks: results.map((result) => ({ recordId: result.recordId, route: result.route, label: result.displayLabel })),
        freshness: new Date().toISOString(),
      };
    },
  };
}

export function createCustomerSummaryTool(repository: AssistantSearchCustomerRepository = new DrizzleAssistantSearchCustomerRepository()) {
  return {
    definition: {
      name: "customers.get_summary",
      version: "stage-2",
      readOnly: true,
      inputSchema: customerSummaryToolInputSchema,
      resultSchema: customerSummaryToolResultSchema,
      maxResults: ASSISTANT_SEARCH_MAX_RESULTS_PER_CATEGORY,
      sourceLinks: "required",
      financeFields: "omitted",
    },
    async execute(invocation: TrustedAssistantToolInvocation, rawInput: unknown): Promise<AssistantToolExecution<z.infer<typeof customerSummaryToolResultSchema> | { customerId: string }>> {
      const input = customerSummaryToolInputSchema.parse(rawInput);
      const record = await repository.getCustomerSummary(invocation.scope.organizationId, input.customerId, ASSISTANT_SEARCH_MAX_RESULTS_PER_CATEGORY);
      if (!record) {
        return {
          status: "not_found",
          data: { customerId: input.customerId },
          sourceLinks: [],
          freshness: new Date().toISOString(),
        };
      }
      const data = customerSummaryToolResultSchema.parse(normalizedCustomerSummary(record));
      return {
        status: "success",
        data,
        sourceLinks: [
          { recordId: data.customer.id, route: data.customer.route, label: data.customer.companyName },
          ...data.contacts.map((contact) => ({ recordId: contact.id, route: contact.route, label: contact.name })),
          ...data.recentActivity.map((activity) => ({ recordId: activity.id, route: activity.route, label: activity.displayNumber })),
        ],
        freshness: data.customer.freshness,
      };
    },
  };
}
