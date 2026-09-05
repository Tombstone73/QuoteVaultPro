export type CutoverAuthorityState = {
  authority: string;
  admission: "closed" | "not_applicable" | "unknown";
  process: "stopped" | "read_only" | "running" | "unknown";
  drain: "drained" | "safe_to_freeze" | "must_snapshot" | "must_reconcile_after_start" | "unknown";
  canMutateCutoverState: boolean;
};

export type CutoverWriterAssertion = {
  pass: boolean;
  failures: readonly string[];
};

/**
 * A pure gate for an operator-collected, per-authority manifest. It does not
 * discover or stop processes: missing/unknown authority fails closed so the
 * reconciliation executor cannot be authorized by operator memory alone.
 */
export function assertWriteFreeCutover(
  expectedAuthorities: readonly string[],
  observations: readonly CutoverAuthorityState[],
): CutoverWriterAssertion {
  const failures: string[] = [];
  const byAuthority = new Map<string, CutoverAuthorityState>();
  for (const observation of observations) {
    if (byAuthority.has(observation.authority)) failures.push(`duplicate authority observation: ${observation.authority}`);
    byAuthority.set(observation.authority, observation);
  }

  for (const authority of expectedAuthorities) {
    const observation = byAuthority.get(authority);
    if (!observation) {
      failures.push(`missing authority observation: ${authority}`);
      continue;
    }
    if (observation.canMutateCutoverState) failures.push(`authority can still mutate: ${authority}`);
    if (observation.admission === "unknown" || observation.process === "unknown" || observation.drain === "unknown") {
      failures.push(`authority state is unknown: ${authority}`);
    }
    if (observation.process === "running" && observation.admission !== "closed") {
      failures.push(`running authority lacks closed admission: ${authority}`);
    }
  }
  return { pass: failures.length === 0, failures };
}
