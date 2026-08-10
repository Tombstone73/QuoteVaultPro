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
  assistantProductPricingInputSchema,
  assistantProductPricingResultSchema,
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
import { AssistantToolExecutionError } from "./orchestration";
import type { ProductPricingIntrospection } from "../pricing/PricingService";

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

export const productPricingToolInputSchema = z.object({
  productId: identifierSchema.optional(),
  query: z.string().trim().min(1).max(160).optional(),
  quantity: z.number().int().min(1).max(100_000).optional(),
  /** Legacy inch inputs remain accepted; semantic width/height/unit is preferred. */
  widthIn: z.number().finite().max(10_000).optional(),
  heightIn: z.number().finite().max(10_000).optional(),
  width: z.number().finite().max(10_000).optional(),
  height: z.number().finite().max(10_000).optional(),
  unit: z.enum(["in", "ft"]).optional(),
  optionSelections: z.record(z.unknown()).optional(),
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
    billingStatus: z.string().min(1),
    priority: z.string().min(1),
    poNumber: z.string().nullable(),
    jobLabel: z.string().nullable(),
    orderTotal: z.number().finite().nonnegative().nullable(),
  }).nullable(),
  lineItems: z.array(z.object({
    id: identifierSchema,
    description: z.string().min(1).max(500),
    productName: z.string().nullable(),
    quantity: z.number().int().nonnegative(),
    status: z.string().min(1),
    workflowState: z.string().min(1),
    lineItemSequence: z.number().int().positive(),
    materialName: z.string().nullable(),
    dimensions: z.object({ widthInches: z.number().positive(), heightInches: z.number().positive() }).nullable(),
    finishedSquareFeet: z.number().finite().nonnegative().nullable(),
    sidedness: z.enum(["single_sided", "double_sided", "unavailable"]),
    stationLabels: z.array(z.string().min(1)).max(10),
  }).strict()).max(25),
  artwork: z.object({ required: z.number().int().nonnegative(), awaitingDesign: z.number().int().nonnegative() }).strict(),
  proof: z.object({ required: z.number().int().nonnegative(), awaitingApproval: z.number().int().nonnegative() }).strict(),
  prepress: z.object({ required: z.number().int().nonnegative(), pending: z.number().int().nonnegative() }).strict(),
  productionJobs: z.array(z.object({
    id: identifierSchema,
    lineItemId: identifierSchema.nullable(),
    stationKey: z.string().min(1),
    stepKey: z.string().min(1),
    status: z.string().min(1),
  }).strict()).max(25),
  productionOverview: z.object({
    totalJobs: z.number().int().nonnegative(),
    queuedJobs: z.number().int().nonnegative(),
    inProductionJobs: z.number().int().nonnegative(),
    completedJobs: z.number().int().nonnegative(),
    stations: z.array(z.object({ stationLabel: z.string().min(1), jobCount: z.number().int().nonnegative() }).strict()).max(10),
    printProgressAvailable: z.boolean(),
    printProgressWarning: z.string().min(1).max(300).optional(),
  }).strict(),
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

