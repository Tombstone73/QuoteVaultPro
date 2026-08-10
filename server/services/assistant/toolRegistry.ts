import { z, type ZodTypeAny } from "zod";
import {
  assistantCustomerSummaryInputSchema,
  assistantCustomerSummaryResultSchema,
  assistantQuoteSearchInputSchema,
  assistantQuoteSearchResultSchema,
  assistantQuoteDetailInputSchema,
  assistantQuoteDetailResultSchema,
  assistantGlobalSearchInputSchema,
  assistantGlobalSearchResultSchema,
  assistantNavigationCurrentContextInputSchema,
  assistantNavigationCurrentContextResultSchema,
  assistantOperationalSummaryInputSchema,
  assistantOperationalSummaryResultSchema,
  assistantProductionQueueInputSchema,
  assistantProductionQueueResultSchema,
  assistantAttentionSummaryInputSchema,
  assistantAttentionSummaryResultSchema,
  assistantOrderDueSummaryInputSchema,
  assistantOrderDueSummaryResultSchema,
  assistantCompletedJobReportInputSchema,
  assistantCompletedJobReportResultSchema,
  analyticsResolveCustomerInputSchema,
  analyticsResolveCustomerResultSchema,
  analyticsCustomerProductSalesInputSchema,
  analyticsCustomerProductSalesResultSchema,
  analyticsCustomerUninvoicedOrdersInputSchema,
  analyticsCustomerUninvoicedOrdersResultSchema,
  analyticsInvoiceActivityInputSchema,
  analyticsInvoiceActivityResultSchema,
  assistantOrderSummaryInputSchema,
  assistantOrderSummaryResultSchema,
  assistantProductSummaryInputSchema,
  assistantProductSummaryResultSchema,
  assistantProductPricingInputSchema,
  assistantProductPricingResultSchema,
  assistantToolNameValues,
  assistantToolResultEnvelopeSchema,
  type AssistantContextEnvelope,
  type AssistantToolName,
  type AssistantToolResultEnvelope,
} from "@shared/assistantContracts";

/**
 * Trusted execution context is assembled by backend middleware.  Tool inputs
 * intentionally contain no organization, user, route URL, or permission data.
 */
export interface AssistantTrustedToolContext {
  scope: { organizationId: string; userId: string };
  actor: { userId: string; email: string | null };
  permissions: readonly string[];
  context: AssistantContextEnvelope;
  correlationId: string;
  signal: AbortSignal;
}

export type AssistantToolPermissionPolicy = "internal_staff" | "catalog_read" | "finance_read";
export type AssistantToolDataClassification = "internal" | "restricted_finance";
export type AssistantToolSourceLinkBehavior = "required" | "optional";

/**
 * Tool deadlines are policy, not adapter implementation details.  This cap
 * bounds every individual read while allowing a slower, known multi-query
 * lookup such as an order summary to receive its explicitly registered time.
 */
export const ASSISTANT_PLATFORM_MAX_TOOL_TIMEOUT_MS = 5_000;

export interface AssistantToolAdapter<TInput = unknown> {
  execute(input: TInput, context: AssistantTrustedToolContext): Promise<AssistantToolResultEnvelope>;
}

export interface AssistantToolDefinition<TInput = unknown> {
  name: AssistantToolName;
  version: "v1";
  description: string;
  readOnly: true;
  requiredPermission: AssistantToolPermissionPolicy;
  requiredContext: readonly ("trusted_actor" | "page_context")[];
  inputSchema: ZodTypeAny;
  /** Compact provider-facing schema. The Zod schema remains the execution
   * authority; this prevents native function callers from guessing names. */
  providerInputSchema?: Record<string, unknown>;
  resultSchema: ZodTypeAny;
  maxResults: number;
  timeoutMs: number;
  dataClassification: AssistantToolDataClassification;
  sourceLinkBehavior: AssistantToolSourceLinkBehavior;
  auditCategory: string;
  modelSummarizationAllowed: boolean;
  adapter?: AssistantToolAdapter<TInput>;
}

