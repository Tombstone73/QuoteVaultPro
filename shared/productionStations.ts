export const canonicalProductionStationValues = ["roll", "flatbed"] as const;

export type CanonicalProductionStation = (typeof canonicalProductionStationValues)[number];

export function normalizeProductionStationKey(value: unknown): CanonicalProductionStation | null {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (!normalized) return null;
  if (normalized === "roll" || normalized === "wide_roll" || normalized === "wide_format" || normalized === "wideformat") {
    return "roll";
  }
  if (normalized === "flatbed" || normalized === "flat_bed" || normalized === "sheet") {
    return "flatbed";
  }
  return null;
}

export function getProductionStationLabel(value: unknown): string {
  const station = normalizeProductionStationKey(value);
  if (station === "roll") return "Roll";
  if (station === "flatbed") return "Flatbed";
  return "Auto / Suggested";
}

export type PrepressProductionDestinationOverride = {
  selectedStationKey?: CanonicalProductionStation | null;
  source?: "auto" | "override";
  actorUserId?: string | null;
  updatedAt?: string | null;
  reason?: string | null;
};

const DESTINATION_OVERRIDE_KEY = "prepressProductionDestination";

export function readPrepressProductionDestinationOverride(specsJson: unknown): PrepressProductionDestinationOverride | null {
  if (!specsJson || typeof specsJson !== "object") return null;
  const raw = (specsJson as Record<string, unknown>)[DESTINATION_OVERRIDE_KEY];
  if (!raw || typeof raw !== "object") return null;
  const selectedStationKey = normalizeProductionStationKey((raw as Record<string, unknown>).selectedStationKey);
  if (!selectedStationKey) return null;
  return {
    selectedStationKey,
    source: "override",
    actorUserId: typeof (raw as any).actorUserId === "string" ? (raw as any).actorUserId : null,
    updatedAt: typeof (raw as any).updatedAt === "string" ? (raw as any).updatedAt : null,
    reason: typeof (raw as any).reason === "string" ? (raw as any).reason : null,
  };
}

export function writePrepressProductionDestinationOverride(args: {
  specsJson: unknown;
  selectedStationKey: CanonicalProductionStation | null;
  actorUserId?: string | null;
  reason?: string | null;
  updatedAt?: string | null;
}): Record<string, unknown> {
  const base = args.specsJson && typeof args.specsJson === "object" && !Array.isArray(args.specsJson)
    ? { ...(args.specsJson as Record<string, unknown>) }
    : {};

  if (!args.selectedStationKey) {
    delete base[DESTINATION_OVERRIDE_KEY];
    return base;
  }

  base[DESTINATION_OVERRIDE_KEY] = {
    selectedStationKey: args.selectedStationKey,
    source: "override",
    actorUserId: args.actorUserId ?? null,
    updatedAt: args.updatedAt ?? new Date().toISOString(),
    reason: args.reason?.trim() || null,
  };
  return base;
}

