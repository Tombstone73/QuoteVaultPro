import { normalizeProductionStationKey } from "./productionStations";

/** Historical assignment suggestions, not an authoritative equipment inventory. */
export const legacyProductionMachineOptions: Readonly<Record<string, readonly string[]>> = {
  roll: ["S40", "S60", "Canon"],
  flatbed: ["Jetson"],
};

export function productionMachineStationKey(value: unknown): string {
  return normalizeProductionStationKey(value) ?? String(value ?? "").trim().toLowerCase();
}

/** An explicit list (including an empty one) owns the available suggestions. */
export function getProductionMachineOptions(stationKey: unknown, configured?: readonly unknown[]): string[] {
  const values = configured ?? legacyProductionMachineOptions[productionMachineStationKey(stationKey)] ?? [];
  const seen = new Set<string>();
  return values.flatMap(value => {
    if (typeof value !== "string" || !value.trim()) return [];
    const name = value.trim(), key = name.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [name];
  });
}

export type ProductionMachineConfigurationRow = {
  stationKey: string;
  machines: string[];
  source: "configured" | "legacy_default" | "invalid";
  issues: string[];
};

/** Read-only diagnostics of the existing organization preference. No inferred capabilities. */
export function describeProductionMachineConfiguration(raw: unknown): ProductionMachineConfigurationRow[] {
  const isMap = !!raw && typeof raw === "object" && !Array.isArray(raw);
  const map = isMap ? raw as Record<string, unknown> : {};
  const malformedMap = raw != null && !isMap;
  const keys = Array.from(new Set([...Object.keys(legacyProductionMachineOptions), ...Object.keys(map)]));
  return keys.map(stationKey => {
    const configured = Object.prototype.hasOwnProperty.call(map, stationKey);
    const value = map[stationKey];
    const valid = Array.isArray(value) && value.every(item => typeof item === "string" && !!item.trim());
    const issues: string[] = [];
    if (malformedMap || configured && !valid) issues.push("Stored machine list is invalid; legacy suggestions may still be used. Review configuration.");
    if (configured && productionMachineStationKey(stationKey) !== stationKey) issues.push(`Legacy station key. Production reads the canonical '${productionMachineStationKey(stationKey)}' list; verify that list separately.`);
    const machines = getProductionMachineOptions(stationKey, valid ? value : undefined);
    if (configured && valid && machines.length < value.length) issues.push("Duplicate machine labels are present in the saved list.");
    if (configured && valid && !machines.length) issues.push("No machine choices configured. Existing job assignments are retained.");
    return { stationKey, machines, source: malformedMap || configured && !valid ? "invalid" : configured ? "configured" : "legacy_default", issues };
  });
}