export type AssistantToolAdapters = Partial<Record<AssistantToolName, AssistantToolAdapter>>;

const toolMetadata = {
  "search.global": {
    description: "Find bounded tenant-scoped business records. Arguments: query (required text), optional entityType customer|product, optional limit 1–20. Use this to establish a trusted product reference before a product summary or pricing request; investigate likely catalog matches before asking the user for an exact product name.",
    requiredPermission: "internal_staff",
    requiredContext: ["trusted_actor"] as const,
    inputSchema: assistantGlobalSearchInputSchema,
    providerInputSchema: { type: "object", additionalProperties: false, required: ["query"], properties: { query: { type: "string", minLength: 1, maxLength: 160 }, entityType: { enum: ["customer", "product"] }, limit: { type: "integer", minimum: 1, maximum: 20 } } },
    resultSchema: assistantGlobalSearchResultSchema,
    maxResults: 20,
    timeoutMs: 3_000,
    dataClassification: "internal",
    sourceLinkBehavior: "required",
    auditCategory: "assistant_search",
    modelSummarizationAllowed: true,
  },
  "quotes.search": {
    description: "Search a bounded tenant-wide quote list without requiring a customer. Arguments are all optional: customer (business name), quoteNumber, lifecycle open or closed, canonical status draft|pending_approval|sent|approved|rejected|expired|converted, createdAtRange {start,end} ISO datetimes, sort newest|oldest|total_desc|total_asc, and limit up to 20. Use lifecycle open for open quotes. Results include quote number, customer, total, canonical status, creation date, and trusted quote/customer references. Quote sent timestamps are not stored; sent quotes are ordered by creation date.",
    requiredPermission: "internal_staff",
    requiredContext: ["trusted_actor"] as const,
    inputSchema: assistantQuoteSearchInputSchema,
    resultSchema: assistantQuoteSearchResultSchema,
    maxResults: 20,
    timeoutMs: 5_000,
    dataClassification: "internal",
    sourceLinkBehavior: "optional",
    auditCategory: "assistant_quote_search",
    modelSummarizationAllowed: true,
  },
  "quotes.get_detail": {
    description: "Return one tenant-scoped quote's customer/contact, canonical status and total, line items, and authoritative quote-to-order relationship. Use a quoteId returned by quotes.search or trusted task context. A relatedOrder state of none is a normal authoritative result; only call orders.get_summary when state is linked.",
    requiredPermission: "internal_staff",
    requiredContext: ["trusted_actor"] as const,
    inputSchema: assistantQuoteDetailInputSchema,
    resultSchema: assistantQuoteDetailResultSchema,
    maxResults: 1,
    timeoutMs: 5_000,
    dataClassification: "internal",
    sourceLinkBehavior: "required",
    auditCategory: "assistant_quote_detail",
    modelSummarizationAllowed: true,
  },
  "customers.get_summary": {
    description: "Return a reduced customer summary with bounded related records.",
    requiredPermission: "internal_staff",
    requiredContext: ["trusted_actor"] as const,
    inputSchema: assistantCustomerSummaryInputSchema,
    resultSchema: assistantCustomerSummaryResultSchema,
    maxResults: 10,
    timeoutMs: 3_000,
    dataClassification: "internal",
    sourceLinkBehavior: "required",
    auditCategory: "assistant_customer_summary",
    modelSummarizationAllowed: true,
  },
  "orders.get_summary": {
    description: "Return a reduced read-only operational summary for one tenant-scoped order.",
    requiredPermission: "internal_staff",
    requiredContext: ["trusted_actor"] as const,
    inputSchema: assistantOrderSummaryInputSchema,
    resultSchema: assistantOrderSummaryResultSchema,
    maxResults: 1,
    // The order summary has a tenant-scoped core lookup plus bounded optional
    // enrichments.  Five seconds is the platform maximum and prevents an
    // outer deadline from pre-empting its registered execution budget.
    timeoutMs: 5_000,
    dataClassification: "internal",
    sourceLinkBehavior: "required",
    auditCategory: "assistant_order_summary",
    modelSummarizationAllowed: true,
  },
  "products.get_summary": {
    description: "Return a reduced catalog and production-routing summary for one trusted product reference. This is not a calculated customer price; use products.get_pricing for an authoritative scenario price when permitted.",
    requiredPermission: "catalog_read",
    requiredContext: ["trusted_actor"] as const,
    inputSchema: assistantProductSummaryInputSchema,
    resultSchema: assistantProductSummaryResultSchema,
    maxResults: 1,
    timeoutMs: 3_000,
    dataClassification: "internal",
    sourceLinkBehavior: "required",
    auditCategory: "assistant_product_summary",
    modelSummarizationAllowed: true,
  },
  "products.get_pricing": {
    description: "Return authoritative semantic PBV2 pricing configuration for one tenant-scoped product, without requiring a calculation. Optionally project a customer price with semantic width, height, unit (in or ft), quantity, and business-labeled option selections; server resolves defaults and internal PBV2 values. When a required pricing input is missing, the result names its business label and allowed choices. When only a product name is known, use search.global to establish a trusted product reference. This read never changes a product, quote, or order.",
    requiredPermission: "finance_read",
    requiredContext: ["trusted_actor"] as const,
    inputSchema: assistantProductPricingInputSchema,
    resultSchema: assistantProductPricingResultSchema,
    maxResults: 1,
    timeoutMs: 5_000,
    dataClassification: "restricted_finance",
    sourceLinkBehavior: "required",
    auditCategory: "assistant_product_pricing",
    modelSummarizationAllowed: true,
  },
  "reports.operational_summary": {
    description: "Return canonical tenant-scoped operational counters for the requested date and timezone.",
    requiredPermission: "internal_staff",
    requiredContext: ["trusted_actor"] as const,
    inputSchema: assistantOperationalSummaryInputSchema,
    resultSchema: assistantOperationalSummaryResultSchema,
    maxResults: 20,
    timeoutMs: 4_000,
    dataClassification: "internal",
    sourceLinkBehavior: "required",
    auditCategory: "assistant_operational_summary",
    modelSummarizationAllowed: true,
  },
  "navigation.get_current_context": {
    description: "Describe only the already validated current PrintersHero page context.",
    requiredPermission: "internal_staff",
    requiredContext: ["trusted_actor", "page_context"] as const,
    inputSchema: assistantNavigationCurrentContextInputSchema,
    resultSchema: assistantNavigationCurrentContextResultSchema,
    maxResults: 1,
    timeoutMs: 1_000,
    dataClassification: "internal",
    sourceLinkBehavior: "optional",
    auditCategory: "assistant_navigation_context",
    modelSummarizationAllowed: true,
  },
  "production.get_queue_summary": {
    description: "Return a bounded tenant-scoped production queue for one station or all configured stations.",
    requiredPermission: "internal_staff",
    requiredContext: ["trusted_actor"] as const,
    inputSchema: assistantProductionQueueInputSchema,
    resultSchema: assistantProductionQueueResultSchema,
    maxResults: 20,
    timeoutMs: 5_000,
    dataClassification: "internal",
    sourceLinkBehavior: "required",
    auditCategory: "assistant_production_queue_summary",
    modelSummarizationAllowed: true,
  },
  "operations.get_attention_summary": {
    description: "Return bounded read-only production deadline and attention categories using canonical operational data.",
    requiredPermission: "internal_staff",
    requiredContext: ["trusted_actor"] as const,
    inputSchema: assistantAttentionSummaryInputSchema,
    resultSchema: assistantAttentionSummaryResultSchema,
    maxResults: 20,
    timeoutMs: 5_000,
    dataClassification: "internal",
    sourceLinkBehavior: "required",
    auditCategory: "assistant_operations_attention_summary",
    modelSummarizationAllowed: true,
  },
  "orders.get_due_summary": {
    description: "Return a bounded tenant-scoped list of unique orders due or overdue, with optional operational counts.",
    requiredPermission: "internal_staff",
    requiredContext: ["trusted_actor"] as const,
    inputSchema: assistantOrderDueSummaryInputSchema,
    resultSchema: assistantOrderDueSummaryResultSchema,
    maxResults: 20,
    timeoutMs: 5_000,
    dataClassification: "internal",
    // An empty due-date report is a successful, bounded read with no order to
    // link to. Non-empty results remain source-linked by the result schema.
    sourceLinkBehavior: "optional",
    auditCategory: "assistant_order_due_summary",
    modelSummarizationAllowed: true,
  },
  "production.get_completed_jobs": {
    description: "Return a bounded tenant-scoped list of completed production jobs for one resolved customer and calendar range.",
    requiredPermission: "internal_staff",
    requiredContext: ["trusted_actor"] as const,
    inputSchema: assistantCompletedJobReportInputSchema,
    resultSchema: assistantCompletedJobReportResultSchema,
    maxResults: 10,
    timeoutMs: 5_000,
    dataClassification: "internal",
    // A valid empty completed-job range has no record to link to. Each
    // non-empty row still requires both a production-job and order link.
    sourceLinkBehavior: "optional",
    auditCategory: "assistant_completed_job_report",
    modelSummarizationAllowed: true,
  },
  "analytics.resolve_customer": {
    description: "Resolve a bounded tenant-scoped customer reference for analytical reporting.",
    requiredPermission: "finance_read",
    requiredContext: ["trusted_actor"] as const,
    inputSchema: analyticsResolveCustomerInputSchema,
    resultSchema: analyticsResolveCustomerResultSchema,
    maxResults: 10,
    timeoutMs: 3_000,
    dataClassification: "restricted_finance",
    sourceLinkBehavior: "required",
    auditCategory: "assistant_analytics_customer_resolution",
    modelSummarizationAllowed: true,
  },
  "analytics.customer_product_sales": {
    description: "Aggregate bounded posted invoice-line sales for one resolved customer and date range.",
    requiredPermission: "finance_read",
    requiredContext: ["trusted_actor"] as const,
    inputSchema: analyticsCustomerProductSalesInputSchema,
    resultSchema: analyticsCustomerProductSalesResultSchema,
    maxResults: 25,
    timeoutMs: 5_000,
    dataClassification: "restricted_finance",
    sourceLinkBehavior: "required",
    auditCategory: "assistant_analytics_customer_product_sales",
    modelSummarizationAllowed: true,
  },
  "analytics.customer_uninvoiced_orders": {
    description: "Return bounded operational order value and billing context that is not included in posted revenue.",
    requiredPermission: "finance_read",
    requiredContext: ["trusted_actor"] as const,
    inputSchema: analyticsCustomerUninvoicedOrdersInputSchema,
    resultSchema: analyticsCustomerUninvoicedOrdersResultSchema,
    maxResults: 25,
    timeoutMs: 5_000,
    dataClassification: "restricted_finance",
    sourceLinkBehavior: "required",
    auditCategory: "assistant_analytics_customer_uninvoiced_orders",
    modelSummarizationAllowed: true,
  },
  "analytics.invoice_activity": {
    description: "Release a bounded tenant-scoped list of posted invoice facts for an AI-selected calendar range. Arguments are dateRange {start,end}, optional canonical posted statuses, optional customerId from a trusted result, and limit up to 200. Rows include canonical invoice total, paid amount, outstanding balance, status, customer, and dates. This tool does not calculate business conclusions; use analysis.run for grouping, comparisons, percentages, or rankings.",
    requiredPermission: "finance_read",
    requiredContext: ["trusted_actor"] as const,
    inputSchema: analyticsInvoiceActivityInputSchema,
    resultSchema: analyticsInvoiceActivityResultSchema,
    maxResults: 200,
    timeoutMs: 5_000,
    dataClassification: "restricted_finance",
    sourceLinkBehavior: "required",
    auditCategory: "assistant_analytics_invoice_activity",
    modelSummarizationAllowed: true,
  },
} satisfies Record<AssistantToolName, Omit<AssistantToolDefinition, "name" | "version" | "readOnly" | "adapter">>;

