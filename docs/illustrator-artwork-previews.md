# Illustrator artwork previews (V1)

## Pipeline and source authority

Original uploads still use StorageApplicationService, file_records, canonical storage
placements, and the existing attachment/asset relationships. Preview generation runs
after persistence through the thumbnail and asset preview workers. Order/Quote saves
never await rendering. Header validation rejects known executable formats disguised
as Illustrator/EPS; unknown or malformed artwork is still stored and downloadable.

AI and EPS candidates are identified by filename or Illustrator/PostScript MIME.
Only a leading `%PDF-<version>` signature is rendered. PostScript/EPS signatures,
binary EPS, and unknown content get `preview_unsupported_*`. No PostScript is executed.

PDF-compatible AI uses the existing PDF.js + @napi-rs/canvas stack, now extracted into
a bounded first-page worker renderer shared with asset PDF previews. The older PDF
attachment page pipeline remains intact. Normal raster image generation uses sharp;
SVG behavior is unchanged. PDF.js standard fonts and CMaps come from the installed
package rather than remote resources.

The first artboard/page is the primary preview. There is no artboard manager or native
Illustrator parser. One render supplies a JPEG thumbnail (320px) and preview (1600px).
These are file_derivatives/asset variants, never separate original artwork records.
Derivative keys include the source file-record identity; attachment completion writes
are guarded against source replacement. Download All continues resolving originals
only. Production files, allocation, routing, ownership, and original bytes are unchanged.

## State and recovery

Existing enums are reused: attachment `uploaded`/`thumb_pending`/`thumb_ready`/
`thumb_failed`, asset `pending`/`ready`/`failed`. Unsupported is distinguished by the
safe `preview_unsupported_*` error category, avoiding a schema change. Other vector
failures use safe categories rather than converter diagnostics. Shared viewers display
generating, unavailable, or failed messages and preserve Download Original.

Existing worker triggers and fallback sweeps remain in place. Asset source-not-ready
retries are unchanged. Permanent unsupported results are terminal and never endlessly
retried. Existing Quote line-item thumbnail retry now accepts failed AI/EPS candidates
but excludes known unsupported results. No new Order retry endpoint was introduced.
After a terminal failure, originals remain available; no automatic infinite conversion
retry is added. Station thumbnail polling is bounded and cleans up timers/object URLs.

## Resource and security boundaries

- Preview input: 100 MiB ceiling, independent of the existing configured upload limit.
  Larger originals may still upload under the provider policy; preview fails safely.
- Remote source read: streaming byte cap, 30-second abort, body cancellation.
- Local source read: size check and capped chunks, closed file handle.
- Render: first page only, longest side at most 1600px, embedded-image cap 16M pixels.
- At most two vector reads/renders in flight; duplicate source work shares its promise.
  Capacity exhaustion is a safe transient failure, not an unbounded queue.
- Worker deadline: 30 seconds; worker always terminated, including timeout/failure.
- Worker V8 old-generation limit: 256 MiB (32 MiB young generation). This is not an OS
  RSS limit for native canvas allocations; output and embedded-image caps complement it.
- No shell or converter executable, no raw filename interpolation, and no renderer
  temporary files. Worker code is application-owned; PDF JavaScript evaluation is off.
- Source lookup checks organization ownership before private adapter access. Existing
  authenticated artwork endpoints serve derivatives. No service-role credentials,
  storage paths, source contents, or raw parser errors are sent to the viewer.

## Runtime and validation boundary

Existing production dependencies: pdfjs-dist, @napi-rs/canvas, sharp. No dependency,
Dockerfile, Nixpacks, Railway, or migration changes are required. No checked-in Railway
native-converter configuration was found. EPS needs a separately reviewed safe
PostScript conversion runtime and remains unsupported here.

Local native conversion uses Windows binaries; it does **not** prove Railway Linux
runtime availability. Tests generate their own PDF-compatible AI/artboard fixtures,
inspect actual output pixels, preserve source hashes, and cover unsupported/corrupt/
oversized/timeout cases. A generated local preview was opened and visually checked,
including text and colored artwork. Storage/persistence and UI tests use mocks; no
customer artwork, real storage upload, DEV, or MAIN validation is claimed.
