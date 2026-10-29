# Inbound email evidence and review coverage

This milestone adds evidence tracking and approval protection to the existing manual intake/review flow. It does not enable an automatic AI worker, acknowledge Gmail, change the quote queue, or integrate the broader Assistant.

## Identity and coverage

`fingerprintInboundEmailEvidence` hashes an explicit source-data projection: email identity, sender, subject, bodies, original message dates, thread messages, combined source text, attachment candidate metadata, and persisted inbound file identity/content/safety fields. Lists are sorted before hashing. Retrieval dates, local row/storage IDs, ingestion diagnostics, and staff review values do not participate. The canonical record stores `normalizedPayloadJson.evidenceFingerprint`; parse attempts store their captured version in `rawResponse.inboundEvidenceFingerprint`; immutable review snapshots store the version they cover in `payloadJson.metadata.evidenceFingerprint`.

Attachment checksums detect changed stored bytes. When bytes/checksums are unavailable, identity relies on provider attachment IDs, filenames, MIME types, sizes, and supplied source metadata. A provider replacing bytes while retaining all of that metadata cannot be detected until a new checksum is persisted. This implementation does not redownload bytes or issue network requests to verify identity. Canonical stored files are assumed immutable; changing bytes behind an unchanged canonical checksum is outside this guarantee.

## Review behavior and legacy records

Evidence writers retain all review snapshots and staff edits. A differing or absent covered fingerprint requires review and removes readiness from an unconverted, active record. The existing review interface displays the state and an explicit refresh action. Parsing an email retains an existing review draft; it does not refresh it automatically. Saving edits and reopening a draft preserve its prior coverage, even if a client submits forged coverage metadata.

An explicit refresh adopts only the fingerprint of its tenant-scoped persisted parse attempt, checked against current persisted evidence under the lock. Previous staff edits remain available in snapshot history. A parse that finishes after evidence changes remains an auditable suggestion for its original version; it cannot approve current evidence or clear its reparse requirement.

**Legacy policy:** a draft or parse attempt with no tracked evidence version is unverified. Reading or saving it never stamps current evidence onto it. Staff must parse current evidence and explicitly refresh before approval/conversion. Already linked downstream orders/quotes are not rewritten or recreated by tracking.

## Concurrency protocol

Evidence writes, snapshot saves/readiness, and conversion decisions use PostgreSQL transactions with a transaction-scoped advisory lock keyed by organization (`inbound-evidence:<organizationId>`), followed by a tenant-scoped inbound row `FOR UPDATE`. The organization scope covers combined-record membership and child attachments without parent/child lock-order races. This conservatively serializes short inbound write transactions within one tenant; large conversions may delay another inbound write in that tenant.

Order conversion checks both the exact snapshot used for preparation and its evidence coverage inside the existing conversion transaction, before its normal claim/order creation. Quote conversion and direct ready/approved/submitted status transitions also check inside their mutation transactions. Snapshot readiness and its record transition commit atomically. Record/file writers use the same protocol and recompute canonical identity before committing. Existing combined-parent evidence is invalidated when a child attachment changes. No AI or Gmail calls occur while these locks are held.

Future evidence writers must use this repository protocol. Out-of-band SQL writes do not participate in the advisory lock and are outside its concurrency guarantee.

## Validation boundary

Focused tests exercise the fingerprint, repository transaction decisions with a mocked Drizzle executor, route behavior, parsing, review/conversion, ingestion, and the review UI. Mocked lock calls demonstrate protocol participation; they do not prove PostgreSQL lock scheduling. Actual database concurrency requires a separately configured disposable database. No production data or services are provisioned for this milestone.