export function createAssistantToolRegistry(adapters: AssistantToolAdapters = {}): ReadonlyMap<AssistantToolName, AssistantToolDefinition> {
  const tools = assistantToolNameValues.map((name) => [
    name,
    {
      name,
      version: "v1" as const,
      readOnly: true as const,
      ...toolMetadata[name],
      ...(adapters[name] ? { adapter: adapters[name] } : {}),
    },
  ] as const);
  for (const [, tool] of tools) {
    if (!Number.isInteger(tool.timeoutMs) || tool.timeoutMs <= 0 || tool.timeoutMs > ASSISTANT_PLATFORM_MAX_TOOL_TIMEOUT_MS) {
      throw new Error(`Assistant tool ${tool.name} has an unsafe timeout policy.`);
    }
  }
  return new Map(tools);
}

/** The authoritative, static assistant read-tool allowlist. Runtime adapters
 * may be injected, but cannot introduce another tool or alter its policy. */
export const assistantToolRegistry = createAssistantToolRegistry();

const ignoredIdentityArgumentKeys = new Set([
  "organizationid", "orgid", "tenantid", "userid", "permissions", "permission", "role", "roles",
]);
const forbiddenArgumentKeys = new Set(["url", "href", "sql", "querysql", "servicename"]);

/** Strip identity and authorization values proposed by a model. The trusted
 * context remains the sole source of those values. */
