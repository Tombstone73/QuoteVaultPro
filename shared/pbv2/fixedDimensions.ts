export type Pbv2FixedDimensions = {
  widthIn: number;
  heightIn: number;
  unit: "in";
  label?: string;
  source?: string;
  confidence?: number;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeFixedDimensions(value: unknown): Pbv2FixedDimensions | null {
  const record = asRecord(value);
  if (!record) return null;

  const widthIn = positiveNumber(record.widthIn ?? record.width ?? record.finishedWidthIn);
  const heightIn = positiveNumber(record.heightIn ?? record.height ?? record.finishedHeightIn);
  if (widthIn === null || heightIn === null) return null;

  return {
    widthIn,
    heightIn,
    unit: "in",
    ...(typeof record.label === "string" && record.label.trim() ? { label: record.label.trim() } : {}),
    ...(typeof record.source === "string" && record.source.trim() ? { source: record.source.trim() } : {}),
    ...(positiveNumber(record.confidence) !== null ? { confidence: positiveNumber(record.confidence)! } : {}),
  };
}

export function getPbv2FixedDimensions(treeJson: unknown): Pbv2FixedDimensions | null {
  const tree = asRecord(treeJson);
  if (!tree) return null;
  const meta = asRecord(tree.meta) ?? tree;

  return (
    normalizeFixedDimensions(meta.fixedDimensions) ??
    normalizeFixedDimensions(asRecord(meta.geometry)?.fixedDimensions) ??
    normalizeFixedDimensions(asRecord(meta.productIntake)?.fixedDimensions) ??
    normalizeFixedDimensions(asRecord(asRecord(meta.productIntake)?.size)?.fixedDimensions)
  );
}

export function resolvePbv2RuntimeDimensions(input: {
  treeJson?: unknown;
  widthIn?: unknown;
  heightIn?: unknown;
}): { widthIn: number; heightIn: number; fixedDimensions: Pbv2FixedDimensions | null } {
  const fixedDimensions = getPbv2FixedDimensions(input.treeJson);
  if (fixedDimensions) {
    return {
      widthIn: fixedDimensions.widthIn,
      heightIn: fixedDimensions.heightIn,
      fixedDimensions,
    };
  }

  return {
    widthIn: Number(input.widthIn),
    heightIn: Number(input.heightIn),
    fixedDimensions: null,
  };
}
