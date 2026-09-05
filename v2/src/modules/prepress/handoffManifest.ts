/**
 * Pure, transport-agnostic cutover manifest contract.
 *
 * This module intentionally does not read a database, start a worker, or call a
 * provider. A cutover controller must capture the records from its authoritative
 * sources, validate them here, and retain the resulting immutable manifest before
 * releasing any V2 writer.
 */

export const handoffDomains = [
  "order",
  "production_job",
  "invoice",
  "payment",
  "provider_queue",
  "delivery_queue",
] as const;

export type HandoffDomain = (typeof handoffDomains)[number];
export type HandoffAuthority = "v1" | "v2" | "external" | "manual" | "unknown";
export type ClaimOwnership = "unclaimed" | "claimed" | "unknown";
export type HandoffDisposition = "retain_v1" | "release_to_v2" | "manual_adjudication" | "no_action";
export type RollbackDisposition = "resume_v1" | "forward_reconcile" | "manual_only";

export interface HandoffClaimEvidence {
  readonly ownership: ClaimOwnership;
  readonly claimant?: string;
  readonly claimedAt?: string;
  readonly heartbeatAt?: string;
  /** Immutable observation IDs, log offsets, or content fingerprints; never credentials. */
  readonly executionEvidence: readonly string[];
}

export interface ProviderStateObservation {
  readonly provider: string;
  readonly externalReference?: string;
  readonly observedState: string;
  readonly observedAt: string;
  readonly idempotencyReference?: string;
}

export interface HandoffManifestRecord {
  readonly domain: HandoffDomain;
  readonly legacyRecordId: string;
  readonly organizationId?: string;
  readonly sourceState: string;
  readonly currentAuthority: HandoffAuthority;
  readonly outstandingObligations: readonly string[];
  readonly claim: HandoffClaimEvidence;
  /** Durable object keys, checksums, or other non-secret output references. */
  readonly outputReferences: readonly string[];
  readonly providerState: readonly ProviderStateObservation[];
  readonly disposition: HandoffDisposition;
  readonly expectedV2State?: string;
  readonly rollbackDisposition: RollbackDisposition;
  readonly ambiguityReason?: string;
}

export interface HandoffManifest {
  readonly manifestId: string;
  readonly capturedAt: string;
  readonly sourceAuthority: "v1";
  /** Hash/fingerprint of the read-only source snapshot, not a connection string. */
  readonly sourceSnapshotFingerprint: string;
  readonly records: readonly HandoffManifestRecord[];
}

export interface HandoffManifestValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

const hasText = (value: string | undefined): boolean => Boolean(value?.trim());
const isTimestamp = (value: string | undefined): boolean => Boolean(value && Number.isFinite(Date.parse(value)));

/**
 * Enforces cutover safety rather than business-state inference. In particular, it
 * never turns an active/unknown claim into V2 work and never authorizes a blind
 * retry of provider or delivery work.
 */
export function validateHandoffManifest(manifest: HandoffManifest): HandoffManifestValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!hasText(manifest.manifestId)) errors.push("manifestId is required.");
  if (!isTimestamp(manifest.capturedAt)) errors.push("capturedAt must be an ISO-compatible timestamp.");
  if (manifest.sourceAuthority !== "v1") errors.push("A cutover manifest must name V1 as its source authority.");
  if (!hasText(manifest.sourceSnapshotFingerprint)) errors.push("sourceSnapshotFingerprint is required.");
  if (manifest.records.length === 0) errors.push("A handoff manifest cannot be empty.");

  const identities = new Set<string>();
  for (const [index, record] of manifest.records.entries()) {
    const label = `records[${index}]`;
    const identity = `${record.domain}:${record.legacyRecordId}`;
    if (!handoffDomains.includes(record.domain)) errors.push(`${label}.domain is invalid.`);
    if (!hasText(record.legacyRecordId)) errors.push(`${label}.legacyRecordId is required.`);
    if (identities.has(identity)) errors.push(`${label} duplicates ${identity}.`);
    identities.add(identity);
    if (!hasText(record.sourceState)) errors.push(`${label}.sourceState is required.`);
    if (!record.outstandingObligations.every(hasText)) errors.push(`${label}.outstandingObligations must contain only non-empty descriptions.`);
    if (!record.claim.executionEvidence.every(hasText)) errors.push(`${label}.claim.executionEvidence must contain only non-empty evidence references.`);
    if (!record.outputReferences.every(hasText)) errors.push(`${label}.outputReferences must contain only non-empty references.`);

    for (const [providerIndex, provider] of record.providerState.entries()) {
      const providerLabel = `${label}.providerState[${providerIndex}]`;
      if (!hasText(provider.provider)) errors.push(`${providerLabel}.provider is required.`);
      if (!hasText(provider.observedState)) errors.push(`${providerLabel}.observedState is required.`);
      if (!isTimestamp(provider.observedAt)) errors.push(`${providerLabel}.observedAt must be an ISO-compatible timestamp.`);
    }

    const ambiguousClaim = record.claim.ownership === "claimed" || record.claim.ownership === "unknown";
    if (ambiguousClaim && record.disposition === "release_to_v2") {
      errors.push(`${label} has a ${record.claim.ownership} claim and cannot be released to V2 automatically.`);
    }
    if (ambiguousClaim && record.disposition !== "manual_adjudication" && record.disposition !== "retain_v1") {
      errors.push(`${label} has a ${record.claim.ownership} claim and must remain V1-owned or require manual adjudication.`);
    }
    if (record.disposition === "manual_adjudication" && !hasText(record.ambiguityReason)) {
      errors.push(`${label}.ambiguityReason is required for manual adjudication.`);
    }
    if (record.disposition !== "manual_adjudication" && hasText(record.ambiguityReason)) {
      warnings.push(`${label} has an ambiguity reason but is not marked for manual adjudication.`);
    }
    if (record.disposition === "release_to_v2") {
      if (record.currentAuthority !== "v1") errors.push(`${label} can release to V2 only from current V1 authority.`);
      if (!hasText(record.expectedV2State)) errors.push(`${label}.expectedV2State is required before release to V2.`);
      if (record.claim.ownership !== "unclaimed") errors.push(`${label} must have an unclaimed work record before release to V2.`);
    }
    if ((record.domain === "provider_queue" || record.domain === "delivery_queue") && record.disposition === "release_to_v2") {
      if (record.providerState.length === 0) errors.push(`${label} cannot release external queue work without an observed provider state.`);
      if (!record.providerState.some((entry) => hasText(entry.idempotencyReference))) {
        errors.push(`${label} cannot release external queue work without an idempotency reference.`);
      }
    }
    if (record.currentAuthority === "unknown" && record.disposition === "release_to_v2") {
      errors.push(`${label} has unknown authority and cannot be released to V2.`);
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