export function stripUntrustedModelIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUntrustedModelIdentity);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !ignoredIdentityArgumentKeys.has(key.replace(/[_-]/g, "").toLowerCase()))
    .map(([key, nested]) => [key, stripUntrustedModelIdentity(nested)]));
}

export function containsForbiddenModelArgument(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsForbiddenModelArgument);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value as Record<string, unknown>).some(([key, nested]) => (
    forbiddenArgumentKeys.has(key.replace(/[_-]/g, "").toLowerCase())
    || containsForbiddenModelArgument(nested)
  ));
}

export function isAuthorizedForAssistantTool(
  policy: AssistantToolPermissionPolicy,
  context: Pick<AssistantTrustedToolContext, "permissions">,
): boolean {
  const permissions = new Set(context.permissions.map((permission) => permission.trim().toLowerCase()));
  // Portal identities are never granted this backend-only marker.  Route
  // integration must derive it from authenticated staff identity, never input.
  if (!permissions.has("assistant.internal_staff")) return false;
  if (policy === "catalog_read") return permissions.has("catalog.read") || permissions.has("catalog:read");
  if (policy === "finance_read") return permissions.has("finance.read") || permissions.has("finance:read");
  return true;
}

export function validateAssistantToolResult(
  tool: AssistantToolDefinition,
  rawResult: unknown,
): AssistantToolResultEnvelope {
  const envelope = assistantToolResultEnvelopeSchema.parse(rawResult);
  if (!Object.prototype.hasOwnProperty.call(rawResult as object, "data")) {
    throw new z.ZodError([{ code: z.ZodIssueCode.custom, path: ["data"], message: "Tool result data is required." }]);
  }
  if (envelope.status === "succeeded" || envelope.status === "partial") {
    if (tool.sourceLinkBehavior === "required" && envelope.provenance!.sourceLinks.length === 0) {
      throw new z.ZodError([{
        code: z.ZodIssueCode.custom,
        path: ["provenance", "sourceLinks"],
        message: "This tool requires at least one internal source link.",
      }]);
    }
    return { ...envelope, data: tool.resultSchema.parse(envelope.data) };
  }
  if (envelope.data !== null) {
    throw new z.ZodError([{ code: z.ZodIssueCode.custom, path: ["data"], message: "Non-successful tool results must not expose data." }]);
  }
  return envelope;
}