export const productPricingToolResultSchema = toolEnvelopeSchema(z.object({
  product: z.object({ id: identifierSchema, name: z.string().min(1).max(255), active: z.boolean(), pricingMethod: z.string().min(1) }).nullable(),
  pricing: z.object({
    status: z.enum(["configuration", "priced", "input_needed", "unavailable"]),
    pricingMethod: z.string().min(1).max(160).nullable(),
    treeVersionId: identifierSchema.nullable(),
    quantity: z.number().int().positive(),
    dimensions: z.object({ widthIn: z.number().finite().positive(), heightIn: z.number().finite().positive() }).strict().nullable(),
    totalCents: z.number().int().nonnegative().nullable(),
    averageUnitCents: z.number().int().nonnegative().nullable(),
    configuration: z.object({
      pricingBasis: z.enum(["per_square_foot", "per_piece", "mixed", "formula", "configured"]),
      measurementMode: z.enum(["dimensions_required", "quantity_only"]),
      dimensionsRequired: z.boolean(), fixedDimensions: z.object({ widthIn: z.number().positive(), heightIn: z.number().positive() }).strict().nullable(),
      baseRates: z.object({ perSquareFootCents: z.number().nonnegative().nullable(), perPieceCents: z.number().nonnegative().nullable(), minimumChargeCents: z.number().nonnegative().nullable() }).strict(),
      quantityBehavior: z.enum(["linear", "tiered", "matrix_tiered"]),
      quantityTiers: z.array(z.object({ minimumQuantity: z.number().int().positive().nullable(), maximumQuantity: z.number().int().positive().nullable(), minimumSquareFeet: z.number().positive().nullable(), perSquareFootCents: z.number().nonnegative().nullable(), perPieceCents: z.number().nonnegative().nullable(), minimumChargeCents: z.number().nonnegative().nullable() }).strict()).max(30),
      matrix: z.object({ dimensions: z.array(z.string().min(1)).max(12), rowCount: z.number().int().nonnegative(), pricingUnit: z.enum(["per_square_foot", "per_piece"]) }).strict().nullable(),
      options: z.array(z.object({ label: z.string().min(1), required: z.boolean(), defaultSelection: z.string().nullable(), availableWhen: z.object({ optionGroup: z.string().min(1), value: z.string().min(1) }).strict().nullable(), choices: z.array(z.object({ label: z.string().min(1), pricingImpactSummary: z.string().nullable() }).strict()).max(30) }).strict()).max(40),
      treeVersionId: identifierSchema, lifecycle: z.string().min(1).max(40),
    }).strict().nullable(),
    inputNeeded: z.array(z.object({ field: z.string().min(1).max(160), label: z.string().min(1).max(160), reason: z.string().min(1).max(500), allowedValues: z.array(z.string().min(1).max(160)).max(30) }).strict()).max(20),
    message: z.string().min(1).max(500),
  }).strict(),
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
  name: "orders.get_summary" | "products.get_summary" | "products.get_pricing" | "reports.operational_summary" | "navigation.get_current_context";
  version: "stage-2";
  readOnly: true;
  inputSchema: TInput;
  resultSchema: TResult;
  maximumResultCount: number;
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
  /** Bound each independent optional read so it cannot consume the core tool deadline. */
  optionalOrderEnrichmentTimeoutMs?: number;
  getProductPricingConfiguration?: (input: { organizationId: string; productId: string }) => Promise<import("../pricing/PricingService").ProductPricingIntrospection>;
  projectProductPrice?: (input: { organizationId: string; productId: string; quantity: number; widthIn?: number; heightIn?: number; pbv2ExplicitSelections: Record<string, unknown>; pbv2TreeVersionIdOverride?: string }) => Promise<{
    pbv2TreeVersionId: string;
    lineTotalCents: number;
    breakdown: { pricingMethod?: string };
    pbv2SnapshotJson: { pricing?: { pricingMethod?: string }; dimensions?: { widthIn?: number; heightIn?: number } };
  }>;
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
  timeoutMs: number,
) {
  const warnings: string[] = ["Some optional workflow details are unavailable for this order."];
  // These reads have no dependency on one another after the tenant-scoped core
  // order has been found. Start them together so one slow optional subsystem
  // does not serially consume the order-summary budget.
  const [lineItems, production, invoices] = await Promise.all([
    optionalOrderEnrichment("lookup_line_items", () => repository.getOrderLineItems?.(organizationId, orderId), log, warnings, "Line-item details are unavailable.", timeoutMs),
    optionalOrderEnrichment("enrich_production", () => repository.getOrderProduction?.(organizationId, orderId), log, warnings, "Production details are unavailable.", timeoutMs),
    optionalOrderEnrichment("enrich_billing", () => repository.getOrderInvoices?.(organizationId, orderId), log, warnings, "Billing details are unavailable.", timeoutMs),
  ]);
  log("enrich_fulfillment", "succeeded");
  log("enrich_artwork", "succeeded");
  return { lineItems, production, invoices, warnings };
}

async function optionalOrderEnrichment<T>(
  step: Extract<OrderSummaryStep, "lookup_line_items" | "enrich_production" | "enrich_billing">,
  load: () => Promise<T | undefined> | undefined,
  log: (step: OrderSummaryStep, outcome: OrderSummaryStepLog["outcome"], error?: unknown) => void,
  warnings: string[],
  warning: string,
  timeoutMs: number,
): Promise<T | undefined> {
  log(step, "started");
  try {
    const pending = Promise.resolve().then(load);
    const value = await withTimeout(pending, timeoutMs);
    if (value === undefined) warnings.push(warning);
    log(step, "succeeded");
    return value;
  } catch (error) {
    warnings.push(warning);
    log(step, "failed", error);
    return undefined;
  }
}

async function withTimeout<T>(pending: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("tool_timeout")), timeoutMs);
  });
  try {
    return await Promise.race([pending, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const normalizedLineItemSchema = z.object({
  id: identifierSchema,
  description: z.string().min(1).max(500),
  productName: z.string().nullable(),
  quantity: z.number().int().nonnegative(),
  status: z.string().min(1),
  workflowState: z.string().min(1),
  lineItemSequence: z.number().int().positive(),
  materialName: z.string().nullable(),
  dimensions: z.object({ widthInches: z.number().positive(), heightInches: z.number().positive() }).nullable(),
  finishedSquareFeet: z.number().finite().nonnegative().nullable(),
  sidedness: z.enum(["single_sided", "double_sided", "unavailable"]),
  stationLabels: z.array(z.string().min(1)).max(10),
}).strict();

const normalizedProductionJobSchema = z.object({
  id: identifierSchema,
  lineItemId: identifierSchema.nullable(),
  stationKey: z.string().min(1),
  stepKey: z.string().min(1),
  status: z.string().min(1),
}).strict();

const normalizedInvoiceSchema = z.object({
  id: identifierSchema,
  number: z.string().min(1),
  status: z.string().min(1),
}).strict();

function trimmed(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function safeOptionalStatus(value: unknown): string {
  // Optional workflow statuses are not authoritative order state. Preserve a
  // well-formed display value, but prevent null/legacy values from failing the
  // summary or implying a trusted status.
  return trimmed(value) ?? "unavailable";
}

function normalizeOptionalRecords<T>(
  values: unknown,
  normalize: (value: unknown) => T | undefined,
  warnings: string[],
  warning: string,
): T[] {
  if (!Array.isArray(values)) {
    warnings.push(warning);
    return [];
  }
  const records: T[] = [];
  for (const value of values) {
    const record = normalize(value);
    if (record) records.push(record);
    else warnings.push(warning);
  }
  return records;
}

function decimalNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}

function lineDimensions(raw: Record<string, unknown>) {
  const widthInches = decimalNumber(raw.width);
  const heightInches = decimalNumber(raw.height);
  if (widthInches === null || heightInches === null || widthInches <= 0 || heightInches <= 0) return null;
  return { widthInches, heightInches };
}

function confirmedSidedness(value: unknown): "single_sided" | "double_sided" | "unavailable" {
  if (!Array.isArray(value)) return "unavailable";
  const selections = value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const option = candidate as Record<string, unknown>;
    const name = trimmed(option.optionName);
    const selected = trimmed(option.value);
    return name && selected && /\b(?:side|sided|print\s+sides?)\b/i.test(name) ? [selected.toLowerCase().replace(/[_-]/g, " ")] : [];
  });
  if (selections.length !== 1) return "unavailable";
  if (/^(?:single|one)\s*(?:side|sided)?$/.test(selections[0]!)) return "single_sided";
  if(/^(?:double|two)\s*(?:side|sided)?$/.test(selections[0]!)) return "double_sided";
  return "unavailable";
}

function stationLabel(key: string): string {
  return key.split(/[_-]/).filter(Boolean).map((part) => part[0]!.toUpperCase() + part.slice(1)).join(" ") || key;
}

function normalizeLineItems(values: unknown, warnings: string[], stationsByLineId: ReadonlyMap<string, string[]>) {
  const indexed = Array.isArray(values)
    ? values.map((value, index) => value && typeof value === "object" ? { ...(value as Record<string, unknown>), lineItemSequence: index + 1 } : value)
    : values;
  return normalizeOptionalRecords(indexed, (value) => {
    if (!value || typeof value !== "object") return undefined;
    const raw = value as Record<string, unknown>;
    const dimensions = lineDimensions(raw);
    const finishedSquareFeet = dimensions
      ? Number(((dimensions.widthInches * dimensions.heightInches * Number(raw.quantity)) / 144).toFixed(4))
      : null;
    const parsed = normalizedLineItemSchema.safeParse({
      id: raw.id,
      description: trimmed(raw.description),
      productName: trimmed(raw.productName) ?? null,
      quantity: raw.quantity,
      status: safeOptionalStatus(raw.status),
      workflowState: safeOptionalStatus(raw.workflowState),
      lineItemSequence: Number(raw.lineItemSequence),
      materialName: trimmed(raw.materialName) ?? null,
      dimensions,
      finishedSquareFeet,
      sidedness: confirmedSidedness(raw.selectedOptions),
      stationLabels: stationsByLineId.get(String(raw.id)) ?? [],
    });
    return parsed.success ? parsed.data : undefined;
  }, warnings, "Malformed line-item details were omitted.");
}

function normalizeProductionJobs(values: unknown, warnings: string[]) {
  return normalizeOptionalRecords(values, (value) => {
    if (!value || typeof value !== "object") return undefined;
    const raw = value as Record<string, unknown>;
    const parsed = normalizedProductionJobSchema.safeParse({
      id: raw.id,
      lineItemId: trimmed(raw.lineItemId) ?? null,
      stationKey: trimmed(raw.stationKey),
      stepKey: trimmed(raw.stepKey),
      status: safeOptionalStatus(raw.status),
    });
    return parsed.success ? parsed.data : undefined;
  }, warnings, "Malformed production details were omitted.");
}

function normalizeInvoices(values: unknown, warnings: string[]) {
  return normalizeOptionalRecords(values, (value) => {
    if (!value || typeof value !== "object") return undefined;
    const raw = value as Record<string, unknown>;
    const parsed = normalizedInvoiceSchema.safeParse({
      id: raw.id,
      number: trimmed(raw.displayNumber) ?? (typeof raw.invoiceNumber === "number" ? String(raw.invoiceNumber) : undefined),
      status: safeOptionalStatus(raw.status),
    });
    return parsed.success ? parsed.data : undefined;
  }, warnings, "Malformed billing details were omitted.");
}

function stationsByLine(production: Array<z.infer<typeof normalizedProductionJobSchema>>): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const job of production) {
    if (!job.lineItemId) continue;
    const labels = result.get(job.lineItemId) ?? [];
    const label = stationLabel(job.stationKey);
    if (!labels.includes(label)) labels.push(label);
    result.set(job.lineItemId, labels);
  }
  return result;
}

