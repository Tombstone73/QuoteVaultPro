import {
  formatScaledDecimal, otherPurchaseChargeKey, roundPurchaseDecimal, scaledDecimal,
  type ActualPurchaseCost, type PurchaseAllocation, type PurchaseOtherCharge,
} from "./purchaseOrderWorkflow";

export type PurchaseLandedLine = {
  materialId?: string | null;
  purchaseUnit?: string | null;
  quantityOrdered: string;
  lineTotal: string;
  inventoryUnitsPerPurchaseUnit: string;
  manualLandedAmount?: string;
};

type LandedOrder = {
  shippingTotal: string;
  otherCharges: PurchaseOtherCharge[];
  landedCostAllocation: PurchaseAllocation | null;
};

const zero = BigInt(0);
const hundred = BigInt(100);
const conversionScale = BigInt(1_000_000);

function distribute(amount: bigint, weights: bigint[]) {
  const denominator = weights.reduce((sum, weight) => sum + weight, zero);
  if (!denominator) return weights.map(() => zero);
  const shares = weights.map((weight, index) => ({
    index, cents: amount * weight / denominator, remainder: amount * weight % denominator,
  }));
  const remaining = amount - shares.reduce((sum, share) => sum + share.cents, zero);
  // Largest remainder with saved line order as the stable tie-breaker.
  const ranked = [...shares].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1);
  for (let index = 0; index < Number(remaining); index++) ranked[index].cents += BigInt(1);
  return shares.map(share => share.cents);
}

function project(order: LandedOrder, lines: PurchaseLandedLine[], actual = false) {
  const { landedCostAllocation: allocation } = order;
  const method = allocation?.method ?? "none";
  const freight = scaledDecimal(order.shippingTotal, 2);
  const eligible = order.otherCharges.filter(charge => charge.allocatable)
    .reduce((sum, charge) => sum + scaledDecimal(charge.amount, 2), allocation?.includeFreight ? freight : zero);
  const acquisition = order.otherCharges.reduce((sum, charge) => sum + scaledDecimal(charge.amount, 2), freight);
  const materialLines = lines.flatMap((line, index) => line.materialId ? [{ line, index }] : []);
  let error: string | undefined;
  let cents = materialLines.map(() => zero);
  if (method === "manual") {
    const manual = materialLines.map(({ line }) => scaledDecimal(line.manualLandedAmount ?? "0", 2));
    if (actual) {
      // Reuse the agreed split when the vendor's actual eligible total differs.
      cents = distribute(eligible, manual);
    } else if (manual.reduce((sum, value) => sum + value, zero) !== eligible ||
      lines.some(line => !line.materialId && scaledDecimal(line.manualLandedAmount ?? "0", 2) > zero)) {
      error = "Manual material allocations must add up to the eligible charges.";
    } else {
      cents = manual;
    }
  } else if (eligible > zero && materialLines.length) {
    if (method === "value") {
      cents = distribute(eligible, materialLines.map(({ line }) => scaledDecimal(line.lineTotal, 4)));
    } else if (method === "quantity") {
      const unit = materialLines[0].line.purchaseUnit;
      if (!unit || materialLines.some(({ line }) => line.purchaseUnit !== unit)) {
        error = "Quantity allocation requires the same known purchase unit on every material line.";
      } else {
        cents = distribute(eligible, materialLines.map(({ line }) => scaledDecimal(line.quantityOrdered, 2)));
      }
    }
  }

  const allocated = cents.reduce((sum, value) => sum + value, zero);
  return {
    error,
    eligibleTotal: formatScaledDecimal(eligible, 2),
    allocatedTotal: formatScaledDecimal(allocated, 2),
    unallocatedTotal: formatScaledDecimal(acquisition - allocated, 2),
    lines: materialLines.map(({ line, index }, position) => {
      const quantity = scaledDecimal(line.quantityOrdered, 2);
      const conversion = scaledDecimal(line.inventoryUnitsPerPurchaseUnit, 6);
      const cost = (scaledDecimal(line.lineTotal, 4) + cents[position] * hundred) * hundred;
      return {
        index,
        amount: formatScaledDecimal(cents[position], 2),
        purchaseUnitCost: quantity > zero ? formatScaledDecimal(roundPurchaseDecimal(cost, quantity), 4) : null,
        inventoryUnitCost: quantity > zero && conversion > zero
          ? formatScaledDecimal(roundPurchaseDecimal(cost * conversionScale, quantity * conversion), 4) : null,
      };
    }),
  };
}

export function expectedPurchaseLandedCosts(order: LandedOrder, lines: PurchaseLandedLine[]) {
  return project(order, lines);
}

export function actualPurchaseLandedCosts(
  order: LandedOrder & { actualCosts: Record<string, ActualPurchaseCost> },
  lines: Array<PurchaseLandedLine & { id: string; quantityReceived: string }>,
) {
  const { actualCosts } = order;
  const freight = actualCosts.freight;
  const method = order.landedCostAllocation?.method ?? "none";
  const chargesIncluded = method !== "none";
  const freightRequired = chargesIncluded && order.landedCostAllocation?.includeFreight &&
    (Boolean(freight) || scaledDecimal(order.shippingTotal, 2) > zero);
  if (freightRequired && !freight) return null;

  // Wait until the complete material receipt is known before spreading PO-level
  // charges. Using only the quantity received so far would overstate unit cost.
  const materials = lines.filter(line => line.materialId);
  if (!materials.length || materials.some(line => {
    const actual = actualCosts[line.id];
    const received = scaledDecimal(line.quantityReceived, 2);
    return received < scaledDecimal(line.quantityOrdered, 2) ||
      !actual || (actual.quantity !== null && scaledDecimal(actual.quantity, 2) !== received);
  })) return null;

  const eligibleCharges = chargesIncluded ? order.otherCharges.filter(charge =>
    charge.allocatable && (actualCosts[otherPurchaseChargeKey(charge.id)] || scaledDecimal(charge.amount, 2) > zero)) : [];
  if (eligibleCharges.some(charge => !actualCosts[otherPurchaseChargeKey(charge.id)])) return null;
  const actualLines = lines.map(line => line.materialId
    ? { ...line, quantityOrdered: line.quantityReceived, lineTotal: actualCosts[line.id].total } : line);
  const result = project({
    ...order,
    shippingTotal: freight?.total ?? "0",
    otherCharges: order.otherCharges.map(charge => ({ ...charge, amount: actualCosts[otherPurchaseChargeKey(charge.id)]?.total ?? "0" })),
  }, actualLines, true);
  if (result.error) return null;
  return {
    ...result,
    final: (!freightRequired || freight?.final === true) &&
      materials.every(line => actualCosts[line.id].final) &&
      eligibleCharges.every(charge => actualCosts[otherPurchaseChargeKey(charge.id)].final),
  };
}
