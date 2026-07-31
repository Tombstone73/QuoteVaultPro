import { createHash } from "node:crypto";

const volatileSnapshotFields = new Set(["pricedAt", "capturedAt"]);
const displayOnlySnapshotFields = new Set(["label", "optionName", "choiceLabel", "description", "helpText", "badge", "title", "name"]);
const sortableSelectionArrays = new Set(["selectedOptions", "selectedOptionIds", "optionIds", "choiceIds", "selectionIds", "visibleNodeIds", "value"]);

function canonicalValue(value: unknown, key?: string, omitFields = volatileSnapshotFields): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const entries = value.map((entry) => canonicalValue(entry, undefined, omitFields));
    return key && sortableSelectionArrays.has(key)
      ? entries.slice().sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
      : entries;
  }
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record)
    .filter((entry) => !omitFields.has(entry) && record[entry] !== undefined && record[entry] !== null)
    .sort()
    .map((entry) => [entry, canonicalValue(record[entry], entry, omitFields)]));
}

const canonicalPricingSnapshot = (value: unknown) => canonicalValue(value, undefined, new Set(Array.from(volatileSnapshotFields).concat(Array.from(displayOnlySnapshotFields))));

const cents = (value: unknown) => Math.round(Number(value ?? 0) * 100);

/**
 * Stable server-only fingerprint source for a direct order proposal. PBV2
 * timestamps are presentation/audit metadata, not pricing inputs, so they are
 * deliberately excluded; all price, product, snapshot, selection, and tax
 * inputs remain bound here.
 */
export function fingerprintDirectOrderProposal(input: {
  intake: unknown;
  organization: { id: string; defaultTaxRate?: unknown; taxEnabled?: unknown };
  customer: { id?: unknown; isTaxExempt?: unknown; taxRateOverride?: unknown; pricingTier?: unknown } | null;
  contact: { id?: unknown; customerId?: unknown } | null;
  priced: Array<{
    line: unknown;
    product: { id: string; isActive?: unknown; updatedAt?: unknown; pbv2ActiveTreeVersionId?: unknown; measurementMode?: unknown; isTaxable?: unknown };
    treeVersionUpdatedAt?: unknown;
    result: { pbv2TreeVersionId: string; lineTotalCents: number; breakdown?: unknown; pbv2SnapshotJson: unknown };
  }>;
  totals: { subtotal?: unknown; taxableSubtotal?: unknown; taxRate?: unknown; taxAmount?: unknown; total?: unknown; lineItemsWithTax?: Array<{ lineTotal?: unknown; taxAmount?: unknown; isTaxableSnapshot?: unknown }> };
}) {
  const source = {
    intake: canonicalValue(input.intake),
    organization: {
      id: input.organization.id,
      defaultTaxRate: Number(input.organization.defaultTaxRate ?? 0),
      taxEnabled: input.organization.taxEnabled ?? true,
    },
    customer: input.customer ? canonicalValue({
      id: input.customer.id,
      isTaxExempt: input.customer.isTaxExempt ?? false,
      taxRateOverride: input.customer.taxRateOverride ?? null,
      pricingTier: input.customer.pricingTier ?? null,
    }) : null,
    contact: input.contact ? canonicalValue({ id: input.contact.id, customerId: input.contact.customerId ?? null }) : null,
    priced: input.priced.map(({ line, product, treeVersionUpdatedAt, result }) => canonicalValue({
      line,
      product: {
        id: product.id,
        isActive: product.isActive ?? false,
        updatedAt: product.updatedAt ?? null,
        pbv2ActiveTreeVersionId: product.pbv2ActiveTreeVersionId ?? null,
        measurementMode: product.measurementMode ?? null,
        isTaxable: product.isTaxable ?? true,
      },
      treeVersionUpdatedAt: treeVersionUpdatedAt ?? null,
      treeVersionId: result.pbv2TreeVersionId,
      lineTotalCents: Math.round(result.lineTotalCents),
      breakdown: result.breakdown ?? null,
      pricingSnapshot: canonicalPricingSnapshot(result.pbv2SnapshotJson),
    })),
    totals: {
      subtotalCents: cents(input.totals.subtotal),
      taxableSubtotalCents: cents(input.totals.taxableSubtotal),
      taxRate: Number(input.totals.taxRate ?? 0),
      taxCents: cents(input.totals.taxAmount),
      totalCents: cents(input.totals.total),
      lineItems: (input.totals.lineItemsWithTax ?? []).map((line) => ({ lineTotalCents: cents(line.lineTotal), taxCents: cents(line.taxAmount), isTaxableSnapshot: Boolean(line.isTaxableSnapshot) })),
    },
  };
  return createHash("sha256").update(JSON.stringify(source)).digest("hex");
}

export const canonicalDirectOrderProposalFingerprintSource = canonicalValue;
