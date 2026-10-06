import { currentProductionStatusPillBucket } from "../services/dailyProductionReportStatus";
import { getBillableBundleRoots } from "../services/lineItemBundles";

export type ActiveProductionValue = {
  totalCents: number;
  newCents: number;
  inProductionCents: number;
};

export type ActiveProductionValueLine = {
  id: string;
  orderId: string;
  organizationId: string;
  orderState: string;
  orderStatus: string;
  orderCanceledAt: Date | string | null;
  statusPillId: string | null;
  statusPillKey: string | null;
  statusPillValue: string | null;
  workflowState: string;
  lifecycleStatus: string;
  lineItemRole: string;
  parentLineItemId: string | null;
  parentPriceMode: string;
  valueCents: number | string;
};

export type ActiveProductionContribution = {
  lineId: string;
  orderId: string;
  parentLineItemId: string | null;
  bucket: "new" | "in_production";
  valueCents: number;
};

/** One commercial Order line is one value contribution, regardless of how many
 * production Jobs or Combined Runs represent its operational work. */
export function projectActiveProductionValueContributions(
  organizationId: string,
  lines: readonly ActiveProductionValueLine[],
): ActiveProductionContribution[] {
  // The Orders list displays a terminal badge instead of a pill for these
  // states. For all other Orders, the persisted pill alone chooses the bucket.
  const pillSelectedLines = lines.filter((line) => line.organizationId === organizationId
    && line.orderState !== "closed" && line.orderState !== "canceled"
    && !line.orderCanceledAt && line.orderStatus !== "operationally_complete"
    && (line.statusPillId || line.statusPillValue?.trim())
    && currentProductionStatusPillBucket({
      statusPillId: line.statusPillId,
      statusPillKey: line.statusPillKey,
      statusPillValue: line.statusPillValue,
      status: line.orderStatus,
    }) !== null);
  const billableLines = getBillableBundleRoots(pillSelectedLines.map((line) => ({
    ...line, status: line.lifecycleStatus,
  })));
  return billableLines.map((line) => {
    // PostgreSQL rounds persisted DECIMAL(10, 2) to integer cents.
    const cents = Number(line.valueCents);
    if (!Number.isSafeInteger(cents) || cents < 0) {
      throw new Error("Invalid persisted Order line selling value");
    }
    const bucket = currentProductionStatusPillBucket({
      statusPillId: line.statusPillId, statusPillKey: line.statusPillKey,
      statusPillValue: line.statusPillValue, status: line.orderStatus,
    })!;
    return { lineId: line.id, orderId: line.orderId, parentLineItemId: line.parentLineItemId, bucket, valueCents: cents };
  });
}

export function projectActiveProductionValue(
  organizationId: string,
  lines: readonly ActiveProductionValueLine[],
): ActiveProductionValue {
  const result = { totalCents: 0, newCents: 0, inProductionCents: 0 };
  for (const entry of projectActiveProductionValueContributions(organizationId, lines)) {
    if (entry.bucket === "new") result.newCents += entry.valueCents;
    else result.inProductionCents += entry.valueCents;
  }
  result.totalCents = result.newCents + result.inProductionCents;
  if (![result.newCents, result.inProductionCents, result.totalCents].every(Number.isSafeInteger)) {
    throw new Error("Active Production Value exceeds safe integer cents");
  }
  return result;
}
