export const m72eRequiredAuthorities = [
  "v1-http-mutation-ingress",
  "v1-background-workers",
  "v1-standalone-prepress",
  "v1-migration-runner",
  "stripe-webhook-application",
  "quickbooks-workers",
  "email-delivery-workers",
  "financial-outbox-consumer",
  "mcp-production",
  "mcp-development",
  "v2-writers",
  "reconciliation-executor",
] as const;

export type M72eAuthority = (typeof m72eRequiredAuthorities)[number];
export type EvidenceSource =
  | "railway-read-only"
  | "database-read-only"
  | "http-probe"
  | "provider-console-read-only"
  | "mcp-registry-read-only";

export type RuntimeAuthorityObservation = {
  authority: M72eAuthority;
  admission: "closed" | "not_applicable" | "open" | "unknown";
  process: "stopped" | "not_deployed" | "running" | "unknown";
  canMutate: boolean | "unknown";
  capturedAt: string;
  evidence: readonly {
    source: EvidenceSource;
    reference: string;
  }[];
};

export type WriteFreeRuntimeGate = {
  pass: boolean;
  failures: readonly string[];
};

const requiredEvidence: Readonly<Record<M72eAuthority, readonly EvidenceSource[]>> = {
  "v1-http-mutation-ingress": ["railway-read-only", "http-probe"],
  "v1-background-workers": ["railway-read-only"],
  "v1-standalone-prepress": ["railway-read-only"],
  "v1-migration-runner": ["database-read-only"],
  "stripe-webhook-application": ["railway-read-only", "provider-console-read-only"],
  "quickbooks-workers": ["railway-read-only"],
  "email-delivery-workers": ["railway-read-only"],
  "financial-outbox-consumer": ["railway-read-only"],
  "mcp-production": ["mcp-registry-read-only"],
  "mcp-development": ["mcp-registry-read-only"],
  "v2-writers": ["railway-read-only"],
  "reconciliation-executor": ["database-read-only"],
};

/**
 * Validates a sanitized, read-only runtime evidence manifest. It intentionally
 * does not stop processes or trust an operator's unchecked declaration: every
 * authority needs fresh, source-specific evidence and must be unable to write.
 */
export function assertM72eWriteFreeRuntime(
  observations: readonly RuntimeAuthorityObservation[],
  nowMs: number,
  maximumEvidenceAgeMs = 5 * 60_000,
): WriteFreeRuntimeGate {
  const failures: string[] = [];
  const byAuthority = new Map<M72eAuthority, RuntimeAuthorityObservation>();

  for (const observation of observations) {
    if (byAuthority.has(observation.authority)) {
      failures.push(`duplicate authority observation: ${observation.authority}`);
    }
    byAuthority.set(observation.authority, observation);
  }

  for (const authority of m72eRequiredAuthorities) {
    const observation = byAuthority.get(authority);
    if (!observation) {
      failures.push(`missing authority observation: ${authority}`);
      continue;
    }
    if (observation.process !== "stopped" && observation.process !== "not_deployed") {
      failures.push(`authority process is not stopped: ${authority}`);
    }
    if (observation.admission !== "closed" && observation.admission !== "not_applicable") {
      failures.push(`authority admission is not closed: ${authority}`);
    }
    if (observation.canMutate !== false) {
      failures.push(`authority can still mutate or is unknown: ${authority}`);
    }

    const capturedAtMs = Date.parse(observation.capturedAt);
    if (!Number.isFinite(capturedAtMs) || capturedAtMs > nowMs || nowMs - capturedAtMs > maximumEvidenceAgeMs) {
      failures.push(`authority evidence is missing, invalid, or stale: ${authority}`);
    }

    for (const source of requiredEvidence[authority]) {
      const matching = observation.evidence.find((entry) => entry.source === source && entry.reference.trim().length > 0);
      if (!matching) failures.push(`authority lacks ${source} evidence: ${authority}`);
    }
  }

  return { pass: failures.length === 0, failures };
}
