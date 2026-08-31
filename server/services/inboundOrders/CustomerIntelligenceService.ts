import {
  inboundCustomerIntelligenceSummarySchema,
  type InboundCustomerIntelligenceSummary,
  type InboundOrderParsedDraft,
} from "@shared/inboundOrdersApi";
import {
  inboundOrdersRepository,
  type InboundCustomerHistoricalContextRow,
  type InboundCustomerSearchResult,
} from "../../storage/inboundOrders.repo";

type CustomerIntelligenceRepository = typeof inboundOrdersRepository & {
  listCustomerHistoricalContext?: (args: {
    organizationId: string;
    customerId: string;
    since: Date;
    maxRecords: number;
  }) => Promise<InboundCustomerHistoricalContextRow[]>;
};

type CountedValue = {
  label: string;
  count: number;
  lastSeenAt: string | null;
  productId?: string | null;
  width?: number | null;
  height?: number | null;
  unit?: string | null;
};

const DEFAULT_SCOPE_MONTHS = 24;
const DEFAULT_MAX_RECORDS = 50;
const CACHE_TTL_MS = 5 * 60 * 1000;
const SUMMARY_ELLIPSIS = "…";

/**
 * Customer intelligence is advisory display data. Keep it compact at the
 * boundary without changing the historical source values it was derived from.
 */
function summaryText(value: unknown, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  if (normalized.length <= maximumLength) return normalized;
  if (maximumLength <= SUMMARY_ELLIPSIS.length) return normalized.slice(0, maximumLength);
  return `${normalized.slice(0, maximumLength - SUMMARY_ELLIPSIS.length).trimEnd()}${SUMMARY_ELLIPSIS}`;
}

function requiredSummaryText(value: unknown, maximumLength: number): string {
  return summaryText(value, maximumLength) ?? "Unknown";
}

function configuredPositiveInteger(value: string | undefined, fallback: number): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : fallback;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function dateString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function addMonths(date: Date, months: number): Date {
  const copy = new Date(date);
  copy.setMonth(copy.getMonth() + months);
  return copy;
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function displayDimension(width: unknown, height: unknown): { label: string; width: number; height: number; unit: string } | null {
  const parsedWidth = numberValue(width);
  const parsedHeight = numberValue(height);
  if (!parsedWidth || !parsedHeight) return null;
  const widthLabel = Number.isInteger(parsedWidth) ? String(parsedWidth) : String(parsedWidth).replace(/0+$/, "").replace(/\.$/, "");
  const heightLabel = Number.isInteger(parsedHeight) ? String(parsedHeight) : String(parsedHeight).replace(/0+$/, "").replace(/\.$/, "");
  return {
    label: `${widthLabel}x${heightLabel}`,
    width: parsedWidth,
    height: parsedHeight,
    unit: "in",
  };
}

function increment(
  map: Map<string, CountedValue>,
  label: string | null | undefined,
  seenAt: string | null,
  extras: Partial<CountedValue> = {},
  maximumLength = 255,
) {
  const clean = summaryText(label, maximumLength);
  if (!clean) return;
  const key = normalizeKey(clean);
  if (!key) return;
  const existing = map.get(key);
  if (!existing) {
    map.set(key, {
      label: clean,
      count: 1,
      lastSeenAt: seenAt,
      ...extras,
    });
    return;
  }
  existing.count += 1;
  if (seenAt && (!existing.lastSeenAt || new Date(seenAt).getTime() > new Date(existing.lastSeenAt).getTime())) {
    existing.lastSeenAt = seenAt;
  }
}

function topValues(map: Map<string, CountedValue>, limit: number): CountedValue[] {
  return Array.from(map.values())
    .sort((left, right) => right.count - left.count || String(right.lastSeenAt ?? "").localeCompare(String(left.lastSeenAt ?? "")))
    .slice(0, limit);
}

function walkUnknown(value: unknown, visitor: (key: string | null, value: unknown) => void, key: string | null = null) {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item) => walkUnknown(item, visitor, key));
    return;
  }
  if (typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value as Record<string, unknown>)) {
      walkUnknown(childValue, visitor, childKey);
    }
    return;
  }
  visitor(key, value);
}

function collectMaterialLabels(row: InboundCustomerHistoricalContextRow): string[] {
  const labels = new Set<string>();
  for (const usage of [...(row.materialUsages ?? []), ...(row.materialUsageJson ?? [])]) {
    const label = text(usage.materialName) ?? text(usage.name) ?? text(usage.label);
    if (label) labels.add(label);
  }
  walkUnknown(row.specsJson, (key, value) => {
    const keyText = normalizeKey(key ?? "");
    if (!/(material|stock|substrate|thickness)/.test(keyText)) return;
    const label = text(value);
    if (label) labels.add(label);
  });
  walkUnknown(row.optionSelectionsJson, (key, value) => {
    const keyText = normalizeKey(key ?? "");
    if (!/(material|stock|substrate|thickness)/.test(keyText)) return;
    const label = text(value);
    if (label && !/^choice_[a-z0-9_]+$/i.test(label)) labels.add(label);
  });
  for (const option of row.selectedOptions ?? []) {
    const optionName = normalizeKey(text(option.optionName) ?? "");
    if (!/(material|stock|substrate|thickness)/.test(optionName)) continue;
    const label = text(option.value) ?? text(option.optionName);
    if (label && !/^choice_[a-z0-9_]+$/i.test(label)) labels.add(label);
  }
  return Array.from(labels);
}

