import type {
  DesignCostState,
  LineItemDesignBillingStatus,
  LineItemDesignCostSummary,
} from "@shared/schema";

import { buildDesignWorkspaceState, type DesignWorkspaceAuditRow } from "./designWorkspaceState";
import {
  designCostSummaryRepository,
  type DesignCostSummaryLineItemContext,
  type OrderDesignBillingVisibilityRow,
} from "../storage/designCostSummary.repo";

const roundToTwo = (value: number): number => Math.round(value * 100) / 100;

const toNumber = (value: string | number | null | undefined): number | null => {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toDecimalString = (value: number | null): string | null => {
  if (value == null) return null;
  return roundToTwo(value).toFixed(2);
};

const toIsoString = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  return new Date(value).toISOString();
};

const normalizeMoney = (value: string | number | null | undefined): number | null => {
  const numeric = toNumber(value);
  return numeric == null ? null : roundToTwo(numeric);
};

const deriveEffectiveRequiresDesign = (context: DesignCostSummaryLineItemContext): boolean => (
  context.needsDesignOverride ?? context.requiresDesignSnapshot
);

const deriveDesignCostState = (args: {
  effectiveRequiresDesign: boolean;
  correctedTrackedMinutes: number;
  existingState: DesignCostState | null;
}): DesignCostState => {
  if (args.existingState === "finalized") {
    return "finalized";
  }

  if (!args.effectiveRequiresDesign) {
    return "not_applicable";
  }

  return args.correctedTrackedMinutes > 0 ? "accrued" : "estimated";
};

const deriveQuotedDesignAmount = (context: DesignCostSummaryLineItemContext, effectiveRequiresDesign: boolean): number | null => {
  if (!effectiveRequiresDesign) {
    return null;
  }

  if (context.quotedDesignPricingModeSnapshot !== "flat_fee") {
    return null;
  }

  return normalizeMoney(context.quotedFlatFeeAmountSnapshot);
};

const deriveSoldDesignAmount = (context: DesignCostSummaryLineItemContext, effectiveRequiresDesign: boolean): number | null => {
  if (!effectiveRequiresDesign) {
    return null;
  }

  if (context.designPricingModeSnapshot !== "flat_fee") {
    return null;
  }

  return normalizeMoney(context.flatFeeAmountSnapshot);
};

const deriveBillingSummary = (args: {
  context: DesignCostSummaryLineItemContext;
  effectiveRequiresDesign: boolean;
  correctedTrackedMinutes: number;
  existingStatus: LineItemDesignBillingStatus | null;
}) => {
  if (["approved_for_invoice", "invoiced", "waived"].includes(args.existingStatus ?? "")) {
    return {
      billableDesignMinutes: null as number | null,
      billableDesignAmount: null as number | null,
      billingStatus: args.existingStatus as LineItemDesignBillingStatus,
    };
  }

  if (!args.effectiveRequiresDesign) {
    return {
      billableDesignMinutes: 0,
      billableDesignAmount: 0,
      billingStatus: "not_billable" as LineItemDesignBillingStatus,
    };
  }

  const hourlyRate = normalizeMoney(args.context.hourlyRateSnapshot);
  const overageRate = normalizeMoney(args.context.overageRateSnapshot);
  const includedMinutes = toNumber(args.context.includedDesignMinutesSnapshot);
  const correctedTrackedMinutes = roundToTwo(args.correctedTrackedMinutes);

  switch (args.context.designPricingModeSnapshot) {
    case "none":
      return {
        billableDesignMinutes: 0,
        billableDesignAmount: 0,
        billingStatus: "not_billable" as LineItemDesignBillingStatus,
      };
    case "flat_fee":
      return {
        billableDesignMinutes: 0,
        billableDesignAmount: 0,
        billingStatus: "not_billable" as LineItemDesignBillingStatus,
      };
    case "included_minutes_plus_overage": {
      if (includedMinutes == null) {
        return {
          billableDesignMinutes: null,
          billableDesignAmount: null,
          billingStatus: correctedTrackedMinutes > 0 ? "candidate" as LineItemDesignBillingStatus : "not_billable" as LineItemDesignBillingStatus,
        };
      }

      const overageMinutes = roundToTwo(Math.max(correctedTrackedMinutes - includedMinutes, 0));
      if (overageMinutes <= 0) {
        return {
          billableDesignMinutes: 0,
          billableDesignAmount: 0,
          billingStatus: "not_billable" as LineItemDesignBillingStatus,
        };
      }

      return {
        billableDesignMinutes: overageMinutes,
        billableDesignAmount: overageRate == null ? null : roundToTwo((overageMinutes / 60) * overageRate),
        billingStatus: "candidate" as LineItemDesignBillingStatus,
      };
    }
    case "hourly":
      return {
        billableDesignMinutes: correctedTrackedMinutes,
        billableDesignAmount: hourlyRate == null ? null : roundToTwo((correctedTrackedMinutes / 60) * hourlyRate),
        billingStatus: correctedTrackedMinutes > 0 ? "candidate" as LineItemDesignBillingStatus : "not_billable" as LineItemDesignBillingStatus,
      };
    case "manual_quote":
      return {
        billableDesignMinutes: correctedTrackedMinutes > 0 ? correctedTrackedMinutes : null,
        billableDesignAmount: null,
        billingStatus: correctedTrackedMinutes > 0 ? "candidate" as LineItemDesignBillingStatus : "not_billable" as LineItemDesignBillingStatus,
      };
    default:
      return {
        billableDesignMinutes: null,
        billableDesignAmount: null,
        billingStatus: "not_billable" as LineItemDesignBillingStatus,
      };
  }
};

