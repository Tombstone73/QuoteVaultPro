export const currentProdWriteFreeAuthorities = [
  "maintenance-ingress",
  "railway-v1-runtime",
  "mcp-production",
  "mcp-development",
  "v2-prod-runtime",
  "reconciliation-executor",
] as const;

export type CurrentProdAuthority = (typeof currentProdWriteFreeAuthorities)[number];
export type EvidenceSource = "railway-read-only" | "database-read-only" | "edge-probe" | "mcp-registry-read-only" | "source-read-only";

export type RuntimeAuthorityObservation = {
  authority: CurrentProdAuthority;
  admission: "closed" | "not_applicable" | "open" | "unknown";
  process: "stopped" | "not_deployed" | "read_only" | "running" | "unknown";
  canMutate: boolean | "unknown";
  capturedAt: string;
  evidence: readonly { source: EvidenceSource; reference: string }[];
};

export type WriteFreeRuntimeGate = { pass: boolean; failures: readonly string[] };

type AuthorityRule = {
  allowedProcesses: readonly RuntimeAuthorityObservation["process"][];
  requiredEvidence: readonly EvidenceSource[];
};

const authorityRules: Readonly<Record<CurrentProdAuthority, AuthorityRule>> = {
  "maintenance-ingress": { allowedProcesses: ["read_only", "stopped"], requiredEvidence: ["edge-probe"] },
  "railway-v1-runtime": { allowedProcesses: ["stopped"], requiredEvidence: ["railway-read-only"] },
  "mcp-production": { allowedProcesses: ["not_deployed", "stopped", "read_only"], requiredEvidence: ["source-read-only"] },
  "mcp-development": { allowedProcesses: ["not_deployed", "stopped", "read_only"], requiredEvidence: ["source-read-only"] },
  "v2-prod-runtime": { allowedProcesses: ["not_deployed", "stopped"], requiredEvidence: ["railway-read-only"] },
  "reconciliation-executor": { allowedProcesses: ["not_deployed", "stopped"], requiredEvidence: ["database-read-only"] },
};

/**
 * Validates the actual M7.2F production boundary, not hypothetical source
 * modules. Every observation is fresh, sanitized read-only evidence and every
 * remaining process must have no path to mutate production cutover state.
 */
export function assertCurrentProdWriteFreeBoundary(
  observations: readonly RuntimeAuthorityObservation[],
  nowMs: number,
  maximumEvidenceAgeMs = 5 * 60_000,
): WriteFreeRuntimeGate {
  const failures: string[] = [];
  const byAuthority = new Map<CurrentProdAuthority, RuntimeAuthorityObservation>();

  for (const observation of observations) {
    if (byAuthority.has(observation.authority)) failures.push(`duplicate authority observation: ${observation.authority}`);
    byAuthority.set(observation.authority, observation);
  }

  for (const authority of currentProdWriteFreeAuthorities) {
    const observation = byAuthority.get(authority);
    if (!observation) {
      failures.push(`missing authority observation: ${authority}`);
      continue;
    }
    const rule = authorityRules[authority];
    if (!rule.allowedProcesses.includes(observation.process)) failures.push(`authority process is not in its safe state: ${authority}`);
    if (observation.admission !== "closed" && observation.admission !== "not_applicable") failures.push(`authority admission is not closed: ${authority}`);
    if (observation.canMutate !== false) failures.push(`authority can still mutate or is unknown: ${authority}`);

    const capturedAtMs = Date.parse(observation.capturedAt);
    if (!Number.isFinite(capturedAtMs) || capturedAtMs > nowMs || nowMs - capturedAtMs > maximumEvidenceAgeMs) {
      failures.push(`authority evidence is missing, invalid, or stale: ${authority}`);
    }
    for (const source of rule.requiredEvidence) {
      if (!observation.evidence.some((entry) => entry.source === source && entry.reference.trim().length > 0)) {
        failures.push(`authority lacks ${source} evidence: ${authority}`);
      }
    }
  }
  return { pass: failures.length === 0, failures };
}
