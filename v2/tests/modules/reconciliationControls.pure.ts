import assert from "node:assert/strict";
import {
  decideLockContention,
  decideNormalDrizzleGate,
  decideStageRun,
  type StageLedgerRecord,
} from "../../reconciliation/rehearsalControls.js";

const completed = (stage: StageLedgerRecord["stage"], postconditionDigest = `digest:${stage}`): StageLedgerRecord => ({
  stage,
  state: "completed",
  postconditionDigest,
});

assert.throws(() => decideStageRun("R0265", []), /R0264/, "stage order must fail closed before SQL");
assert.deepEqual(decideStageRun("R0264", []), { kind: "execute", stage: "R0264" });
assert.deepEqual(decideStageRun("R0265", [completed("R0264")]), { kind: "execute", stage: "R0265" });
assert.deepEqual(
  decideStageRun("R0265", [completed("R0264"), completed("R0265")], "digest:R0265"),
  { kind: "skip", stage: "R0265", reason: "already-attested" },
  "an already-attested stage must be idempotently skipped",
);
assert.throws(
  () => decideStageRun("R0265", [completed("R0264"), completed("R0265")], "changed"),
  /no longer matches physical attestation/,
  "completed stages must not silently skip after physical drift",
);
assert.throws(
  () => decideStageRun("R0266", [completed("R0264"), { stage: "R0265", state: "failed", postconditionDigest: null }]),
  /R0265/,
  "a retry must resume the failed stage, not advance past it",
);
assert.equal(decideLockContention(true), "proceed");
assert.throws(() => decideLockContention(false), /single-executor lock/, "lock contention must not wait or steal ownership");
assert.equal(decideNormalDrizzleGate({ hasHistoricalLedger: false, maximumJournalTimestamp: 0, reconciliationAttested: false }), "allow");
assert.throws(
  () => decideNormalDrizzleGate({ hasHistoricalLedger: true, maximumJournalTimestamp: 1788048000046, reconciliationAttested: false }),
  /R0269/,
  "the historic M0199 ledger requires attestation even if a subset of tables exists",
);
assert.equal(decideNormalDrizzleGate({ hasHistoricalLedger: true, maximumJournalTimestamp: 1788048000046, reconciliationAttested: true }), "allow");
assert.equal(
  decideNormalDrizzleGate({ hasHistoricalLedger: true, maximumJournalTimestamp: 1788048000047, reconciliationAttested: false }),
  "allow",
  "already fully migrated DEV-style ledgers remain on the ordinary migration path",
);

console.log("M7.2D reconciliation control pure checks passed");