function collectFinishingLabels(row: InboundCustomerHistoricalContextRow): string[] {
  const labels = new Set<string>();
  const finishingPattern = /(finish|finishing|grommet|pocket|laminat|contour|cut|corner|radius|drill|hole|route|mount|hardware|hem|white ink|varnish)/;
  for (const option of row.selectedOptions ?? []) {
    const optionName = text(option.optionName);
    const optionValue = text(option.value);
    const combined = normalizeKey([optionName, optionValue].filter(Boolean).join(" "));
    if (finishingPattern.test(combined)) {
      labels.add([optionName, optionValue].filter(Boolean).join(": "));
    }
  }
  walkUnknown(row.specsJson, (key, value) => {
    const keyText = normalizeKey(key ?? "");
    if (!finishingPattern.test(keyText)) return;
    const label = text(value);
    if (label) labels.add(label);
  });
  return Array.from(labels);
}

function collectTerms(row: InboundCustomerHistoricalContextRow): string[] {
  const source = [
    row.productName,
    row.description,
    JSON.stringify(row.specsJson ?? {}),
  ].filter(Boolean).join(" ").toLowerCase();
  const stop = new Set(["the", "and", "with", "for", "print", "printed", "sign", "signs", "order", "quote", "please", "need", "needs"]);
  const terms = source
    .replace(/[^a-z0-9/.\s-]/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3 && !stop.has(item) && !/^\d+$/.test(item));
  return Array.from(new Set(terms));
}

function isSingleStrongResult(results: Array<{ id: string; confidence: number }>, minimumConfidence: number): string | null {
  const sorted = results
    .filter((item) => item.confidence >= minimumConfidence)
    .sort((left, right) => right.confidence - left.confidence);
  if (sorted.length === 0) return null;
  if (sorted.length > 1 && sorted[0].confidence - sorted[1].confidence < 6) return null;
  return sorted[0].id;
}

export class CustomerIntelligenceService {
  private readonly cache = new Map<string, { expiresAt: number; summary: InboundCustomerIntelligenceSummary }>();

  constructor(
    private readonly repository: CustomerIntelligenceRepository = inboundOrdersRepository,
    private readonly defaults = {
      scopeMonths: configuredPositiveInteger(process.env.INBOUND_CUSTOMER_INTELLIGENCE_SCOPE_MONTHS, DEFAULT_SCOPE_MONTHS),
      maxRecords: configuredPositiveInteger(process.env.INBOUND_CUSTOMER_INTELLIGENCE_MAX_RECORDS, DEFAULT_MAX_RECORDS),
    },
  ) {}

