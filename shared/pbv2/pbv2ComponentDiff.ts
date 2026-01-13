export type Pbv2ComponentKey = {
  pbv2SourceNodeId: string;
  pbv2EffectIndex: number;
};

export type Pbv2ComponentComparable = {
  key: Pbv2ComponentKey;
  kind: string;
  title: string;
  skuRef: string | null;
  childProductId: string | null;
  qty: string; // normalized decimal string (2 dp)
  unitPriceCents: number | null;
  amountCents: number | null;
  invoiceVisibility: string;
};

export type Pbv2ComponentDiffModified = {
  key: Pbv2ComponentKey;
  before: Pbv2ComponentComparable;
  after: Pbv2ComponentComparable;
  changedFields: Array<
    | "qty"
    | "unitPriceCents"
    | "amountCents"
    | "title"
    | "skuRef"
    | "childProductId"
    | "invoiceVisibility"
    | "kind"
  >;
};

export type Pbv2ComponentDiff = {
  unchanged: Pbv2ComponentComparable[];
  added: Pbv2ComponentComparable[];
  removed: Pbv2ComponentComparable[];
  modified: Pbv2ComponentDiffModified[];
};

function normalizeStringOrNull(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value);
  return s.length ? s : null;
}

function normalizeIntOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(String(value));
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function normalizeQtyTo2dp(value: unknown): string {
  const n = typeof value === "number" ? value : Number(String(value));
  if (!Number.isFinite(n)) return "0.00";
  // Avoid floating drift: round to cents of qty.
  const rounded = Math.round(n * 100) / 100;
  return rounded.toFixed(2);
}

function keyToString(key: Pbv2ComponentKey): string {
  return `${key.pbv2SourceNodeId}::${key.pbv2EffectIndex}`;
}

function compareKeys(a: Pbv2ComponentKey, b: Pbv2ComponentKey): number {
  if (a.pbv2SourceNodeId < b.pbv2SourceNodeId) return -1;
  if (a.pbv2SourceNodeId > b.pbv2SourceNodeId) return 1;
  return a.pbv2EffectIndex - b.pbv2EffectIndex;
}

function compareComponents(a: Pbv2ComponentComparable, b: Pbv2ComponentComparable): number {
  return compareKeys(a.key, b.key);
}

function diffFields(before: Pbv2ComponentComparable, after: Pbv2ComponentComparable): Pbv2ComponentDiffModified["changedFields"] {
  const changed: Pbv2ComponentDiffModified["changedFields"] = [];

  if (before.qty !== after.qty) changed.push("qty");
  if ((before.unitPriceCents ?? null) !== (after.unitPriceCents ?? null)) changed.push("unitPriceCents");
  if ((before.amountCents ?? null) !== (after.amountCents ?? null)) changed.push("amountCents");
  if (before.title !== after.title) changed.push("title");
  if ((before.skuRef ?? null) !== (after.skuRef ?? null)) changed.push("skuRef");
  if ((before.childProductId ?? null) !== (after.childProductId ?? null)) changed.push("childProductId");
  if (before.invoiceVisibility !== after.invoiceVisibility) changed.push("invoiceVisibility");
  if (before.kind !== after.kind) changed.push("kind");

  return changed;
}

export function normalizePbv2DiffComponent(input: {
  pbv2SourceNodeId: unknown;
  pbv2EffectIndex: unknown;
  kind: unknown;
  title: unknown;
  skuRef?: unknown;
  childProductId?: unknown;
  qty: unknown;
  unitPriceCents?: unknown;
  amountCents?: unknown;
  invoiceVisibility: unknown;
}): Pbv2ComponentComparable | null {
  const pbv2SourceNodeId = normalizeStringOrNull(input.pbv2SourceNodeId);
  const pbv2EffectIndex = normalizeIntOrNull(input.pbv2EffectIndex);
  if (!pbv2SourceNodeId || pbv2EffectIndex == null) return null;

  const kind = String(input.kind ?? "");
  const title = String(input.title ?? "");
  const invoiceVisibility = String(input.invoiceVisibility ?? "");

  return {
    key: { pbv2SourceNodeId, pbv2EffectIndex },
    kind,
    title,
    skuRef: normalizeStringOrNull(input.skuRef),
    childProductId: normalizeStringOrNull(input.childProductId),
    qty: normalizeQtyTo2dp(input.qty),
    unitPriceCents: normalizeIntOrNull(input.unitPriceCents),
    amountCents: normalizeIntOrNull(input.amountCents),
    invoiceVisibility,
  };
}

export function pbv2DiffComponents(
  acceptedComponents: Pbv2ComponentComparable[],
  proposedComponents: Pbv2ComponentComparable[],
): Pbv2ComponentDiff {
  const acceptedByKey = new Map<string, Pbv2ComponentComparable>();
  for (const c of acceptedComponents) {
    acceptedByKey.set(keyToString(c.key), c);
  }

  const proposedByKey = new Map<string, Pbv2ComponentComparable>();
  for (const c of proposedComponents) {
    proposedByKey.set(keyToString(c.key), c);
  }

  const allKeys = new Map<string, Pbv2ComponentKey>();
  for (const c of acceptedComponents) allKeys.set(keyToString(c.key), c.key);
  for (const c of proposedComponents) allKeys.set(keyToString(c.key), c.key);

  const sortedKeys = Array.from(allKeys.values()).sort(compareKeys);

  const unchanged: Pbv2ComponentComparable[] = [];
  const added: Pbv2ComponentComparable[] = [];
  const removed: Pbv2ComponentComparable[] = [];
  const modified: Pbv2ComponentDiffModified[] = [];

  for (const k of sortedKeys) {
    const ks = keyToString(k);
    const a = acceptedByKey.get(ks);
    const p = proposedByKey.get(ks);

    if (!a && p) {
      added.push(p);
      continue;
    }
    if (a && !p) {
      removed.push(a);
      continue;
    }
    if (!a || !p) continue;

    const changedFields = diffFields(a, p);
    if (changedFields.length === 0) unchanged.push(a);
    else modified.push({ key: k, before: a, after: p, changedFields });
  }

  // Ensure stable deterministic ordering within buckets.
  unchanged.sort(compareComponents);
  added.sort(compareComponents);
  removed.sort(compareComponents);
  modified.sort((x, y) => compareKeys(x.key, y.key));

  return { unchanged, added, removed, modified };
}