function productionOverview(production: Array<z.infer<typeof normalizedProductionJobSchema>>) {
  const normalizedStatus = (status: string) => status.trim().toLowerCase().replace(/[\s-]+/g, "_");
  const counts = { queuedJobs: 0, inProductionJobs: 0, completedJobs: 0 };
  const stationCounts = new Map<string, number>();
  production.forEach((job) => {
    const status = normalizedStatus(job.status);
    if (["queued", "pending", "paused"].includes(status)) counts.queuedJobs += 1;
    else if (["in_progress", "inproduction", "printing", "running"].includes(status)) counts.inProductionJobs += 1;
    else if (["completed", "complete", "done"].includes(status)) counts.completedJobs += 1;
    const label = stationLabel(job.stationKey);
    stationCounts.set(label, (stationCounts.get(label) ?? 0) + 1);
  });
  return {
    totalJobs: production.length,
    ...counts,
    stations: Array.from(stationCounts, ([stationLabel, jobCount]) => ({ stationLabel, jobCount }))
      .sort((left, right) => right.jobCount - left.jobCount || left.stationLabel.localeCompare(right.stationLabel)),
    printProgressAvailable: false,
    printProgressWarning: "Print completion and remaining quantities are unavailable because production records do not contain authoritative completed quantities.",
  };
}