  async buildSummary(args: {
    organizationId: string;
    customerId: string;
    scopeMonths?: number;
    maxRecords?: number;
  }): Promise<InboundCustomerIntelligenceSummary | null> {
    if (typeof (this.repository as any).getCustomer !== "function") return null;
    const scopeMonths = args.scopeMonths ?? this.defaults.scopeMonths;
    const maxRecords = args.maxRecords ?? this.defaults.maxRecords;
    const cacheKey = `${args.organizationId}:${args.customerId}:${scopeMonths}:${maxRecords}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.summary;

    const customer = await this.repository.getCustomer(args.organizationId, args.customerId);
    if (!customer) return null;
    const since = addMonths(new Date(), -scopeMonths);
    const rows = this.repository.listCustomerHistoricalContext
      ? await this.repository.listCustomerHistoricalContext({
        organizationId: args.organizationId,
        customerId: args.customerId,
        since,
        maxRecords,
      })
      : [];

    const summary = this.summarizeRows({
      customer: {
        id: customer.id,
        companyName: customer.companyName,
        email: customer.email ?? null,
      },
      rows,
      scopeMonths,
      maxRecords,
    });
    this.cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, summary });
    return summary;
  }

  async buildSummaryForParsedDraft(args: {
    organizationId: string;
    draft: InboundOrderParsedDraft;
  }): Promise<InboundCustomerIntelligenceSummary | null> {
    const customerId = isSingleStrongResult(
      args.draft.customer.customerCandidates.map((candidate) => ({
        id: candidate.id,
        confidence: candidate.confidence,
      })),
      88,
    );
    return customerId
      ? this.buildSummary({ organizationId: args.organizationId, customerId })
      : null;
  }

  async buildSummaryForSourceEvidence(args: {
    organizationId: string;
    senderEmail?: string | null;
    senderName?: string | null;
    companyName?: string | null;
  }): Promise<InboundCustomerIntelligenceSummary | null> {
    if (typeof (this.repository as any).searchCustomers !== "function") return null;
    const matches = new Map<string, { id: string; confidence: number }>();
    const addMatches = (results: InboundCustomerSearchResult[], confidence: number) => {
      for (const result of results) {
        const existing = matches.get(result.id);
        matches.set(result.id, { id: result.id, confidence: Math.max(existing?.confidence ?? 0, confidence) });
      }
    };

    const senderEmail = args.senderEmail?.trim() || null;
    const senderDomain = senderEmail?.split("@")[1]?.trim() || null;
    if (senderEmail) addMatches(await this.repository.searchCustomers(args.organizationId, senderEmail, 5), 94);
    if (senderDomain) addMatches(await this.repository.searchCustomers(args.organizationId, senderDomain, 5), 88);
    if (args.companyName?.trim()) addMatches(await this.repository.searchCustomers(args.organizationId, args.companyName, 5), 90);
    if (args.senderName?.trim()) addMatches(await this.repository.searchCustomers(args.organizationId, args.senderName, 5), 84);

    const customerId = isSingleStrongResult(Array.from(matches.values()), 88);
    return customerId
      ? this.buildSummary({ organizationId: args.organizationId, customerId })
      : null;
  }

  private summarizeRows(args: {
    customer: { id: string; companyName: string; email: string | null };
    rows: InboundCustomerHistoricalContextRow[];
    scopeMonths: number;
    maxRecords: number;
  }): InboundCustomerIntelligenceSummary {
    const products = new Map<string, CountedValue>();
    const materials = new Map<string, CountedValue>();
    const dimensions = new Map<string, CountedValue>();
    const finishing = new Map<string, CountedValue>();
    const terminology = new Map<string, CountedValue>();
    const recentProducts = new Map<string, CountedValue>();
    const recentReferences = new Map<string, {
      sourceType: "order" | "quote";
      sourceId: string;
      reference: string;
      createdAt: string | null;
      productSummary: string | null;
    }>();

    for (const row of args.rows) {
      const seenAt = dateString(row.createdAt);
      const productLabel = summaryText(text(row.productName) ?? text(row.description), 255);
      const productKey = row.productId ?? normalizeKey(productLabel ?? "");
      if (productLabel) {
        increment(products, productLabel, seenAt, { productId: row.productId });
        if (productKey && !recentProducts.has(productKey)) {
          recentProducts.set(productKey, {
            label: productLabel,
            productId: row.productId,
            count: 1,
            lastSeenAt: seenAt,
          });
        }
      }

      const dimension = displayDimension(row.width, row.height);
      if (dimension) {
        increment(dimensions, dimension.label, seenAt, {
          width: dimension.width,
          height: dimension.height,
          unit: dimension.unit,
        }, 120);
      }

      for (const material of collectMaterialLabels(row)) increment(materials, material, seenAt, {}, 255);
      for (const finish of collectFinishingLabels(row)) increment(finishing, finish, seenAt, {}, 255);
      for (const term of collectTerms(row)) increment(terminology, term, seenAt, {}, 120);

      const reference = requiredSummaryText(text(row.reference) ?? row.sourceId.slice(0, 8), 120);
      const referenceKey = `${row.sourceType}:${row.sourceId}`;
      if (!recentReferences.has(referenceKey)) {
        recentReferences.set(referenceKey, {
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          reference,
          createdAt: seenAt,
          productSummary: productLabel,
        });
      }
    }

    return inboundCustomerIntelligenceSummarySchema.parse({
      customer: {
        id: args.customer.id,
        companyName: summaryText(args.customer.companyName, 255) ?? args.customer.companyName,
        email: summaryText(args.customer.email, 255),
      },
      scopeMonths: args.scopeMonths,
      maxRecords: args.maxRecords,
      recordCount: args.rows.length,
      generatedAt: new Date().toISOString(),
      recentProducts: Array.from(recentProducts.values()).slice(0, 6).map((item) => ({
        productId: item.productId ?? null,
        label: item.label,
        lastSeenAt: item.lastSeenAt,
      })),
      frequentProducts: topValues(products, 6).map((item) => ({
        productId: item.productId ?? null,
        label: item.label,
        count: item.count,
        lastSeenAt: item.lastSeenAt,
      })),
      frequentMaterials: topValues(materials, 6).map((item) => ({
        label: item.label,
        count: item.count,
        lastSeenAt: item.lastSeenAt,
      })),
      frequentDimensions: topValues(dimensions, 6).map((item) => ({
        label: item.label,
        width: item.width ?? null,
        height: item.height ?? null,
        unit: item.unit ?? null,
        count: item.count,
        lastSeenAt: item.lastSeenAt,
      })),
      frequentFinishing: topValues(finishing, 6).map((item) => ({
        label: item.label,
        count: item.count,
        lastSeenAt: item.lastSeenAt,
      })),
      commonTerminology: topValues(terminology, 8).map((item) => ({
        term: item.label,
        count: item.count,
      })),
      recentOrderReferences: Array.from(recentReferences.values()).slice(0, 6),
    });
  }
}

export const customerIntelligenceService = new CustomerIntelligenceService();
