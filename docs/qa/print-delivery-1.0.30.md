# Print delivery repair 1.0.30

## Read-only workstation evidence (2026-11-04)

Execution host: DESKTOP-IISK3B3. Installed/running agent: 1.0.29.
Canonical logs: `%LOCALAPPDATA%\PrintersHero\print-agent.log` and
`%LOCALAPPDATA%\PrintersHero\print-agent-launcher.log`.
The installed scheduled task is `PrintersHero Traveler Print Agent`.
No installed agent, task, spooler, or customer record was modified.

UPS job `04366c8e-3f14-44c8-9273-e6abe35c16e5`:

- 15:35:19 UTC (10:35:19 Indianapolis): discovered, claimed, Zebra ZP 450 CTP selected.
- 15:35:20 UTC: authenticated document page navigation succeeded.
- 15:35:21.127 UTC: source response HTTP 422.
- 15:35:21.195 UTC: `Shipping document render failed: error`.
- No PrintAsync call or Windows acceptance was logged for this job.
  The old "Spooling" log precedes rendering and does not establish submission.
- It is the only UPS attempt around the operator-reported Order 20871 event.
  The persisted Order/shipment join, internal agent ID, and final failed status
  could not be independently read: browser control failed before page access,
  and no authorized production database connection was available.

Zebra and Epson profile tests around the same period reached Windows acceptance;
this does not establish physical output. Six saved local UPS GIF artifacts
reproduce the geometry defect (not independently proven to be this Order's file).
All were 1400x800; clockwise rotation leaves 198 white trailing rows beyond
800x1202 content. Pure in-memory rendering accepted all six after the correction;
original file hashes were unchanged. No label contents or credentials are fixtures.

## Correction and recovery boundaries

The shared server renderer removes verified white trailing padding from legacy
7x4 GIF canvases only. Every nonwhite pixel remains; unsupported geometry still
fails. Original carrier evidence, tracking, purchase and shipment remain intact.
Existing 1.0.29 can consume the corrected server derivative on a deliberate new
request. Failed historical jobs are never replayed automatically.

Packaged 1.0.30 additionally uses the existing bounded heartbeat to signal queued
work through the same STA scheduler/atomic claim after a missed wake. Claimed,
failed or submitted records cannot be reclaimed. Windows acceptance followed by
failed server acknowledgement remains uncertain, rather than a false safe failure.
A manual package update is needed for these agent improvements; none was installed.

Read-only, authenticated tenant-scoped diagnostics show persisted job identity,
agent, configured queue, claim/submission/failure times and bounded errors.
They distinguish queue recording from Windows submission and physical output.
Add Printer is viewport-bounded; Archive retains existing job history; the tray
uses the packaged brand icon and setup explains its expected wait.

## Alignment artifact

The existing profile-test route now displays a synthetic portrait 4x6-inch SVG:
1/8-inch inset boundary, four corner labels, orientation/dimension indicators,
printer identity and Code 128-B TEST (checksum 76). No carrier operation changes.
Local Chromium at device scale 1 measured 384x576 CSS pixels; printed PDF was
one 288x432 pt page, rotation 0. Screenshot visually inspected. Windows settings
retain exact profile queue, portrait custom 4x6 media, zero margins and backgrounds.
Physical margins, barcode scanning and driver scaling still require operator review.

## Focused validation

- Scoped TypeScript, 8192 MB heap: 20 changed/new roots, zero introduced errors;
  four pre-existing test diagnostics remain. Compared against the HEAD baseline.
- 62 focused server tests: renderer, delivery, queue mapping, wake and agent contracts.
- 26 focused client tests: source readiness/errors, dialog idempotency, diagnostics and form.
- Six real loopback disposable PostgreSQL tests: heartbeat persistence, queued recovery,
  concurrent claim, submitted/failed no-reclaim, diagnostic auth/tenant boundaries,
  claimed legacy-label source, original-byte preservation and authenticated downloads.
  All 244 existing canonical migration hashes verified; no new migration.
- .NET contracts and self-contained win-x64 1.0.30 package build. Existing
  WebView2 WindowsBase assembly warning remains; no new compile error.
- Local synthetic browser/PDF geometry and six read-only actual carrier artifacts.

No physical print, restart, replay, new purchase/void, deployment verification or
production-data mutation occurred. DEV/MAIN runtime and physical acceptance remain
outstanding. Deployable but not yet live-validated.
