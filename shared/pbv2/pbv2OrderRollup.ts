import { computePbv2InputSignature } from "@shared/pbv2/pbv2InputSignature";

export type Pbv2RollupWarning = {
  code: string;
  message: string;
  lineItemId?: string;
};

export type Pbv2RollupMaterialSource = {
  lineItemId: string;
  sourceNodeId: string;
  effectIndex: number | null;
  qty: string;
};

export type Pbv2RollupMaterial = {
  skuRef: string;
  uom: string;
  qty: string;
  sources: Pbv2RollupMaterialSource[];
};

export type Pbv2RollupComponent = {
  kind: string;
  skuRef?: string | null;
  childProductId?: string | null;
  title: string;
  invoiceVisibility: string;
  qty: string;
  unitPriceCents?: number | null;
  amountCents?: number | null;
  lineItemId: string;
};

export type Pbv2OrderRollupResult = {
  orderId: string;
  materials: Pbv2RollupMaterial[];
  components: Pbv2RollupComponent[];
  warnings: Pbv2RollupWarning[];
};

export type Pbv2RollupLineItemInput = {
  id: string;
  pbv2SnapshotJson: any | null;
};

function normalizeDecimalString(value: unknown, decimals: number): string {
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(n)) return (0).toFixed(decimals);
  const factor = 10 ** decimals;
  const rounded = Math.round(n * factor) / factor;
  return rounded.toFixed(decimals);
}

function scaledIntFromNumber(value: unknown, scale: number): number {
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * scale);
}

function formatScaledInt(value: number, scale: number): string {
  const decimals = Math.log10(scale);
  const fixed = (value / scale).toFixed(decimals);
  // Trim trailing zeros for nicer display.
  return fixed.replace(/\.0+$/, "").replace(/(\.[0-9]*?)0+$/, "$1");
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export async function buildOrderPbv2Rollup(args: {
  orderId: string;
  lineItems: Pbv2RollupLineItemInput[];
  acceptedComponents: Array<{
    orderLineItemId: string;
    kind: string;
    title: string;
    skuRef?: string | null;
    childProductId?: string | null;
    qty: unknown;
    unitPriceCents?: number | null;
    amountCents?: number | null;
    invoiceVisibility?: string | null;
  }>;
}): Promise<Pbv2OrderRollupResult> {
  const warnings: Pbv2RollupWarning[] = [];

  // Materials: sum by (skuRef, uom). Use scaled integers to avoid float drift.
  const SCALE = 10000;
  const materialTotals = new Map<string, { skuRef: string; uom: string; scaledQty: number; sources: Pbv2RollupMaterialSource[] }>();

  for (const li of args.lineItems) {
    const snapshot = li.pbv2SnapshotJson;
    if (!snapshot || typeof snapshot !== "object") continue;

    const treeVersionId = String((snapshot as any).treeVersionId || "");
    const explicitSelections = (snapshot as any).explicitSelections;
    const env = (snapshot as any).env;

    const storedSig = typeof (snapshot as any).pbv2InputSignature === "string" ? String((snapshot as any).pbv2InputSignature) : "";
    if (!storedSig) {
      warnings.push({
        code: "PBV2_SNAPSHOT_SIGNATURE_MISSING",
        message: "PBV2 snapshot signature missing; skipping materials for line item.",
        lineItemId: li.id,
      });
      continue;
    }

    if (!treeVersionId || !explicitSelections || !env) {
      warnings.push({
        code: "PBV2_SNAPSHOT_INPUTS_MISSING",
        message: "PBV2 snapshot inputs missing; skipping materials for line item.",
        lineItemId: li.id,
      });
      continue;
    }

    const computedSig = await computePbv2InputSignature({ treeVersionId, explicitSelections, env });
    if (computedSig !== storedSig) {
      warnings.push({
        code: "PBV2_SNAPSHOT_SIGNATURE_MISMATCH",
        message: "PBV2 snapshot signature mismatch; skipping materials for line item.",
        lineItemId: li.id,
      });
      continue;
    }

    const materials = Array.isArray((snapshot as any).materials) ? ((snapshot as any).materials as any[]) : [];
    for (const m of materials) {
      if (!m || typeof m !== "object") continue;
      const skuRef = String((m as any).skuRef || "");
      const uom = String((m as any).uom || "");
      if (!skuRef || !uom) continue;

      const sourceNodeId = String((m as any).sourceNodeId || "");
      const scaledQty = scaledIntFromNumber((m as any).qty, SCALE);
      if (scaledQty === 0) continue;

      const key = `${skuRef}::${uom}`;
      const rec = materialTotals.get(key) ?? {
        skuRef,
        uom,
        scaledQty: 0,
        sources: [],
      };

      rec.scaledQty += scaledQty;
      rec.sources.push({
        lineItemId: li.id,
        sourceNodeId,
        effectIndex: null,
        qty: formatScaledInt(scaledQty, SCALE),
      });

      materialTotals.set(key, rec);
    }
  }

  const materials: Pbv2RollupMaterial[] = Array.from(materialTotals.values())
    .map((r) => ({
      skuRef: r.skuRef,
      uom: r.uom,
      qty: formatScaledInt(r.scaledQty, SCALE),
      sources: [...r.sources].sort((a, b) => {
        const c1 = compareStrings(a.lineItemId, b.lineItemId);
        if (c1) return c1;
        return compareStrings(a.sourceNodeId, b.sourceNodeId);
      }),
    }))
    .sort((a, b) => {
      const c1 = compareStrings(a.skuRef, b.skuRef);
      if (c1) return c1;
      return compareStrings(a.uom, b.uom);
    });

  const components: Pbv2RollupComponent[] = [...args.acceptedComponents]
    .map((c) => ({
      kind: String(c.kind || ""),
      skuRef: c.skuRef ?? null,
      childProductId: c.childProductId ?? null,
      title: String(c.title || ""),
      invoiceVisibility: String(c.invoiceVisibility || "rollup"),
      qty: normalizeDecimalString(c.qty, 2),
      unitPriceCents: c.unitPriceCents ?? null,
      amountCents: c.amountCents ?? null,
      lineItemId: String(c.orderLineItemId || ""),
    }))
    .sort((a, b) => {
      const c1 = compareStrings(a.lineItemId, b.lineItemId);
      if (c1) return c1;
      const c2 = compareStrings(a.title, b.title);
      if (c2) return c2;
      const aKey = a.kind === "inlineSku" ? String(a.skuRef || "") : String(a.childProductId || "");
      const bKey = b.kind === "inlineSku" ? String(b.skuRef || "") : String(b.childProductId || "");
      return compareStrings(aKey, bKey);
    });

  warnings.sort((a, b) => compareStrings(String(a.lineItemId || ""), String(b.lineItemId || "")));

  return {
    orderId: args.orderId,
    materials,
    components,
    warnings,
  };
}
