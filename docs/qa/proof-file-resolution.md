# Proof generation and version-file resolution

## Established defect

Staff Proofing resolved `proofVersion.proofFileId` through the ordinary line-file
listing. That listing intentionally projects canonical artwork and reference
assets, whereas generated proofs are `orderAttachments` with role `proof`.
Consequently a persisted proof attachment was absent from the viewer's lookup.
The viewer reported a missing file even when the canonical original existed.
Draft/send readiness previously trusted artifact metadata without reading the
original. This finding is reproduced with isolated records; it does not prove
the physical storage state of MAIN Job 20937.

## Correction

- Resolve staff files by the tenant-scoped proof version and its exact attachment.
- Reuse canonical authenticated original-file access; retain historical original
  paths only when there is no canonical file identity. Never replace an unavailable
  canonical original with another version, artwork, or thumbnail.
- Validate generated PDF bytes after storage readback before publishing a version.
- Recheck originals before send/resend. Browser readiness requires an authenticated
  preview for the currently selected file, with no loading/validation error.
- Retry file access reloads the same version and does not generate another proof.
- Generation requests carry an actor/tenant/payload-bound request identity;
  transaction advisory locks plus committed audit results provide replay after a
  lost response. Older clients without request identities remain compatible.
- Combined generation takes workflow row locks after storage finalization, then
  verifies the input snapshot before publishing. This avoids blocking the storage
  service's separate attachment transaction on foreign-key locks.

No migration, artwork ownership change, historical-version repair, or MAIN data
mutation is included.

## Validation

- Scoped TypeScript uses an 8192 MB heap and checks changed/new source files,
  tests and the local browser fixture; no full-codebase check.
- 23 focused server tests cover original/legacy reads, invalid PDF bytes,
  preview resolution, PDF composition and optional derivative failures.
- 21 focused frontend tests cover proof-file readiness, preview URLs, page counts,
  recovery and version selection.
- Eight real loopback PostgreSQL tests use canonical migrations, storage writes,
  file placements, version persistence and authenticated HTTP reads. They cover
  concurrency/replay, tenant/auth boundaries, upload/readback failures, missing
  references/objects, legacy access, stale generation inputs, combined proofs,
  history, safe retry and the existing send/approval transition.
- Only optional derivative generation is stubbed in those PostgreSQL tests.
  Canonical original storage and retrieval use actual isolated local files.
- The actual Staff Proofing page and shared PDF viewer were checked at normal
  browser zoom using the local fixture, including missing-file gating, recovery,
  page count and visually rendered PDF content. Browser HTTP/persistence is mocked
  from synthetic PostgreSQL results; this is not remote-storage or deployed DEV
  validation. The embedded browser's native PDF iframe was blank, but the shared
  canvas PDF viewer rendered the generated PDF successfully.

## Existing MAIN versions

If their canonical originals still exist, the corrected version-file lookup can
display them without editing or regenerating history. If objects are missing,
existing storage placements/backups must be inspected; a file record alone cannot
recover deleted bytes. No MAIN version has been regenerated, changed or deleted.
Chrome automation access failed and the in-app production browser required login,
so Job 20937's actual files and recovery eligibility remain unverified.
