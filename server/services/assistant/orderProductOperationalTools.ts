import { z } from "zod";
import {
  assistantContextEnvelopeSchema,
  assistantNavigationCurrentContextInputSchema,
  assistantNavigationCurrentContextResultSchema,
  assistantOperationalSummaryInputSchema,
  assistantOperationalSummaryResultSchema,
  assistantOrderSummaryInputSchema,
  assistantOrderSummaryResultSchema,
  assistantProductSummaryInputSchema,
  assistantProductSummaryResultSchema,
  assistantSourceLinkSchema,
  type AssistantContextEnvelope,
  type AssistantToolResultEnvelope,
} from "@shared/assistantContracts";
import { canonicalOrderNumberLookup } from "@shared/documentNumbering";
import type { OperationalSummary } from "../operationalSummary";
import { AssistantOrderProductRepository } from "../../storage/assistantOrderProduct.repo";
import {
  DrizzleAssistantSearchCustomerRepository,
  type AssistantCustomerSummaryRecord,
} from "../../storage/assistantSearchCustomer.repo";
import { QuoteInternalNotesRepository, type QuoteInternalReference } from "../../storage/quoteInternalNotes.repo";
import type { AssistantToolAdapters, AssistantTrustedToolContext } from "./toolRegistry";

const identifierSchema = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9:_-]+$/);
const isoDateSchema = z.string().datetime({ offset: true });
const freshnessSchema = z.object({ retrievedAt: isoDateSchema }).strict();
const sourceLinkSchema = assistantSourceLinkSchema;

export const orderSummaryToolInputSchema = z.object({
  orderId: identifierSchema.optional(),
  orderNumber: z.string().trim().min(1).max(64).optional(),
}).strict().refine((value) => Boolean(value.orderId || value.orderNumber), {
  message: "An order ID or order number is required",
});

export const productSummaryToolInputSchema = z.object({
  productId: identifierSchema.optional(),
  query: z.string().trim().min(1).max(160).optional(),
}).strict().refine((value) => Boolean(value.productId || value.query), {
  message: "A product ID or product name is required",
});

export const operationalSummaryToolInputSchema = z.object({}).strict();
export const currentContextToolInputSchema = z.object({}).strict();

const toolEnvelopeSchema = <T extends z.ZodTypeAny>(data: T) => z.object({
  status: z.enum(["ok", "not_found"]),
  data,
  sourceLinks: z.array(sourceLinkSchema).max(10),
  freshness: freshnessSchema,
  warning: z.string().trim().min(1).max(300).optional(),
}).strict();

export const orderSummaryToolResultSchema = toolEnvelopeSchema(z.object({
  order: z.object({
    id: identifierSchema,
    number: z.string().min(1),
    customerId: identifierSchema,
    customer: z.string().min(1),
    status: z.string().min(1),
    state: z.string().min(1),
    statusPill: z.string().nullable(),
    dueDate: z.string().nullable(),
    fulfillmentStatus: z.string().min(1),
  }).nullable(),
  lineItems: z.array(z.object({
    id: identifierSchema,
    description: z.string().min(1).max(500),
    productName: z.string().nullable(),
    quantity: z.number().int().nonnegative(),
    status: z.string().min(1),
    workflowState: z.string().min(1),
  }).strict()).max(25),
  artwork: z.object({ required: z.number().int().nonnegative(), awaitingDesign: z.number().int().nonnegative() }).strict(),
  proof: z.object({ required: z.number().int().nonnegative(), awaitingApproval: z.number().int().nonnegative() }).strict(),
  prepress: z.object({ required: z.number().int().nonnegative(), pending: z.number().int().nonnegative() }).strict(),
  productionJobs: z.array(z.object({
    id: identifierSchema,
    stationKey: z.string().min(1),
    stepKey: z.string().min(1),
    status: z.string().min(1),
  }).strict()).max(25),
  invoices: z.array(z.object({
    id: identifierSchema,
    number: z.string().min(1),
    status: z.string().min(1),
  }).strict()).max(5).optional(),
  blockingIssues: z.array(z.string().min(1).max(160)).max(3),
}).strict());

