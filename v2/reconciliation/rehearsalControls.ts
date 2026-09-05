/**
 * Pure control model used to rehearse the failure behaviour of the direct
 * reconciliation executor. It has no PostgreSQL or infrastructure imports.
 */
export const reconciliationStages = ["R0264", "R0265", "R0266", "R0267", "R0268", "R0269"] as const;
export type ReconciliationStage = (typeof reconciliationStages)[number];
export type ReconciliationStageState = "running" | "completed" | "failed";

export type StageLedgerRecord = {
  stage: ReconciliationStage;
  state: ReconciliationStageState;
  postconditionDigest: string | null;
};

export type StageDecision =
  | { kind: "execute"; stage: ReconciliationStage }
  | { kind: "skip"; stage: ReconciliationStage; reason: "already-attested" };

function predecessor(stage: ReconciliationStage): ReconciliationStage | undefined {
  const index = reconciliationStages.indexOf(stage);
  return index > 0 ? reconciliationStages[index - 1] : undefined;
}

/** Fails closed before SQL if order or completed-stage attestation is unsafe. */
export function decideStageRun(
  stage: ReconciliationStage,
  ledger: readonly StageLedgerRecord[],
  observedPostconditionDigest?: string,
): StageDecision {
  const previous = predecessor(stage);
  if (previous && ledger.find((entry) => entry.stage === previous)?.state !== "completed") {
    throw new Error(`${stage} cannot run before ${previous} is completed.`);
  }

  const current = ledger.find((entry) => entry.stage === stage);
  if (current?.state !== "completed") return { kind: "execute", stage };
  if (!current.postconditionDigest || current.postconditionDigest !== observedPostconditionDigest) {
    throw new Error(`${stage} completed ledger entry no longer matches physical attestation.`);
  }
  return { kind: "skip", stage, reason: "already-attested" };
}

/** A second executor must not wait, steal, or retry through an active lock. */
export function decideLockContention(acquired: boolean): "proceed" {
  if (!acquired) throw new Error("another reconciliation executor holds the single-executor lock.");
  return "proceed";
}

export type DrizzleGateInput = {
  hasHistoricalLedger: boolean;
  maximumJournalTimestamp: number;
  reconciliationAttested: boolean;
};

const m0199JournalTimestamp = 1788048000046;

/**
 * The historical M0199-shaped ledger is never enough on its own. Once it is
 * present, normal Drizzle requires R0269 regardless of a manually created
 * subset of V2 relations.
 */
export function decideNormalDrizzleGate(input: DrizzleGateInput): "allow" {
  const needsReconciliation = input.hasHistoricalLedger && input.maximumJournalTimestamp === m0199JournalTimestamp;
  if (needsReconciliation && !input.reconciliationAttested) {
    throw new Error("normal Drizzle is blocked until R0269 physical attestation succeeds.");
  }
  return "allow";
}
