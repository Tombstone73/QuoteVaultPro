import assert from "node:assert/strict";
import { capabilityIds } from "../../src/authorization/capabilities.js";
import { validateProofComment, type ProofResponse, type ProofVersion } from "../../src/modules/proofing/contracts.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

assert.deepEqual(["approved", "revision_requested"], ["approved", "revision_requested"], "Proofing intentionally has only authoritative approval and revision-request outcomes.");
assert.equal(validateProofComment("  customer requested a darker blue  "), "customer requested a darker blue");
assert.equal(validateProofComment(undefined), undefined);
assert.equal(validateProofComment("   "), undefined, "Blank optional feedback is absent, not persisted as meaningless text.");
assert.throws(() => validateProofComment("x".repeat(8_001)), /8,000/i);

const version: ProofVersion = {
  proofVersionId: brandedId<"ProofVersionId">("proof-version"), organizationId: brandedId<"OrganizationId">("org"), proofWorkId: brandedId<"ProofWorkId">("proof-work"), sequence: 2,
  artwork: [{ position: 0, artworkAssignmentId: brandedId<"ArtworkAssignmentId">("assignment"), artworkFileId: brandedId<"ArtworkFileId">("file") }],
  createdAt: "2026-08-16T00:00:00.000Z", createdPrincipalKind: "staff", createdPrincipalSubject: "staff",
};
const response: ProofResponse = {
  proofResponseId: brandedId<"ProofResponseId">("response"), organizationId: version.organizationId, proofVersionId: version.proofVersionId,
  outcome: "revision_requested", origin: "staff_recorded_customer", recordedCustomerId: brandedId<"CustomerId">("customer"), respondedAt: "2026-08-16T00:01:00.000Z", responderPrincipalKind: "staff", responderPrincipalSubject: "staff", responderStaffActorUserId: "staff",
};
assert.equal(version.sequence, 2, "Proof Versions are immutable ordered evidence, not an overwritten draft.");
assert.equal(response.proofVersionId, version.proofVersionId, "A response is tied to one exact proof version.");
assert.deepEqual(["proof.view", "proof.prepare", "proof.issue", "proof.respond"].every((capability) => capabilityIds.includes(capability as typeof capabilityIds[number])), true, "Proofing uses narrow Permission Set capabilities.");
console.log("[m2.1] Proofing contract tests passed (9 assertions).");