export const productSummaryToolResultSchema = toolEnvelopeSchema(z.object({
  product: z.object({
    id: identifierSchema,
    name: z.string().min(1).max(255),
    active: z.boolean(),
    category: z.string().nullable(),
    pricingMethod: z.string().min(1),
  }).nullable(),
  pbv2: z.array(z.object({
    id: identifierSchema,
    status: z.string().min(1),
    schemaVersion: z.number().int().positive(),
    publishedAt: z.string().nullable(),
  }).strict()).max(5),
  materials: z.array(z.object({ id: identifierSchema, name: z.string().min(1), sku: z.string().nullable() }).strict()).max(20),
  options: z.array(z.object({ id: identifierSchema, name: z.string().min(1), type: z.string().min(1), active: z.boolean() }).strict()).max(25),
  productionRouting: z.object({
    requiresProductionJob: z.boolean(),
    requiresProofApproval: z.boolean(),
    artworkPolicy: z.string().min(1),
  }).nullable(),
}).strict());

export const operationalSummaryToolResultSchema = toolEnvelopeSchema(z.object({
  timezone: z.string().min(1),
  metrics: z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    value: z.number().int().nonnegative(),
    definition: z.string().min(1),
    href: z.string().startsWith("/").optional(),
  }).strict()).min(1).max(12),
}).strict());

export const currentContextToolResultSchema = toolEnvelopeSchema(z.object({
  route: z.string().startsWith("/"),
  pageTitle: z.string().min(1),
  entityType: z.string().nullable(),
  entityId: identifierSchema.nullable(),
  currentRecord: z.discriminatedUnion("entityType", [
    z.object({
      entityType: z.literal("order"),
      entityId: identifierSchema,
      orderNumber: z.string().min(1).max(64),
      customer: z.string().min(1).max(240),
      status: z.string().min(1).max(120),
      dueDate: isoDateSchema.optional(),
      sourceLink: sourceLinkSchema,
      freshness: isoDateSchema,
    }).strict(),
    z.object({
      entityType: z.literal("customer"),
      entityId: identifierSchema,
      customerName: z.string().min(1).max(240),
      status: z.string().min(1).max(120).optional(),
      sourceLink: sourceLinkSchema,
      freshness: isoDateSchema,
    }).strict(),
    z.object({
      entityType: z.literal("quote"),
      entityId: identifierSchema,
      quoteNumber: z.string().min(1).max(64),
      customer: z.string().min(1).max(240).optional(),
      status: z.string().min(1).max(120).optional(),
      sourceLink: sourceLinkSchema,
      freshness: isoDateSchema,
    }).strict(),
    z.object({
      entityType: z.literal("product"),
      entityId: identifierSchema,
      productName: z.string().min(1).max(255),
      active: z.boolean(),
      sourceLink: sourceLinkSchema,
      freshness: isoDateSchema,
    }).strict(),
  ]).nullable(),
  selectedCount: z.number().int().nonnegative().max(25),
  unsavedChanges: z.boolean(),
  capturedAt: isoDateSchema,
}).strict());

export type AssistantToolTrustedInvocation = {
  organizationId: string;
  userId: string;
  permissions?: readonly string[];
  context: AssistantContextEnvelope;
  correlationId: string;
  signal?: AbortSignal;
};

type ToolDefinition<TInput extends z.ZodTypeAny, TResult extends z.ZodTypeAny> = {
  name: "orders.get_summary" | "products.get_summary" | "reports.operational_summary" | "navigation.get_current_context";
  version: "stage-2";
  readOnly: true;
  inputSchema: TInput;
  resultSchema: TResult;
  maximumResultCount: number;
  timeoutMs: number;
};

type Tool<TInput extends z.ZodTypeAny, TResult extends z.ZodTypeAny> = {
  definition: ToolDefinition<TInput, TResult>;
  execute(invocation: AssistantToolTrustedInvocation, input: z.input<TInput>): Promise<z.output<TResult>>;
};

export interface AssistantOrderProductToolDependencies {
  repository?: Pick<AssistantOrderProductRepository, "getOrder" | "getProduct"> & Partial<Pick<AssistantOrderProductRepository, "getOrderLineItems" | "getOrderProduction" | "getOrderInvoices">>;
  getCustomerContext?: (organizationId: string, customerId: string) => Promise<AssistantCustomerSummaryRecord | null>;
  getQuoteContext?: (organizationId: string, quoteId: string) => Promise<QuoteInternalReference | null>;
  getOperationalSummary?: (organizationId: string) => Promise<OperationalSummary>;
  now?: () => Date;
  timezone?: string;
  /** Sanitized operational diagnostics only; never receives row payloads. */
  logOrderSummaryStep?: (event: OrderSummaryStepLog) => void;
}

type OrderSummaryStep = "normalize_input" | "lookup_core_order" | "lookup_customer" | "lookup_line_items" | "enrich_production" | "enrich_fulfillment" | "enrich_artwork" | "enrich_billing" | "build_result" | "validate_result" | "return_result";
type OrderSummaryStepLog = { correlationId: string; organizationId: string; orderNumber: string | null; step: OrderSummaryStep; outcome: "started" | "succeeded" | "failed"; errorCode?: string; schemaIssuePath?: string };

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function canViewFinance(permissions: readonly string[] | undefined): boolean {
  return Boolean(permissions?.some((permission) => ["finance:read", "finance", "admin"].includes(permission)));
}