const normalizeSummaryRow = (row: LineItemDesignCostSummary | null) => {
  if (!row) {
    return null;
  }

  return {
    designCostState: row.designCostState,
    actualTrackedMinutes: roundToTwo(Number(row.actualTrackedMinutes)),
    correctedTrackedMinutes: roundToTwo(Number(row.correctedTrackedMinutes)),
    internalDesignCostCalculated: normalizeMoney(row.internalDesignCostCalculated),
    quotedDesignAmount: normalizeMoney(row.quotedDesignAmount),
    soldDesignAmount: normalizeMoney(row.soldDesignAmount),
    billableDesignMinutes: row.billableDesignMinutes == null ? null : roundToTwo(Number(row.billableDesignMinutes)),
    billableDesignAmount: normalizeMoney(row.billableDesignAmount),
    billingStatus: row.billingStatus,
    lastSyncedAt: toIsoString(row.lastSyncedAt),
  };
};

export type DesignCostSummaryReadModel = NonNullable<ReturnType<typeof normalizeSummaryRow>>;

const normalizeMinutes = (value: string | number | null | undefined): number | null => {
  const numeric = toNumber(value);
  return numeric == null ? null : roundToTwo(numeric);
};

const deriveVisibilityState = (row: OrderDesignBillingVisibilityRow): "not_applicable" | "no_summary" | "available" => {
  const effectiveRequiresDesign = row.needsDesignOverride ?? row.requiresDesignSnapshot;
  if (!effectiveRequiresDesign) {
    return "not_applicable";
  }

  return row.designCostState == null ? "no_summary" : "available";
};

export type OrderDesignBillingVisibilityItem = {
  lineItemId: string;
  orderId: string;
  description: string | null;
  quantity: number;
  productName: string | null;
  effectiveRequiresDesign: boolean;
  designPricingModeSnapshot: string | null;
  visibilityState: "not_applicable" | "no_summary" | "available";
  designCostState: DesignCostState | null;
  correctedTrackedMinutes: number | null;
  soldDesignAmount: number | null;
  billableDesignMinutes: number | null;
  billableDesignAmount: number | null;
  billingStatus: LineItemDesignBillingStatus | null;
  lastSyncedAt: string | null;
};

export async function listOrderDesignBillingVisibility(args: {
  organizationId: string;
  orderId: string;
  executor?: any;
}): Promise<OrderDesignBillingVisibilityItem[] | null> {
  const rows = await designCostSummaryRepository.listOrderVisibilityRows(
    args.organizationId,
    args.orderId,
    args.executor,
  );

  if (rows.length === 0) {
    return null;
  }

  // Service/fee products are invoiceable order charges, not design work. Keep
  // them out of the design-billing diagnostic entirely instead of rendering a
  // misleading "Not applicable" row.
  return rows.filter((row) => row.workflowIntent !== "service_fee").map((row) => ({
    lineItemId: row.lineItemId,
    orderId: row.orderId,
    description: row.description,
    quantity: row.quantity,
    productName: row.productName,
    effectiveRequiresDesign: row.needsDesignOverride ?? row.requiresDesignSnapshot,
    designPricingModeSnapshot: row.designPricingModeSnapshot,
    visibilityState: deriveVisibilityState(row),
    designCostState: (row.designCostState as DesignCostState | null) ?? null,
    correctedTrackedMinutes: normalizeMinutes(row.correctedTrackedMinutes),
    soldDesignAmount: normalizeMoney(row.soldDesignAmount),
    billableDesignMinutes: normalizeMinutes(row.billableDesignMinutes),
    billableDesignAmount: normalizeMoney(row.billableDesignAmount),
    billingStatus: (row.billingStatus as LineItemDesignBillingStatus | null) ?? null,
    lastSyncedAt: toIsoString(row.lastSyncedAt),
  }));
}

