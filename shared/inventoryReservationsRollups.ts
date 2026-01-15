export type ReservationLike = {
  sourceType: string;
  sourceKey: string;
  uom: string;
  qty: unknown;
  status?: string;
};

export type ReservationsByMaterialRow = {
  sourceKey: string;
  uom: string;
  totalQty: string;
  manualQty: string;
  nonManualQty: string;
};

function normalizeDecimalString(value: unknown, decimals: number): string {
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(n)) return (0).toFixed(decimals);
  const factor = 10 ** decimals;
  const rounded = Math.round(n * factor) / factor;
  return rounded.toFixed(decimals);
}

function addQtyStrings(a: string, b: string): string {
  const n1 = Number(a);
  const n2 = Number(b);
  if (!Number.isFinite(n1) || !Number.isFinite(n2)) return normalizeDecimalString(0, 2);
  return normalizeDecimalString(n1 + n2, 2);
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function isReserved(status: unknown): boolean {
  if (status == null) return true;
  return String(status) === "RESERVED";
}

/**
 * Group reservations by (sourceKey, uom) with MANUAL totals separated from non-MANUAL.
 * Defensive: ignores missing keys, missing uom, non-finite qty, non-positive qty.
 */
export function groupReservationsByMaterial(reservations: ReservationLike[]): ReservationsByMaterialRow[] {
  const byKey = new Map<string, ReservationsByMaterialRow>();

  for (const r of reservations ?? []) {
    if (!isReserved((r as any).status)) continue;

    const sourceKey = String((r as any).sourceKey || "");
    const uom = String((r as any).uom || "");
    if (!sourceKey || !uom) continue;

    const qty = normalizeDecimalString((r as any).qty, 2);
    if (Number(qty) <= 0) continue;

    const key = `${sourceKey}::${uom}`;
    const existing = byKey.get(key) ?? {
      sourceKey,
      uom,
      totalQty: normalizeDecimalString(0, 2),
      manualQty: normalizeDecimalString(0, 2),
      nonManualQty: normalizeDecimalString(0, 2),
    };

    const isManual = String((r as any).sourceType) === "MANUAL";

    existing.totalQty = addQtyStrings(existing.totalQty, qty);
    if (isManual) existing.manualQty = addQtyStrings(existing.manualQty, qty);
    else existing.nonManualQty = addQtyStrings(existing.nonManualQty, qty);

    byKey.set(key, existing);
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const c1 = compareStrings(a.sourceKey, b.sourceKey);
    if (c1) return c1;
    return compareStrings(a.uom, b.uom);
  });
}

/**
 * Sum RESERVED MANUAL qty for a specific (sourceKey, uom).
 * Defensive: ignores non-positive qty.
 */
export function sumManualReservedForOrder(
  reservations: ReservationLike[],
  sourceKey: string,
  uom: string,
): string {
  let total = normalizeDecimalString(0, 2);

  for (const r of reservations ?? []) {
    if (!isReserved((r as any).status)) continue;
    if (String((r as any).sourceType) !== "MANUAL") continue;
    if (String((r as any).sourceKey || "") !== String(sourceKey)) continue;
    if (String((r as any).uom || "") !== String(uom)) continue;

    const qty = normalizeDecimalString((r as any).qty, 2);
    if (Number(qty) <= 0) continue;

    total = addQtyStrings(total, qty);
  }

  return total;
}