function notFoundFreshness(now: Date) {
  return { retrievedAt: now.toISOString() };
}

function defaultOrderSummaryStepLogger(event: OrderSummaryStepLog): void {
  // This is intentionally a flat, sanitized event: correlation and tenant can
  // be joined to server logs without exposing a customer name, row data, SQL,
  // request content, or database parameters.
  if (process.env.NODE_ENV !== "test") console.info("[assistant.orders.get_summary]", event);
}

function safeOrderSummaryError(error: unknown): Pick<OrderSummaryStepLog, "errorCode" | "schemaIssuePath"> {
  if (error instanceof z.ZodError) {
    return { errorCode: "zod_validation_failed", schemaIssuePath: error.issues[0]?.path.join(".") || "root" };
  }
  if (error instanceof Error && error.message === "tool_timeout") return { errorCode: "tool_timeout" };
  // Deliberately do not copy database/provider messages: they can contain SQL
  // text or values. The original error remains available to the server logger.
  return { errorCode: "dependency_failed" };
}

async function loadOrderSummaryEnrichments(
  repository: AssistantOrderProductToolDependencies["repository"] extends infer T ? NonNullable<T> : never,
  organizationId: string,
  orderId: string,
  log: (step: OrderSummaryStep, outcome: OrderSummaryStepLog["outcome"], error?: unknown) => void,
) {
  const warnings: string[] = ["Some optional workflow details are unavailable for this order."];
  const lineItems = await optionalOrderEnrichment("lookup_line_items", () => repository.getOrderLineItems?.(organizationId, orderId), log, warnings, "Line-item details are unavailable.");
  const production = await optionalOrderEnrichment("enrich_production", () => repository.getOrderProduction?.(organizationId, orderId), log, warnings, "Production details are unavailable.");
  log("enrich_fulfillment", "succeeded");
  log("enrich_artwork", "succeeded");
  const invoices = await optionalOrderEnrichment("enrich_billing", () => repository.getOrderInvoices?.(organizationId, orderId), log, warnings, "Billing details are unavailable.");
  return { lineItems, production, invoices, warnings };
}

async function optionalOrderEnrichment<T>(
  step: Extract<OrderSummaryStep, "lookup_line_items" | "enrich_production" | "enrich_billing">,
  load: () => Promise<T | undefined> | undefined,
  log: (step: OrderSummaryStep, outcome: OrderSummaryStepLog["outcome"], error?: unknown) => void,
  warnings: string[],
  warning: string,
): Promise<T | undefined> {
  log(step, "started");
  try {
    const value = await load();
    if (value === undefined) warnings.push(warning);
    log(step, "succeeded");
    return value;
  } catch (error) {
    warnings.push(warning);
    log(step, "failed", error);
    return undefined;
  }
}

