import type { Pbv2OrderRollupResult } from "../../shared/pbv2/pbv2OrderRollup";

export type InventoryReservationRow = {
  organizationId: string;
  orderId: string;
  orderLineItemId: string | null;
  sourceType: "PBV2_MATERIAL" | "PBV2_COMPONENT" | "MANUAL";
  sourceKey: string;
  uom: string;
  qty: string; // normalized decimal string (2dp)
  status: "RESERVED" | "RELEASED";
  createdByUserId?: string | null;
};

export type InventoryReservationsRollupItem = {
  sourceKey: string;
  uom: string;
  qty: string;
  bySourceType: {
    PBV2_MATERIAL: string;
    PBV2_COMPONENT: string;
    MANUAL: string;
  };
};

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

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

export function buildInventoryReservationsFromRollup(args: {
  organizationId: string;
  orderId: string;
  rollup: Pbv2OrderRollupResult;
  createdByUserId?: string | null;
}): InventoryReservationRow[] {
  const byKey = new Map<string, InventoryReservationRow>();

  // Materials: already aggregated by (skuRef, uom) in PBV2 rollup.
  for (const m of args.rollup.materials ?? []) {
    const sourceKey = String(m.skuRef || "");
    const uom = String(m.uom || "");
    if (!sourceKey || !uom) continue;

    const qty = normalizeDecimalString(m.qty, 2);
    if (Number(qty) <= 0) continue;

    const key = `PBV2_MATERIAL::${sourceKey}::${uom}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.qty = addQtyStrings(existing.qty, qty);
      continue;
    }

    byKey.set(key, {
      organizationId: args.organizationId,
      orderId: args.orderId,
      orderLineItemId: null,
      sourceType: "PBV2_MATERIAL",
      sourceKey,
      uom,
      qty,
      status: "RESERVED",
      createdByUserId: args.createdByUserId ?? null,
    });
  }

  // Components: aggregate by (sourceKey, uom='EA').
  for (const c of args.rollup.components ?? []) {
    const sourceKey = c.kind === "inlineSku" ? String(c.skuRef || "") : String(c.childProductId || "");
    if (!sourceKey) continue;

    const uom = "EA";
    const qty = normalizeDecimalString(c.qty, 2);
    if (Number(qty) <= 0) continue;

    const key = `PBV2_COMPONENT::${sourceKey}::${uom}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.qty = addQtyStrings(existing.qty, qty);
      continue;
    }

    byKey.set(key, {
      organizationId: args.organizationId,
      orderId: args.orderId,
      orderLineItemId: null,
      sourceType: "PBV2_COMPONENT",
      sourceKey,
      uom,
      qty,
      status: "RESERVED",
      createdByUserId: args.createdByUserId ?? null,
    });
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const c1 = compareStrings(a.sourceKey, b.sourceKey);
    if (c1) return c1;
    const c2 = compareStrings(a.uom, b.uom);
    if (c2) return c2;
    return compareStrings(a.sourceType, b.sourceType);
  });
}

export function diffReservationsForInsert(args: {
  desired: InventoryReservationRow[];
  existingReserved: Array<Pick<InventoryReservationRow, "sourceType" | "sourceKey" | "uom" | "status">>;
}): InventoryReservationRow[] {
  const existingKeys = new Set(
    (args.existingReserved ?? [])
      .filter((r) => r.status === "RESERVED")
      .map((r) => `${r.sourceType}::${r.sourceKey}::${r.uom}`),
  );

  return (args.desired ?? []).filter((r) => !existingKeys.has(`${r.sourceType}::${r.sourceKey}::${r.uom}`));
}

export function applyReleaseToReservations<T extends { status: string }>(rows: T[]): Array<T & { status: "RELEASED" }> {
  return (rows ?? []).map((r) => ({ ...r, status: "RELEASED" }));
}

export function buildInventoryRollup(args: {
  reservations: Array<Pick<InventoryReservationRow, "sourceType" | "sourceKey" | "uom" | "qty" | "status">>;
  status?: "RESERVED" | "RELEASED";
}): { items: InventoryReservationsRollupItem[] } {
  const status = args.status ?? "RESERVED";
  const byKey = new Map<string, InventoryReservationsRollupItem>();

  for (const r of args.reservations ?? []) {
    if (r.status !== status) continue;
    const sourceKey = String(r.sourceKey || "");
    const uom = String(r.uom || "");
    if (!sourceKey || !uom) continue;

    const qty = normalizeDecimalString(r.qty, 2);
    if (Number(qty) <= 0) continue;

    const key = `${sourceKey}::${uom}`;
    const existing = byKey.get(key) ?? {
      sourceKey,
      uom,
      qty: normalizeDecimalString(0, 2),
      bySourceType: {
        PBV2_MATERIAL: normalizeDecimalString(0, 2),
        PBV2_COMPONENT: normalizeDecimalString(0, 2),
        MANUAL: normalizeDecimalString(0, 2),
      },
    };

    existing.qty = addQtyStrings(existing.qty, qty);
    if (r.sourceType === "PBV2_MATERIAL") existing.bySourceType.PBV2_MATERIAL = addQtyStrings(existing.bySourceType.PBV2_MATERIAL, qty);
    else if (r.sourceType === "PBV2_COMPONENT") existing.bySourceType.PBV2_COMPONENT = addQtyStrings(existing.bySourceType.PBV2_COMPONENT, qty);
    else existing.bySourceType.MANUAL = addQtyStrings(existing.bySourceType.MANUAL, qty);

    byKey.set(key, existing);
  }

  const items = Array.from(byKey.values()).sort((a, b) => {
    const c1 = compareStrings(a.sourceKey, b.sourceKey);
    if (c1) return c1;
    return compareStrings(a.uom, b.uom);
  });

  return { items };
}