export async function getDesignCostSummaryByLineItemId(args: {
  organizationId: string;
  lineItemId: string;
  executor?: any;
}): Promise<DesignCostSummaryReadModel | null> {
  const row = await designCostSummaryRepository.getPersistedByLineItemId(
    args.organizationId,
    args.lineItemId,
    args.executor,
  );

  return normalizeSummaryRow(row);
}

export async function buildDesignCostSummary(args: {
  organizationId: string;
  lineItemId: string;
  auditRows?: DesignWorkspaceAuditRow[];
  executor?: any;
}) {
  const context = await designCostSummaryRepository.getLineItemContext(
    args.organizationId,
    args.lineItemId,
    args.executor,
  );

  if (!context) {
    return null;
  }

  const auditRows = args.auditRows ?? await designCostSummaryRepository.listDesignAuditRows(
    args.organizationId,
    args.lineItemId,
    args.executor,
  );
  const workspace = buildDesignWorkspaceState({
    lineItem: {
      workflowState: context.workflowState,
      designStatus: context.designStatus,
    },
    auditRows,
  });
  const existingRow = await designCostSummaryRepository.getPersistedByLineItemId(
    args.organizationId,
    args.lineItemId,
    args.executor,
  );

  const actualTrackedMinutes = roundToTwo(workspace.rawTrackedMs / 60_000);
  const correctedTrackedMinutes = roundToTwo(workspace.totalTrackedMs / 60_000);
  const effectiveRequiresDesign = deriveEffectiveRequiresDesign(context);
  const internalLaborRate = normalizeMoney(context.internalLaborRateSnapshot);
  const quotedDesignAmount = deriveQuotedDesignAmount(context, effectiveRequiresDesign);
  const soldDesignAmount = deriveSoldDesignAmount(context, effectiveRequiresDesign);
  const billing = deriveBillingSummary({
    context,
    effectiveRequiresDesign,
    correctedTrackedMinutes,
    existingStatus: existingRow?.billingStatus ?? null,
  });

  return {
    organizationId: args.organizationId,
    orderId: context.orderId,
    lineItemId: context.lineItemId,
    designCostState: deriveDesignCostState({
      effectiveRequiresDesign,
      correctedTrackedMinutes,
      existingState: existingRow?.designCostState ?? null,
    }),
    actualTrackedMinutes,
    correctedTrackedMinutes,
    internalDesignCostCalculated:
      internalLaborRate == null ? null : roundToTwo((correctedTrackedMinutes / 60) * internalLaborRate),
    quotedDesignAmount,
    soldDesignAmount,
    billableDesignMinutes: billing.billableDesignMinutes == null ? null : roundToTwo(billing.billableDesignMinutes),
    billableDesignAmount: billing.billableDesignAmount == null ? null : roundToTwo(billing.billableDesignAmount),
    billingStatus: billing.billingStatus,
  };
}

export async function syncDesignCostSummary(args: {
  organizationId: string;
  lineItemId: string;
  auditRows?: DesignWorkspaceAuditRow[];
  executor?: any;
}): Promise<DesignCostSummaryReadModel | null> {
  const summary = await buildDesignCostSummary(args);

  if (!summary) {
    return null;
  }

  const now = new Date();
  const row = await designCostSummaryRepository.upsertSummary(
    {
      organizationId: summary.organizationId,
      orderId: summary.orderId,
      lineItemId: summary.lineItemId,
      designCostState: summary.designCostState,
      actualTrackedMinutes: toDecimalString(summary.actualTrackedMinutes) ?? "0.00",
      correctedTrackedMinutes: toDecimalString(summary.correctedTrackedMinutes) ?? "0.00",
      internalDesignCostCalculated: toDecimalString(summary.internalDesignCostCalculated),
      quotedDesignAmount: toDecimalString(summary.quotedDesignAmount),
      soldDesignAmount: toDecimalString(summary.soldDesignAmount),
      billableDesignMinutes: toDecimalString(summary.billableDesignMinutes),
      billableDesignAmount: toDecimalString(summary.billableDesignAmount),
      billingStatus: summary.billingStatus,
      lastSyncedAt: now,
    },
    args.executor,
  );

  return normalizeSummaryRow(row);
}