export function createOrderProductOperationalTools(deps: AssistantOrderProductToolDependencies = {}) {
  const repository = deps.repository ?? new AssistantOrderProductRepository();
  const customerRepository = new DrizzleAssistantSearchCustomerRepository();
  const quoteRepository = new QuoteInternalNotesRepository();
  const getCustomerContext = deps.getCustomerContext ?? ((organizationId, customerId) =>
    customerRepository.getCustomerSummary(organizationId, customerId, 1));
  const getQuoteContext = deps.getQuoteContext ?? ((organizationId, quoteId) =>
    quoteRepository.resolveReference(organizationId, { quoteId }));
  // Keep the canonical service behind a lazy boundary. This lets isolated tool
  // tests inject a deterministic summary without loading unrelated production
  // preview/image dependencies, while production still calls the one
  // authoritative aggregation service.
  const getOperationalSummary = deps.getOperationalSummary ?? (async (organizationId: string) => {
    const { computeOperationalSummary } = await import("../operationalSummary");
    return computeOperationalSummary(organizationId);
  });
  const now = deps.now ?? (() => new Date());
  const timezone = deps.timezone ?? "America/New_York";
  const logOrderSummaryStep = deps.logOrderSummaryStep ?? defaultOrderSummaryStepLogger;

  const ordersGetSummary: Tool<typeof orderSummaryToolInputSchema, typeof orderSummaryToolResultSchema> = {
    definition: { name: "orders.get_summary", version: "stage-2", readOnly: true, inputSchema: orderSummaryToolInputSchema, resultSchema: orderSummaryToolResultSchema, maximumResultCount: 25, timeoutMs: 5_000 },
    async execute(invocation, rawInput) {
      const input = orderSummaryToolInputSchema.parse(rawInput);
      const normalizedOrderNumber = input.orderNumber ? canonicalOrderNumberLookup(input.orderNumber) : null;
      const log = (step: OrderSummaryStep, outcome: OrderSummaryStepLog["outcome"], error?: unknown) => logOrderSummaryStep({
        correlationId: invocation.correlationId, organizationId: invocation.organizationId,
        orderNumber: normalizedOrderNumber?.databaseValue ?? input.orderNumber ?? null, step, outcome,
        ...(error ? safeOrderSummaryError(error) : {}),
      });
      log("normalize_input", "succeeded");
      log("lookup_core_order", "started");
      let record: Awaited<ReturnType<AssistantOrderProductRepository["getOrder"]>>;
      try {
        record = await repository.getOrder(invocation.organizationId, {
        ...(input.orderId ? { orderId: input.orderId } : {}),
        ...(normalizedOrderNumber ? { orderNumber: normalizedOrderNumber.databaseValue } : input.orderNumber ? { orderNumber: input.orderNumber } : {}),
        });
        log("lookup_core_order", "succeeded");
      } catch (error) {
        log("lookup_core_order", "failed", error);
        throw error;
      }
      const retrievedAt = now();
      if (!record) return orderSummaryToolResultSchema.parse({
        status: "not_found", data: emptyOrderSummary(), sourceLinks: [], freshness: notFoundFreshness(retrievedAt),
      });

      log("lookup_customer", "succeeded");
      const enrichments = await loadOrderSummaryEnrichments(repository, invocation.organizationId, record.order.id, log);
      const lineItems = enrichments.lineItems ?? record.lineItems;
      const production = enrichments.production ?? record.production;
      const invoices = enrichments.invoices ?? record.invoices;
      const warnings = enrichments.warnings;
      const number = record.order.displayNumber ?? record.order.orderNumber;
      log("build_result", "started");
      const result = {
        status: "ok" as const,
        data: {
          order: {
            id: record.order.id, number, customerId: record.order.customerId, customer: record.order.customerName,
            status: record.order.status,
            // The legacy status is the core, tenant-scoped value available in
            // every supported schema revision. Workflow/pill/fulfillment
            // enrichments remain intentionally unavailable rather than making
            // a valid order lookup depend on optional schema columns.
            state: record.order.status,
            statusPill: null,
            dueDate: toIso(record.order.dueDate),
            fulfillmentStatus: "unavailable",
          },
          lineItems: lineItems.map((line) => ({ id: line.id, description: line.description.slice(0, 500), productName: line.productName ?? null, quantity: line.quantity, status: line.status, workflowState: "unavailable" })),
          artwork: { required: 0, awaitingDesign: 0 },
          proof: { required: 0, awaitingApproval: 0 },
          prepress: { required: 0, pending: 0 },
          productionJobs: production.map((job) => ({ id: job.id, stationKey: job.stationKey, stepKey: job.stepKey, status: job.status })),
          ...(canViewFinance(invocation.permissions) ? { invoices: invoices.map((invoice) => ({ id: invoice.id, number: invoice.displayNumber ?? String(invoice.invoiceNumber), status: invoice.status })) } : {}),
          blockingIssues: [],
        },
        sourceLinks: [{ label: `Order ${number}`, href: `/orders/${record.order.id}`, entityType: "order" as const, entityId: record.order.id, capturedAt: toIso(record.order.updatedAt) ?? retrievedAt.toISOString() }],
        freshness: { retrievedAt: retrievedAt.toISOString() },
        ...(warnings.length ? { warning: warnings.join(" ") } : {}),
      };
      log("build_result", "succeeded");
      log("validate_result", "started");
      try {
        const validated = orderSummaryToolResultSchema.parse(result);
        log("validate_result", "succeeded");
        log("return_result", "succeeded");
        return validated;
      } catch (error) {
        log("validate_result", "failed", error);
        throw error;
      }
    },
  };

  const productsGetSummary: Tool<typeof productSummaryToolInputSchema, typeof productSummaryToolResultSchema> = {
    definition: { name: "products.get_summary", version: "stage-2", readOnly: true, inputSchema: productSummaryToolInputSchema, resultSchema: productSummaryToolResultSchema, maximumResultCount: 25, timeoutMs: 5_000 },
    async execute(invocation, rawInput) {
      const input = productSummaryToolInputSchema.parse(rawInput);
      const record = await repository.getProduct(invocation.organizationId, input);
      const retrievedAt = now();
      if (!record) return productSummaryToolResultSchema.parse({
        status: "not_found", data: emptyProductSummary(), sourceLinks: [], freshness: notFoundFreshness(retrievedAt),
      });
      const pricingMethod = record.product.pricingProfileKey ?? record.product.pricingEngine ?? record.product.pricingMode;
      return productSummaryToolResultSchema.parse({
        status: "ok",
        data: {
          product: { id: record.product.id, name: record.product.name, active: record.product.isActive, category: record.product.category ?? null, pricingMethod },
          pbv2: record.versions.map((version) => ({ id: version.id, status: version.status, schemaVersion: version.schemaVersion, publishedAt: toIso(version.publishedAt) })),
          materials: record.materials.map((material) => ({ id: material.id, name: material.name, sku: material.sku ?? null })),
          options: record.options.map((option) => ({ id: option.id, name: option.name, type: option.type, active: option.isActive })),
          productionRouting: { requiresProductionJob: record.product.requiresProductionJob, requiresProofApproval: record.product.requiresProofApproval, artworkPolicy: record.product.artworkPolicy },
        },
        sourceLinks: [{ label: record.product.name, href: `/products/${record.product.id}/edit`, entityType: "product", entityId: record.product.id, capturedAt: toIso(record.product.updatedAt) ?? retrievedAt.toISOString() }],
        freshness: { retrievedAt: retrievedAt.toISOString() },
      });
    },
  };

  const reportsOperationalSummary: Tool<typeof operationalSummaryToolInputSchema, typeof operationalSummaryToolResultSchema> = {
    definition: { name: "reports.operational_summary", version: "stage-2", readOnly: true, inputSchema: operationalSummaryToolInputSchema, resultSchema: operationalSummaryToolResultSchema, maximumResultCount: 10, timeoutMs: 5_000 },
    async execute(invocation, rawInput) {
      operationalSummaryToolInputSchema.parse(rawInput);
      const summary = await getOperationalSummary(invocation.organizationId);
      const retrievedAt = now();
      return operationalSummaryToolResultSchema.parse({
        status: "ok",
        data: { timezone, metrics: operationalMetrics(summary) },
        sourceLinks: [{ label: "Production overview", href: "/production", capturedAt: retrievedAt.toISOString() }],
        freshness: { retrievedAt: retrievedAt.toISOString() },
      });
    },
  };

  const navigationGetCurrentContext: Tool<typeof currentContextToolInputSchema, typeof currentContextToolResultSchema> = {
    definition: { name: "navigation.get_current_context", version: "stage-2", readOnly: true, inputSchema: currentContextToolInputSchema, resultSchema: currentContextToolResultSchema, maximumResultCount: 1, timeoutMs: 1_000 },
    async execute(invocation, rawInput) {
      currentContextToolInputSchema.parse(rawInput);
      const context = assistantContextEnvelopeSchema.parse(invocation.context);
      const retrievedAt = now();
      const currentRecord = await resolveCurrentRecordContext({
        repository,
        getCustomerContext,
        getQuoteContext,
        organizationId: invocation.organizationId,
        context,
        retrievedAt: retrievedAt.toISOString(),
      });
      return currentContextToolResultSchema.parse({
        status: "ok",
        // Do not echo a nominated ID as a current record.  The entity fields
        // are populated only after the same tenant-scoped lookup that backs
        // the source link succeeds.
        data: {
          route: context.route,
          pageTitle: context.pageTitle,
          entityType: currentRecord?.entityType ?? null,
          entityId: currentRecord?.entityId ?? null,
          currentRecord,
          selectedCount: context.selectedRecordIds.length,
          unsavedChanges: context.unsavedChanges,
          capturedAt: context.capturedAt,
        },
        sourceLinks: currentRecord ? [currentRecord.sourceLink] : [], freshness: { retrievedAt: retrievedAt.toISOString() },
      });
    },
  };

  return { ordersGetSummary, productsGetSummary, reportsOperationalSummary, navigationGetCurrentContext };
}

