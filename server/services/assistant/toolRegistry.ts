import { z, type ZodTypeAny } from "zod";
import {
  assistantCustomerSummaryInputSchema,
  assistantCustomerSummaryResultSchema,
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
  analyticsResolveCustomerInputSchema,
  analyticsResolveCustomerResultSchema,
  analyticsCustomerProductSalesInputSchema,
  analyticsCustomerProductSalesResultSchema,
  analyticsCustomerUninvoicedOrdersInputSchema,
  analyticsCustomerUninvoicedOrdersResultSchema,
  assistantOrderSummaryInputSchema,
  assistantOrderSummaryResultSchema,
  assistantProductSummaryInputSchema,
  assistantProductSummaryResultSchema,
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
    description: "Find bounded tenant-scoped customers, orders, products, and other approved business records.",
    requiredPermission: "internal_staff",
    requiredContext: ["trusted_actor"] as const,
    inputSchema: assistantGlobalSearchInputSchema,
    resultSchema: assistantGlobalSearchResultSchema,
    maxResults: 20,
    timeoutMs: 3_000,
    dataClassification: "internal",
    sourceLinkBehavior: "required",
    auditCategory: "assistant_search",
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
    description: "Return a reduced catalog and production-routing summary for one product.",
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
    sourceLinkBehavior: "required",
    auditCategory: "assistant_order_due_summary",
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
  "organizationid", "orgid", "tenantid", "userid", "permissions", "permission", "role",
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
