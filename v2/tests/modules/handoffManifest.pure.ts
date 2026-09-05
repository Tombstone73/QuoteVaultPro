import assert from "node:assert/strict";
import { validateHandoffManifest, type HandoffManifest } from "../../src/modules/prepress/handoffManifest.js";

const manifest = (overrides: Partial<HandoffManifest> = {}): HandoffManifest => ({
  manifestId: "m7-cutover-001",
  capturedAt: "2026-09-05T12:00:00.000Z",
  sourceAuthority: "v1",
  sourceSnapshotFingerprint: "sha256:source-snapshot",
  records: [{
    domain: "production_job",
    legacyRecordId: "job-001",
    organizationId: "org-001",
    sourceState: "queued",
    currentAuthority: "v1",
    outstandingObligations: ["print job has not started"],
    claim: { ownership: "unclaimed", executionEvidence: ["queue-snapshot:001"] },
    outputReferences: [],
    providerState: [],
    disposition: "release_to_v2",
    expectedV2State: "queued",
    rollbackDisposition: "resume_v1",
  }],
  ...overrides,
});

assert.equal(validateHandoffManifest(manifest()).valid, true);

const claimed = manifest({ records: [{ ...manifest().records[0], claim: { ownership: "claimed", executionEvidence: ["worker-log:offset-7"] } }] });
assert.equal(validateHandoffManifest(claimed).valid, false, "active claims must not automatically move to V2");

const manual = manifest({ records: [{ ...claimed.records[0], disposition: "manual_adjudication", ambiguityReason: "SIGTERM may have interrupted the preflight pipeline." }] });
assert.equal(validateHandoffManifest(manual).valid, true, "ambiguous work is retained for manual adjudication");

const externalWithoutIdempotency = manifest({ records: [{
  ...manifest().records[0],
  domain: "delivery_queue",
  providerState: [{ provider: "email", observedState: "attempting", observedAt: "2026-09-05T12:00:00.000Z" }],
}] });
assert.equal(validateHandoffManifest(externalWithoutIdempotency).valid, false, "external delivery cannot be blindly handed off");

const duplicate = manifest({ records: [manifest().records[0], manifest().records[0]] });
assert.equal(validateHandoffManifest(duplicate).valid, false, "duplicate legacy records invalidate the manifest");

console.log("handoff manifest pure checks passed");