/**
 * Registry-compatible wrappers around the local, fully typed adapters above.
 * The registry owns policy and authorization; these wrappers only translate
 * reduced canonical records into the shared Stage 2 response contracts.
 */
export function createStage2OrderProductToolAdapters(
  deps: AssistantOrderProductToolDependencies = {},
): AssistantToolAdapters {
  const tools = createOrderProductOperationalTools(deps);
  const toInvocation = (context: AssistantTrustedToolContext): AssistantToolTrustedInvocation => ({
    organizationId: context.scope.organizationId,
    userId: context.scope.userId,
    permissions: context.permissions,
    context: context.context,
    correlationId: context.correlationId,
    signal: context.signal,
  });

  return {
    "orders.get_summary": {
      async execute(rawInput, context): Promise<AssistantToolResultEnvelope> {
        const input = assistantOrderSummaryInputSchema.parse(rawInput);
        const result = await tools.ordersGetSummary.execute(toInvocation(context), input);
        if (result.status === "not_found" || !result.data.order) return { status: "not_found", data: null };
        const order = result.data.order;
        const freshness = result.freshness.retrievedAt;
        const sourceLink = result.sourceLinks[0]!;
        const invoice = result.data.invoices?.[0];
        const data = assistantOrderSummaryResultSchema.parse({
          order: entitySummary("order", order.id, `Order ${order.number}`, order.status, sourceLink, freshness, order.state),
          customer: entitySummary("customer", order.customerId, order.customer, undefined, {
            label: order.customer, href: `/customers/${order.customerId}`, entityType: "customer", entityId: order.customerId, capturedAt: freshness,
          }, freshness),
          ...(order.dueDate ? { dueDate: order.dueDate } : {}),
          lineItemSummary: `${result.data.lineItems.length} line item${result.data.lineItems.length === 1 ? "" : "s"}.`,
          artworkState: `${result.data.artwork.awaitingDesign} awaiting design of ${result.data.artwork.required} requiring design.`,
          productionState: `${result.data.productionJobs.length} production job${result.data.productionJobs.length === 1 ? "" : "s"}; ${result.data.prepress.pending} pending prepress.`,
          fulfillmentState: order.fulfillmentStatus,
          ...(invoice ? { invoice: entitySummary("invoice", invoice.id, `Invoice ${invoice.number}`, invoice.status, { label: `Invoice ${invoice.number}`, href: `/invoices/${invoice.id}`, entityType: "invoice", entityId: invoice.id, capturedAt: freshness }, freshness) } : {}),
          ...(result.data.blockingIssues.length ? { blockingIssues: result.data.blockingIssues } : {}),
        });
        return succeeded(data, result.sourceLinks, freshness, result.warning);
      },
    },
    "products.get_summary": {
      async execute(rawInput, context): Promise<AssistantToolResultEnvelope> {
        const input = assistantProductSummaryInputSchema.parse(rawInput);
        const result = await tools.productsGetSummary.execute(toInvocation(context), input);
        if (result.status === "not_found" || !result.data.product) return { status: "not_found", data: null };
        const product = result.data.product;
        const freshness = result.freshness.retrievedAt;
        const sourceLink = result.sourceLinks[0]!;
        const data = assistantProductSummaryResultSchema.parse({
          product: entitySummary("product", product.id, product.name, product.active ? "active" : "inactive", sourceLink, freshness, product.category ?? undefined),
          active: product.active,
          ...(product.category ? { category: product.category } : {}),
          pricingMethod: product.pricingMethod,
          ...(result.data.pbv2.length ? { pbv2Summary: result.data.pbv2.map((version) => `v${version.schemaVersion} ${version.status}`).join(", ") } : {}),
          ...(result.data.materials.length ? { materialSummary: result.data.materials.map((material) => material.sku ? `${material.name} (${material.sku})` : material.name) } : {}),
          ...(result.data.options.length ? { optionSummary: `${result.data.options.length} option${result.data.options.length === 1 ? "" : "s"}; ${result.data.options.filter((option) => option.active).length} active.` } : {}),
          productionRoutingSummary: `${result.data.productionRouting?.requiresProductionJob ? "Requires" : "Does not require"} a production job; ${result.data.productionRouting?.requiresProofApproval ? "proof approval required" : "proof approval not required"}; artwork ${result.data.productionRouting?.artworkPolicy ?? "not configured"}.`,
        });
        return succeeded(data, result.sourceLinks, freshness);
      },
    },
    "reports.operational_summary": {
      async execute(rawInput, context): Promise<AssistantToolResultEnvelope> {
        const input = assistantOperationalSummaryInputSchema.parse(rawInput);
        const result = await tools.reportsOperationalSummary.execute(toInvocation(context), {});
        const freshness = result.freshness.retrievedAt;
        const data = assistantOperationalSummaryResultSchema.parse({
          metrics: result.data.metrics.map((metric) => ({
            key: metric.key,
            label: metric.label,
            value: metric.value,
            definition: metric.definition,
            ...(metric.href ? { sourceLink: { label: metric.label, href: metric.href, capturedAt: freshness } } : {}),
          })),
          // The canonical service supplies a current snapshot, not a historical
          // report. A requested date is deliberately not treated as a filter.
          appliedDate: currentDateInTimezone(input.timezone ?? result.data.timezone, freshness),
          timezone: input.timezone ?? result.data.timezone,
        });
        return succeeded(data, result.sourceLinks, freshness, input.date ? "The canonical operational summary is a current snapshot; it does not apply a historical date filter." : undefined);
      },
    },
    "navigation.get_current_context": {
      async execute(rawInput, context): Promise<AssistantToolResultEnvelope> {
        assistantNavigationCurrentContextInputSchema.parse(rawInput);
        const result = await tools.navigationGetCurrentContext.execute(toInvocation(context), {});
        const data = assistantNavigationCurrentContextResultSchema.parse({
          route: result.data.route,
          pageTitle: result.data.pageTitle,
          ...(result.data.entityType ? { entityType: result.data.entityType } : {}),
          ...(result.data.entityId ? { entityId: result.data.entityId } : {}),
          ...(result.data.currentRecord ? { currentRecord: result.data.currentRecord } : {}),
          selectedCount: result.data.selectedCount,
          unsavedChanges: result.data.unsavedChanges,
          contextFreshness: result.data.capturedAt,
        });
        // A record source exists only after tenant-scoped resolution. Fall back
        // to the fixed workspace source for page-only, missing, or inaccessible
        // context without echoing a user-supplied route as a record link.
        const sourceLinks = result.sourceLinks.length
          ? result.sourceLinks
          : [{ label: "Current PrintersHero workspace", href: "/", capturedAt: result.freshness.retrievedAt }];
        return succeeded(data, sourceLinks, result.freshness.retrievedAt);
      },
    },
  };
}