type PricingInputNeeded = { field: string; label: string; reason: string; allowedValues: string[] };

function normalizedPricingLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function publicPricingConfiguration(configuration: ProductPricingIntrospection) {
  return {
    pricingBasis: configuration.pricingBasis,
    measurementMode: configuration.measurementMode,
    dimensionsRequired: configuration.dimensionsRequired,
    fixedDimensions: configuration.fixedDimensions,
    baseRates: configuration.baseRates,
    quantityBehavior: configuration.quantityBehavior,
    quantityTiers: configuration.quantityTiers,
    matrix: configuration.matrix,
    options: configuration.optionGroups.map((group) => ({
      label: group.label,
      required: group.required,
      defaultSelection: typeof group.defaultValue === "string" ? (group.choices.find((choice) => choice.value === group.defaultValue)?.label ?? group.defaultValue) : null,
      availableWhen: group.availableWhen ?? null,
      choices: group.choices.map((choice) => ({ label: choice.label, pricingImpactSummary: choice.pricingImpactSummary })),
    })),
    treeVersionId: configuration.treeVersionId,
    lifecycle: configuration.lifecycle,
  };
}

function pricingInputNeeded(configuration: ProductPricingIntrospection, field: string, label: string, reason: string, allowedValues: string[] = []): PricingInputNeeded {
  return { field, label, reason, allowedValues: allowedValues.slice(0, 30) };
}

