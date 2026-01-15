export type Pbv2OverrideConfig = {
  enabled: boolean;
  treeVersionId: string | null;
};

const KEY = "pbv2Override";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function readPbv2OverrideConfig(pricingProfileConfig: unknown): Pbv2OverrideConfig {
  const rec = asRecord(pricingProfileConfig);
  const raw = rec ? asRecord(rec[KEY]) : null;

  const enabled = raw ? Boolean(raw.enabled) : false;
  const treeVersionId = raw && typeof raw.treeVersionId === "string" && raw.treeVersionId.trim() ? raw.treeVersionId : null;

  return { enabled, treeVersionId };
}

export function writePbv2OverrideConfig(pricingProfileConfig: unknown, next: Partial<Pbv2OverrideConfig>): any {
  const base = asRecord(pricingProfileConfig) ? { ...(pricingProfileConfig as any) } : {};
  const current = readPbv2OverrideConfig(base);
  const merged: Pbv2OverrideConfig = {
    enabled: next.enabled ?? current.enabled,
    treeVersionId: next.treeVersionId ?? current.treeVersionId,
  };

  return {
    ...base,
    [KEY]: {
      enabled: merged.enabled,
      treeVersionId: merged.treeVersionId,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function selectPbv2TreeVersionIdForEvaluation(args: {
  activeTreeVersionId: string | null | undefined;
  pricingProfileConfig: unknown;
}): string | null {
  const { activeTreeVersionId, pricingProfileConfig } = args;
  if (!activeTreeVersionId) return null;

  const override = readPbv2OverrideConfig(pricingProfileConfig);
  if (!override.enabled) return activeTreeVersionId;

  if (!override.treeVersionId) {
    const err: any = new Error("PBV2 override is enabled but no override tree version is configured");
    err.statusCode = 409;
    throw err;
  }

  return override.treeVersionId;
}