/** The browser route is only a nomination.  Treat it as an order context only
 * when its route shape and ID agree, then re-fetch using the trusted tenant. */
type CurrentContextRecord = z.infer<typeof currentContextToolResultSchema>["data"]["currentRecord"];

async function resolveCurrentRecordContext(input: {
  repository: Pick<AssistantOrderProductRepository, "getOrder" | "getProduct">;
  getCustomerContext: (organizationId: string, customerId: string) => Promise<AssistantCustomerSummaryRecord | null>;
  getQuoteContext: (organizationId: string, quoteId: string) => Promise<QuoteInternalReference | null>;
  organizationId: string;
  context: AssistantContextEnvelope;
  retrievedAt: string;
}): Promise<CurrentContextRecord> {
  const { context, organizationId, retrievedAt } = input;
  if (!context.entityType || !context.entityId || !isDetailRoute(context.route, context.entityType, context.entityId)) return null;

  if (context.entityType === "order") {
    const record = await input.repository.getOrder(organizationId, { orderId: context.entityId });
    if (!record) return null;
    const orderNumber = record.order.displayNumber ?? record.order.orderNumber;
    const freshness = toIso(record.order.updatedAt) ?? retrievedAt;
    const dueDate = toIso(record.order.dueDate);
    return {
      entityType: "order",
      entityId: record.order.id,
      orderNumber,
      customer: record.order.customerName,
      status: record.order.status,
      ...(dueDate ? { dueDate } : {}),
      sourceLink: { label: `Order ${orderNumber}`, href: `/orders/${record.order.id}`, entityType: "order", entityId: record.order.id, capturedAt: freshness },
      freshness,
    };
  }

  if (context.entityType === "customer") {
    const record = await input.getCustomerContext(organizationId, context.entityId);
    if (!record) return null;
    const freshness = toIso(record.freshness) ?? retrievedAt;
    return {
      entityType: "customer",
      entityId: record.id,
      customerName: record.companyName,
      ...(record.status ? { status: record.status } : {}),
      sourceLink: { label: record.companyName, href: `/customers/${record.id}`, entityType: "customer", entityId: record.id, capturedAt: freshness },
      freshness,
    };
  }

  if (context.entityType === "quote") {
    const record = await input.getQuoteContext(organizationId, context.entityId);
    if (!record) return null;
    const quoteNumber = record.displayNumber ?? (record.quoteNumber === null ? null : String(record.quoteNumber));
    if (!quoteNumber) return null;
    return {
      entityType: "quote",
      entityId: record.id,
      quoteNumber,
      ...(record.customerName ? { customer: record.customerName } : {}),
      sourceLink: { label: `Quote ${quoteNumber}`, href: `/quotes/${record.id}`, entityType: "quote", entityId: record.id, capturedAt: retrievedAt },
      freshness: retrievedAt,
    };
  }

  if (context.entityType === "product") {
    const record = await input.repository.getProduct(organizationId, { productId: context.entityId });
    if (!record) return null;
    const freshness = toIso(record.product.updatedAt) ?? retrievedAt;
    return {
      entityType: "product",
      entityId: record.product.id,
      productName: record.product.name,
      active: record.product.isActive,
      sourceLink: { label: record.product.name, href: `/products/${record.product.id}/edit`, entityType: "product", entityId: record.product.id, capturedAt: freshness },
      freshness,
    };
  }

  return null;
}

