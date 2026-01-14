import type {
  Pbv2OrderRollupResult,
  Pbv2RollupComponent,
  Pbv2RollupMaterial,
  Pbv2RollupMaterialSource,
  Pbv2RollupWarning,
} from "../../shared/pbv2/pbv2OrderRollup";

export type Pbv2OrderRollupResponse = {
  orderId: string;
  materials: Array<{
    skuRef: string;
    uom: string;
    qty: string;
    sources: Pbv2RollupMaterialSource[];
  }>;
  components: Array<{
    lineItemId: string;
    kind: string;
    title: string;
    skuRef?: string | null;
    childProductId?: string | null;
    qty: string;
    invoiceVisibility: string;
    unitPriceCents?: number | null;
    amountCents?: number | null;
  }>;
  warnings: Array<{
    code: string;
    message: string;
    lineItemId?: string;
  }>;
};

export function buildPbv2OrderRollupResponse(rollup: Pbv2OrderRollupResult): Pbv2OrderRollupResponse {
  const materials = (rollup.materials ?? []).map((m: Pbv2RollupMaterial) => ({
    skuRef: String(m.skuRef ?? ""),
    uom: String(m.uom ?? ""),
    qty: String(m.qty ?? "0"),
    sources: Array.isArray(m.sources) ? (m.sources as Pbv2RollupMaterialSource[]) : [],
  }));

  const components = (rollup.components ?? []).map((c: Pbv2RollupComponent) => ({
    lineItemId: String(c.lineItemId ?? ""),
    kind: String(c.kind ?? ""),
    title: String(c.title ?? ""),
    skuRef: c.skuRef ?? null,
    childProductId: c.childProductId ?? null,
    qty: String(c.qty ?? "0"),
    invoiceVisibility: String(c.invoiceVisibility ?? "rollup"),
    unitPriceCents: c.unitPriceCents ?? null,
    amountCents: c.amountCents ?? null,
  }));

  const warnings = (rollup.warnings ?? []).map((w: Pbv2RollupWarning) => ({
    code: String(w.code ?? ""),
    message: String(w.message ?? ""),
    ...(w.lineItemId ? { lineItemId: String(w.lineItemId) } : {}),
  }));

  return {
    orderId: String(rollup.orderId ?? ""),
    materials,
    components,
    warnings,
  };
}