function normalizePricingScenario(input: z.infer<typeof productPricingToolInputSchema>, configuration: ProductPricingIntrospection): {
  dimensions: { widthIn?: number; heightIn?: number };
  selections: Record<string, { value: unknown }>;
  inputNeeded: PricingInputNeeded[];
} {
  const inputNeeded: PricingInputNeeded[] = [];
  const semanticDimensionsPresent = input.width !== undefined || input.height !== undefined || input.unit !== undefined;
  const legacyDimensionsPresent = input.widthIn !== undefined || input.heightIn !== undefined;
  if (semanticDimensionsPresent && legacyDimensionsPresent) {
    inputNeeded.push(pricingInputNeeded(configuration, "dimensions", "Dimensions", "Provide either width/height/unit or legacy inch dimensions, not both."));
  }
  const usesFeet = input.unit === "ft";
  const rawWidth = semanticDimensionsPresent ? input.width : input.widthIn;
  const rawHeight = semanticDimensionsPresent ? input.height : input.heightIn;
  if (configuration.dimensionsRequired && (rawWidth === undefined || rawHeight === undefined)) {
    inputNeeded.push(pricingInputNeeded(configuration, "dimensions", "Dimensions", "This product is priced from width and height. Supply both dimensions in inches or feet.", ["in", "ft"]));
  }
  const widthIn = rawWidth === undefined ? undefined : rawWidth * (usesFeet ? 12 : 1);
  const heightIn = rawHeight === undefined ? undefined : rawHeight * (usesFeet ? 12 : 1);
  if ((widthIn !== undefined && (!Number.isFinite(widthIn) || widthIn <= 0)) || (heightIn !== undefined && (!Number.isFinite(heightIn) || heightIn <= 0))) {
    inputNeeded.push(pricingInputNeeded(configuration, "dimensions", "Dimensions", "Width and height must be positive numbers."));
  }
  if ((widthIn !== undefined && widthIn > 10_000) || (heightIn !== undefined && heightIn > 10_000)) {
    inputNeeded.push(pricingInputNeeded(configuration, "dimensions", "Dimensions", "Each dimension must not exceed 10,000 inches."));
  }
  const selections: Record<string, { value: unknown }> = {};
  for (const group of configuration.optionGroups) {
    if (group.defaultValue !== undefined && group.defaultValue !== null && group.defaultValue !== "") selections[group.selectionKey] = { value: group.defaultValue };
  }
  for (const [requestedGroup, rawSelection] of Object.entries(input.optionSelections ?? {})) {
    const group = configuration.optionGroups.find((candidate) => normalizedPricingLabel(candidate.label) === normalizedPricingLabel(requestedGroup) || normalizedPricingLabel(candidate.selectionKey) === normalizedPricingLabel(requestedGroup));
    if (!group) {
      inputNeeded.push(pricingInputNeeded(configuration, `optionSelections.${requestedGroup}`, requestedGroup, "No pricing-relevant option with that label exists for this product.", configuration.optionGroups.map((candidate) => candidate.label)));
      continue;
    }
    const requestedValue = rawSelection && typeof rawSelection === "object" && !Array.isArray(rawSelection) && "value" in rawSelection
      ? (rawSelection as { value?: unknown }).value : rawSelection;
    const choice = typeof requestedValue === "string" ? group.choices.find((candidate) => normalizedPricingLabel(candidate.label) === normalizedPricingLabel(requestedValue) || normalizedPricingLabel(candidate.value) === normalizedPricingLabel(requestedValue)) : undefined;
    if (!choice) {
      inputNeeded.push(pricingInputNeeded(configuration, `optionSelections.${group.label}`, group.label, "Choose one of this product's allowed pricing selections.", group.choices.map((candidate) => candidate.label)));
      continue;
    }
    selections[group.selectionKey] = { value: choice.value };
  }
  for (const group of configuration.optionGroups) {
    if (!group.required || selections[group.selectionKey]?.value !== undefined) continue;
    inputNeeded.push(pricingInputNeeded(configuration, `optionSelections.${group.label}`, group.label, "This pricing selection is required and has no authoritative default.", group.choices.map((choice) => choice.label)));
  }
  return { dimensions: { ...(widthIn !== undefined ? { widthIn } : {}), ...(heightIn !== undefined ? { heightIn } : {}) }, selections, inputNeeded };
}