function isDetailRoute(route: string, entityType: AssistantContextEnvelope["entityType"], entityId: string): boolean {
  const segments = route.split("/").filter(Boolean);
  if (entityType === "product") return segments.length === 3 && segments[0] === "products" && segments[1] === entityId && segments[2] === "edit";
  if (entityType === "quote") return (segments.length === 2 || (segments.length === 3 && segments[2] === "edit")) && segments[0] === "quotes" && segments[1] === entityId;
  if (entityType === "customer") return segments.length === 2 && segments[0] === "customers" && segments[1] === entityId;
  return entityType === "order" && segments.length === 2 && segments[0] === "orders" && segments[1] === entityId;
}

// Kept as a descriptive alias for direct module consumers while the integration
// point uses the Stage 2 naming convention above.
export const createAssistantOrderProductToolAdapters = createStage2OrderProductToolAdapters;

function entitySummary(
  entityType: "customer" | "order" | "product" | "invoice",
  recordId: string,
  label: string,
  status: string | undefined,
  sourceLink: z.infer<typeof sourceLinkSchema>,
  freshness: string,
  secondaryDescription?: string,
) {
  return {
    entityType,
    recordId,
    label,
    ...(secondaryDescription ? { secondaryDescription } : {}),
    ...(status ? { status } : {}),
    sourceLink,
    freshness,
  };
}

