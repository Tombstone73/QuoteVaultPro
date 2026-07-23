export type BundleLineItem = {
  id?: string | null;
  parentLineItemId?: string | null;
  lineItemRole?: "standalone" | "parent" | "child" | string | null;
  parentPriceMode?: "sum_children" | "manual_override" | string | null;
  childDisplayMode?: "hidden" | "visible_summary" | "visible_detail" | string | null;
  linePrice?: unknown;
  totalPrice?: unknown;
  status?: string | null;
  isTaxableSnapshot?: boolean | null;
};

const toCents = (value: unknown) => {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? Math.round(numberValue * 100) : 0;
};

export function getLineItemCents(line: BundleLineItem): number {
  return toCents(line.totalPrice ?? line.linePrice);
}

export function calculateBundleChildTotalCents(children: BundleLineItem[]): number {
  return children
    .filter((line) => line.status !== "canceled")
    .reduce((total, line) => total + getLineItemCents(line), 0);
}

/** Roots are the only billable rows. Children retain their internal data, but
 * are never included again in financial rollups. */
type BundleMembership = Pick<BundleLineItem, "id" | "parentLineItemId" | "lineItemRole" | "childDisplayMode">;

export function getBillableBundleRoots<T extends BundleMembership>(lineItems: T[]): T[] {
  return lineItems.filter((line) => line.lineItemRole !== "child" && !line.parentLineItemId);
}

export function getCustomerVisibleBundleLines<T extends BundleMembership>(lineItems: T[]): T[] {
  const byId = new Map<string, T>(lineItems
    .filter((line): line is T & { id: string } => typeof line.id === "string")
    .map((line) => [line.id, line]));
  return lineItems.filter((line) => {
    if (line.lineItemRole !== "child" && !line.parentLineItemId) return true;
    const parent = line.parentLineItemId ? byId.get(line.parentLineItemId) : undefined;
    return Boolean(parent && parent.childDisplayMode !== "hidden");
  });
}

export function parentBundlePricingUpdate(parent: BundleLineItem, children: BundleLineItem[]) {
  const childCalculatedTotalCents = calculateBundleChildTotalCents(children);
  const effectiveTotalCents = parent.parentPriceMode === "manual_override"
    ? getLineItemCents(parent)
    : childCalculatedTotalCents;
  return {
    childCalculatedTotalCents,
    effectiveTotalCents,
    unitPrice: effectiveTotalCents / 100,
    totalPrice: effectiveTotalCents / 100,
  };
}
