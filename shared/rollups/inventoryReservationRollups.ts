export type InventoryReservationLike = {
  sourceType: string;
  sourceKey: string;
  uom: string;
  qty: string | number;
  status?: string;
};

export type ReservationGroup = {
  materialId: string; // inventory_reservations.sourceKey (material skuRef or other key)
  uom: string;
  totalQty: string; // normalized decimal string (2dp)
  bySourceType: {
    AUTO: string; // PBV2_* totals
    MANUAL: string;
  };
};

function normalizeDecimal2(value: unknown): string {
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(n)) return (0).toFixed(2);
  const rounded = Math.round(n * 100) / 100;
  return rounded.toFixed(2);
}

function add2(a: string, b: string): string {
  const n1 = Number(a);
  const n2 = Number(b);
  if (!Number.isFinite(n1) || !Number.isFinite(n2)) return normalizeDecimal2(0);
  return normalizeDecimal2(n1 + n2);
}

function isReservedStatus(status: string | undefined): boolean {
  // Defensive: treat missing as RESERVED (existing code paths often omit status in projections)
  if (!status) return true;
  return String(status).toUpperCase() === "RESERVED";
}

export function groupReservationsByMaterial(reservations: InventoryReservationLike[]): ReservationGroup[] {
  const byKey = new Map<string, ReservationGroup>();

  for (const r of reservations ?? []) {
    if (!isReservedStatus(r.status)) continue;

    const materialId = String(r.sourceKey || "");
    const uom = String(r.uom || "");
    if (!materialId || !uom) continue;

    const qty = normalizeDecimal2(r.qty);
    if (Number(qty) <= 0) continue;

    const key = `${materialId}::${uom}`;
    const existing = byKey.get(key) ?? {
      materialId,
      uom,
      totalQty: normalizeDecimal2(0),
      bySourceType: {
        AUTO: normalizeDecimal2(0),
        MANUAL: normalizeDecimal2(0),
      },
    };

    existing.totalQty = add2(existing.totalQty, qty);

    if (String(r.sourceType).toUpperCase() === "MANUAL") {
      existing.bySourceType.MANUAL = add2(existing.bySourceType.MANUAL, qty);
    } else {
      existing.bySourceType.AUTO = add2(existing.bySourceType.AUTO, qty);
    }

    byKey.set(key, existing);
  }

  return Array.from(byKey.values()).sort((a, b) => {
    if (a.materialId < b.materialId) return -1;
    if (a.materialId > b.materialId) return 1;
    if (a.uom < b.uom) return -1;
    if (a.uom > b.uom) return 1;
    return 0;
  });
}

export function sumManualReservedForOrder(reservations: InventoryReservationLike[]): number {
  let sum = 0;
  for (const r of reservations ?? []) {
    if (!isReservedStatus(r.status)) continue;
    if (String(r.sourceType).toUpperCase() !== "MANUAL") continue;

    const qty = Number(normalizeDecimal2(r.qty));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    sum += qty;
  }
  return Math.round(sum * 100) / 100;
}