function succeeded(data: unknown, sourceLinks: z.infer<typeof sourceLinkSchema>[], freshness: string, warning?: string): AssistantToolResultEnvelope {
  return {
    status: "succeeded",
    data,
    provenance: { sourceLinks, freshness: { capturedAt: freshness } },
    ...(warning ? { warning } : {}),
  };
}

function currentDateInTimezone(timezone: string, freshness: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date(freshness));
    const part = (type: "year" | "month" | "day") => parts.find((value) => value.type === type)?.value;
    const year = part("year");
    const month = part("month");
    const day = part("day");
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    // Fall through to the ISO timestamp below.
  }
  return freshness.slice(0, 10);
}

function emptyOrderSummary() {
  return { order: null, lineItems: [], artwork: { required: 0, awaitingDesign: 0 }, proof: { required: 0, awaitingApproval: 0 }, prepress: { required: 0, pending: 0 }, productionJobs: [], blockingIssues: [] };
}

function emptyProductSummary() {
  return { product: null, pbv2: [], materials: [], options: [], productionRouting: null };
}

function operationalMetrics(summary: OperationalSummary) {
  return [
    { key: "inbound_orders", label: "Inbound orders needing review", value: summary.inboundOrders, definition: "Inbound orders in received, processing, or needs-review status.", href: "/inbound-orders" },
    { key: "production_overview", label: "Production overview", value: summary.overview, definition: "Open orders currently represented by the canonical production overview.", href: "/production" },
    { key: "design", label: "Jobs in design", value: summary.design, definition: "Canonical design-queue count.", href: "/production/design" },
    { key: "proofing", label: "Jobs waiting on proof", value: summary.proofing, definition: "Proof queue items awaiting send, revision, or an active proof.", href: "/production/proofing" },
    { key: "prepress", label: "Jobs in prepress", value: summary.prepress, definition: "Eligible line items in the default prepress view.", href: "/production/prepress" },
    { key: "flatbed", label: "Flatbed jobs", value: summary.flatbed, definition: "Visible queued, in-progress, or paused flatbed jobs.", href: "/production/flatbed" },
    { key: "roll", label: "Roll jobs", value: summary.roll, definition: "Visible queued, in-progress, or paused roll jobs.", href: "/production/roll" },
    { key: "fulfillment", label: "Ready for fulfillment", value: summary.fulfillment, definition: "Orders in the canonical fulfillment queue.", href: "/fulfillment" },
    { key: "invoices_pending_send", label: "Invoices pending send", value: summary.invoices.pendingSend, definition: "Draft invoices pending send or retry handling.", href: "/invoices" },
    { key: "invoices_unpaid", label: "Unpaid invoices", value: summary.invoices.unpaid, definition: "Billed, sent, partially paid, or overdue invoices.", href: "/invoices" },
  ];
}