export function createOrderProductOperationalTools(deps: AssistantOrderProductToolDependencies = {}) {
  const repository = deps.repository ?? new AssistantOrderProductRepository();
  const projectProductPrice = deps.projectProductPrice ?? (async (input) => {
    const { priceLineItem } = await import("../pricing/PricingService");
    return priceLineItem(input) as Promise<{
      pbv2TreeVersionId: string;
      lineTotalCents: number;
      breakdown: { pricingMethod?: string };
      pbv2SnapshotJson: { pricing?: { pricingMethod?: string }; dimensions?: { widthIn?: number; heightIn?: number } };
    }>;
  });
  const getProductPricingConfiguration = deps.getProductPricingConfiguration ?? (async (input) => {
    const { inspectProductPricing } = await import("../pricing/PricingService");
    return inspectProductPricing(input);
  });
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
  const optionalOrderEnrichmentTimeoutMs = deps.optionalOrderEnrichmentTimeoutMs ?? 1_500;

  const ordersGetSummary: Tool<typeof orderSummaryToolInputSchema, typeof orderSummaryToolResultSchema> = {
    definition: { name: "orders.get_summary", version: "stage-2", readOnly: true, inputSchema: orderSummaryToolInputSchema, resultSchema: orderSummaryToolResultSchema, maximumResultCount: 25 },
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
        throw new AssistantToolExecutionError("core_query_failed", "core_query_failed", "lookup_core_order");
      }
      const retrievedAt = now();
      if (!record) return orderSummaryToolResultSchema.parse({
        status: "not_found", data: emptyOrderSummary(), sourceLinks: [], freshness: notFoundFreshness(retrievedAt),
      });

      log("lookup_customer", "succeeded");
      const enrichments = await loadOrderSummaryEnrichments(repository, invocation.organizationId, record.order.id, log, optionalOrderEnrichmentTimeoutMs);
      const production = normalizeProductionJobs(enrichments.production ?? record.production, enrichments.warnings);
      const lineItems = normalizeLineItems(enrichments.lineItems ?? record.lineItems, enrichments.warnings, stationsByLine(production));
      const invoices = normalizeInvoices(enrichments.invoices ?? record.invoices, enrichments.warnings);
      const warnings = enrichments.warnings;
      const number = record.order.displayNumber ?? record.order.orderNumber;
      const billingStatus = safeOptionalStatus(record.order.billingStatus);
      const orderTotal = canViewFinance(invocation.permissions) ? decimalNumber(record.order.total) : null;
      const blockingIssues = billingStatus === "not_ready"
        ? ["Billing is not ready for this order."]
        : [];
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
            state: safeOptionalStatus(record.order.state ?? record.order.status),
            statusPill: trimmed(record.order.statusPillValue) ?? null,
            dueDate: toIso(record.order.dueDate),
            fulfillmentStatus: safeOptionalStatus(record.order.fulfillmentStatus),
            billingStatus,
            priority: safeOptionalStatus(record.order.priority),
            poNumber: trimmed(record.order.poNumber) ?? null,
            jobLabel: trimmed(record.order.label) ?? null,
            orderTotal,
          },
          lineItems,
          artwork: { required: 0, awaitingDesign: 0 },
          proof: { required: 0, awaitingApproval: 0 },
          prepress: { required: 0, pending: 0 },
          productionJobs: production,
          productionOverview: productionOverview(production),
          ...(canViewFinance(invocation.permissions) ? { invoices } : {}),
          blockingIssues,
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
        throw new AssistantToolExecutionError("result_validation_failed", "result_validation_failed", "final_result_validation", true);
      }
    },
  };

  const productsGetSummary: Tool<typeof productSummaryToolInputSchema, typeof productSummaryToolResultSchema> = {
    definition: { name: "products.get_summary", version: "stage-2", readOnly: true, inputSchema: productSummaryToolInputSchema, resultSchema: productSummaryToolResultSchema, maximumResultCount: 25 },
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

  const productsGetPricing: Tool<typeof productPricingToolInputSchema, typeof productPricingToolResultSchema> = {
    definition: { name: "products.get_pricing", version: "stage-2", readOnly: true, inputSchema: productPricingToolInputSchema, resultSchema: productPricingToolResultSchema, maximumResultCount: 1 },
    async execute(invocation, rawInput) {
      const input = productPricingToolInputSchema.parse(rawInput);
      const record = await repository.getProduct(invocation.organizationId, input);
      const retrievedAt = now();
      if (!record) return productPricingToolResultSchema.parse({
        status: "not_found",
        data: { product: null, pricing: { status: "unavailable", pricingMethod: null, treeVersionId: null, quantity: input.quantity ?? 1, dimensions: null, totalCents: null, averageUnitCents: null, configuration: null, inputNeeded: [], message: "No tenant-scoped product matched that reference." } },
        sourceLinks: [], freshness: notFoundFreshness(retrievedAt),
      });
      const quantity = input.quantity ?? 1;
      const pricingMethod = record.product.pricingProfileKey ?? record.product.pricingEngine ?? record.product.pricingMode;
      const sourceLinks = [{ label: record.product.name, href: `/products/${record.product.id}/edit`, entityType: "product" as const, entityId: record.product.id, capturedAt: toIso(record.product.updatedAt) ?? retrievedAt.toISOString() }];
      let configuration: ProductPricingIntrospection;
      try {
        configuration = await getProductPricingConfiguration({ organizationId: invocation.organizationId, productId: record.product.id });
      } catch (error) {
        const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : null;
        const message = code === "PBV2_DRAFT_AMBIGUOUS"
          ? "This inactive product has multiple PBV2 DRAFT versions, so current pricing cannot be selected safely."
          : "Authoritative PBV2 pricing configuration is unavailable for this product.";
        return productPricingToolResultSchema.parse({
          status: "ok",
          data: { product: { id: record.product.id, name: record.product.name, active: record.product.isActive, pricingMethod }, pricing: { status: "unavailable", pricingMethod, treeVersionId: record.product.pbv2ActiveTreeVersionId ?? null, quantity, dimensions: null, totalCents: null, averageUnitCents: null, configuration: null, inputNeeded: [], message } },
          sourceLinks, freshness: { retrievedAt: retrievedAt.toISOString() },
        });
      }
      const publicConfiguration = publicPricingConfiguration(configuration);
      const scenarioRequested = input.quantity !== undefined || input.width !== undefined || input.height !== undefined || input.unit !== undefined || input.widthIn !== undefined || input.heightIn !== undefined || input.optionSelections !== undefined;
      if (!scenarioRequested) return productPricingToolResultSchema.parse({
        status: "ok",
        data: { product: { id: record.product.id, name: record.product.name, active: record.product.isActive, pricingMethod }, pricing: { status: "configuration", pricingMethod, treeVersionId: configuration.treeVersionId, quantity, dimensions: configuration.fixedDimensions, totalCents: null, averageUnitCents: null, configuration: publicConfiguration, inputNeeded: [], message: !record.product.isActive && configuration.lifecycle === "DRAFT" ? "This product is inactive and its pricing is in PBV2 DRAFT status. Here is the current draft configuration." : "Authoritative PBV2 pricing configuration. Provide a semantic scenario only when a calculated price is needed." } },
        sourceLinks, freshness: { retrievedAt: retrievedAt.toISOString() },
      });
      const scenario = normalizePricingScenario(input, configuration);
      if (scenario.inputNeeded.length) return productPricingToolResultSchema.parse({
        status: "ok",
        data: { product: { id: record.product.id, name: record.product.name, active: record.product.isActive, pricingMethod }, pricing: { status: "input_needed", pricingMethod, treeVersionId: configuration.treeVersionId, quantity, dimensions: scenario.dimensions.widthIn && scenario.dimensions.widthIn > 0 && scenario.dimensions.heightIn && scenario.dimensions.heightIn > 0 ? { widthIn: scenario.dimensions.widthIn, heightIn: scenario.dimensions.heightIn } : configuration.fixedDimensions, totalCents: null, averageUnitCents: null, configuration: publicConfiguration, inputNeeded: scenario.inputNeeded, message: "Pricing needs the listed business inputs before an authoritative PBV2 projection can run." } },
        sourceLinks, freshness: { retrievedAt: retrievedAt.toISOString() },
      });
      try {
        const projection = await projectProductPrice({
          organizationId: invocation.organizationId,
          productId: record.product.id,
          quantity,
          ...scenario.dimensions,
          pbv2ExplicitSelections: scenario.selections,
          ...(configuration.lifecycle === "DRAFT" ? { pbv2TreeVersionIdOverride: configuration.treeVersionId } : {}),
        });
        const dimensions = projection.pbv2SnapshotJson.dimensions;
        const widthIn = Number(dimensions?.widthIn);
        const heightIn = Number(dimensions?.heightIn);
        return productPricingToolResultSchema.parse({
          status: "ok",
          data: {
            product: { id: record.product.id, name: record.product.name, active: record.product.isActive, pricingMethod },
            pricing: {
              status: "priced",
              pricingMethod: projection.breakdown.pricingMethod ?? projection.pbv2SnapshotJson.pricing?.pricingMethod ?? pricingMethod,
              treeVersionId: projection.pbv2TreeVersionId,
              quantity,
              dimensions: Number.isFinite(widthIn) && widthIn > 0 && Number.isFinite(heightIn) && heightIn > 0 ? { widthIn, heightIn } : null,
              totalCents: projection.lineTotalCents,
              averageUnitCents: Math.round(projection.lineTotalCents / quantity),
              configuration: publicConfiguration,
              inputNeeded: [],
              message: "Authoritative PBV2 pricing projection for the requested scenario.",
            },
          },
          sourceLinks, freshness: { retrievedAt: retrievedAt.toISOString() },
        });
      } catch (error) {
        const details = error && typeof error === "object" && Array.isArray((error as { details?: unknown }).details) ? (error as { details: Array<{ optionGroup?: unknown; message?: unknown }> }).details : [];
        const inputNeeded = details.flatMap((detail) => {
          const group = typeof detail.optionGroup === "string" ? configuration.optionGroups.find((candidate) => candidate.selectionKey === detail.optionGroup) : undefined;
          return group ? [pricingInputNeeded(configuration, `optionSelections.${group.label}`, group.label, typeof detail.message === "string" ? detail.message : "PBV2 requires this pricing selection.", group.choices.map((choice) => choice.label))] : [];
        });
        return productPricingToolResultSchema.parse({
          status: "ok",
          data: {
            product: { id: record.product.id, name: record.product.name, active: record.product.isActive, pricingMethod },
            pricing: {
              status: inputNeeded.length ? "input_needed" : "unavailable",
              pricingMethod,
              treeVersionId: configuration.treeVersionId,
              quantity,
              dimensions: scenario.dimensions.widthIn && scenario.dimensions.widthIn > 0 && scenario.dimensions.heightIn && scenario.dimensions.heightIn > 0 ? { widthIn: scenario.dimensions.widthIn, heightIn: scenario.dimensions.heightIn } : configuration.fixedDimensions,
              totalCents: null,
              averageUnitCents: null,
              configuration: publicConfiguration,
              inputNeeded,
              message: inputNeeded.length ? "Pricing needs the listed business inputs before an authoritative PBV2 projection can run." : "PBV2 could not calculate an authoritative customer price for that scenario.",
            },
          },
          sourceLinks, freshness: { retrievedAt: retrievedAt.toISOString() },
        });
      }
    },
  };

  const reportsOperationalSummary: Tool<typeof operationalSummaryToolInputSchema, typeof operationalSummaryToolResultSchema> = {
    definition: { name: "reports.operational_summary", version: "stage-2", readOnly: true, inputSchema: operationalSummaryToolInputSchema, resultSchema: operationalSummaryToolResultSchema, maximumResultCount: 10 },
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
    definition: { name: "navigation.get_current_context", version: "stage-2", readOnly: true, inputSchema: currentContextToolInputSchema, resultSchema: currentContextToolResultSchema, maximumResultCount: 1 },
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

  return { ordersGetSummary, productsGetSummary, productsGetPricing, reportsOperationalSummary, navigationGetCurrentContext };
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
          operational: {
            priority: order.priority,
            statusPill: order.statusPill,
            poNumber: order.poNumber,
            jobLabel: order.jobLabel,
            lineItems: result.data.lineItems.map((line) => ({
              sequence: line.lineItemSequence,
              label: line.description,
              productName: line.productName,
              materialName: line.materialName,
              orderedPieces: line.quantity,
              dimensions: line.dimensions,
              finishedSquareFeet: line.finishedSquareFeet,
              sidedness: line.sidedness,
              status: line.status,
              workflowState: line.workflowState,
              stations: line.stationLabels,
            })),
            production: result.data.productionOverview,
            fulfillmentStatus: order.fulfillmentStatus,
            billingStatus: order.billingStatus,
            ...(order.orderTotal !== null ? { orderTotal: order.orderTotal } : {}),
          },
          suggestedPrompts: orderSuggestedPrompts(order.number),
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
    "products.get_pricing": {
      async execute(rawInput, context): Promise<AssistantToolResultEnvelope> {
        const input = assistantProductPricingInputSchema.parse(rawInput);
        const result = await tools.productsGetPricing.execute(toInvocation(context), input);
        if (result.status === "not_found" || !result.data.product) return { status: "not_found", data: null };
        const product = result.data.product;
        const freshness = result.freshness.retrievedAt;
        const sourceLink = result.sourceLinks[0]!;
        const data = assistantProductPricingResultSchema.parse({
          product: entitySummary("product", product.id, product.name, product.active ? "active" : "inactive", sourceLink, freshness, product.pricingMethod),
          active: product.active,
          pricing: result.data.pricing,
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

function orderSuggestedPrompts(orderNumber: string) {
  const orderLabel = /^order\b/i.test(orderNumber) ? orderNumber : `Order ${orderNumber}`;
  return [
    { id: "show_line_item_details", label: "Show line-item details", prompt: `Show line-item details for ${orderLabel}.`, intent: "lookup" as const, contextReference: { entityType: "order" as const, label: orderLabel }, presentationPriority: 1 },
    { id: "show_remaining_work_by_station", label: "Show remaining work by station", prompt: `Show remaining work by station for ${orderLabel}.`, intent: "production_reporting" as const, contextReference: { entityType: "order" as const, label: orderLabel }, presentationPriority: 2 },
    { id: "explain_billing_blockers", label: "Explain billing blockers", prompt: `Explain billing blockers for ${orderLabel}.`, intent: "operational_summary" as const, contextReference: { entityType: "order" as const, label: orderLabel }, presentationPriority: 3 },
  ];
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
  return {
    order: null,
    lineItems: [],
    artwork: { required: 0, awaitingDesign: 0 },
    proof: { required: 0, awaitingApproval: 0 },
    prepress: { required: 0, pending: 0 },
    productionJobs: [],
    productionOverview: { totalJobs: 0, queuedJobs: 0, inProductionJobs: 0, completedJobs: 0, stations: [], printProgressAvailable: false, printProgressWarning: "Print completion and remaining quantities are unavailable because production records do not contain authoritative completed quantities." },
    blockingIssues: [],
  };
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
