# Print Bridge recovery and UPS label orientation

## Findings and limits

The supported Windows agent is an outbound-only WinForms process in the signed-in
user's scheduled task, not an SCM/Session 0 service. `manage-agent-task.ps1`
already supports local restart. No authenticated remote service-management API
or tray controller existed. Browser controls cannot invoke arbitrary Windows
services, so Printer Settings now exposes local recovery instructions and the
rebuilt agent adds a tray controller for that same task.

The old reconnect catch-up depended on a second socket `Open` event before a
channel `Joined` event. A channel-only rejoin could therefore miss catch-up.
After initial subscription, a channel that never recovered also had no
application watchdog. Presence was reported only at startup. These source gaps
are reproduced by the focused connection-monitor tests; the exact cause of the
reported workstation outage is **not established without workstation logs**.
The installed Supabase.Realtime 7.4.0 already reconnects sockets/channels. Its
API contract is retained, including connect-before-channel and publishable-key
parameters; no provider configuration or keys are changed.

In this checkout the carrier path requests **GIF**, persists the original GIF
bytes/hash, and serves them unchanged. It does not fetch a carrier PDF or store
PDF rotation metadata. Browser Print put the uncorrected raster into a portrait
4×6 page using `object-fit:contain`. A landscape label with left-turned text
therefore remained sideways in browser-generated PDF output before any driver
was involved. Synthetic GIF/PDF fixtures reproduce that path. The actual failing
live artifact has not been inspected, so its dimensions and origin remain an
acceptance check; this is not a diagnosis of an unseen carrier PDF.

## Changes

- Agent 1.0.29 supervises channel recovery, catches up after channel-only rejoin,
  bounds initial connect/join waits to 20 seconds, and recreates a channel still
  unavailable after 60 seconds. Backoff is capped at 30 seconds. Late abandoned
  connection attempts are cleaned up. No recurring **print queue** polling.
- Status-only authenticated heartbeats every 30 seconds (20-second HTTP timeout)
  persist fixed diagnostic categories and server timestamps in additive
  `0249_print_bridge_connection_health.sql`. No token/raw exception is stored.
  UI refreshes status every 15 seconds and marks reports older than 90 seconds
  disconnected. Legacy agents remain unknown; old API contact is not asserted
  to mean Realtime connectivity. Revoked identities require authentication.
- Tray restart reserves an idle queue scheduler before invoking the packaged
  local task controller. Controller restart checks the installed task before
  stopping a process. No LAN listener, remote restart endpoint or second service.
- The durable queue's conditional `queued → claimed` update is unchanged.
  Reconnect never requeues claimed/submitted jobs. A possibly spooled job whose
  acknowledgement failed needs operator review and deliberate reprint.
- One server renderer turns supported landscape UPS GIF pixels clockwise once;
  portrait sources are not turned. It emits lossless PNG for preview/direct
  print and a 288×432 pt PDF with zero `/Rotate`. It uses uniform scaling with
  no clipping/stretching and rejects invalid/animated/unsupported geometry.
  Original evidence image downloads and ZIP archives remain byte-for-byte
  originals. No shipment purchase or tracking identity changes.
- Existing job-bound authentication, printer profiles and queue mapping serve
  Zebra 450 and Epson separately. Zebra uses the installed Windows driver,
  explicit portrait 4×6 media, and raster output; no ZPL support is assumed.

## Local validation

Focused Jest coverage includes pixels/bar widths/spacing, real PDF geometry,
old/new claimed-image formats and readiness, recovery fallback, safe states,
atomic claims, idempotent reprints, permissions, and existing Epson/Traveler
contracts. The .NET harness exercises STA dispatch, coalescing, channel-only
rejoin, recovery deadline/reset, and restart reservation. Disposable loopback
PostgreSQL verifies canonical migration history, heartbeat readback, invalid
reports, tenant/admin isolation, and one claim/submission for each synthetic
Epson/Zebra queue. No physical printer or deployed record is touched.

Poppler-rendered fixtures were inspected visually. Browser checks use the real
React recovery components with synthetic status, normal zoom, light/dark themes,
keyboard navigation and a narrow viewport. They do not prove Windows restart
or physical spool/paper output. Scoped TypeScript compares changed roots against
HEAD; unchanged pre-existing diagnostics are identified separately.

## Deployment acceptance

1. DEV auto-deploy must apply migration 0249. This task does not wait for it.
2. On the **paired shop workstation**, download the new self-contained package,
   extract over its stable installation folder, and run `setup-agent.cmd` to
   preserve/reload pairing. Cloud push alone does not update installed agents.
3. Verify the executable/tray reports 1.0.29 and current heartbeat. Exercise
   idle disconnect/reconnect and tray restart. If unavailable, run
   `.\scripts\manage-agent-task.ps1 -Action restart` locally; use
   `.\setup-agent.ps1 -Check` and the local log for errors. Never post tokens.
4. Inspect the affected original live label and new 4×6 PDF. Unsupported stock
   must be reviewed rather than silently fitted. A non-UPS PDF path is not
   changed by this UPS-specific correction.
5. Deliberately print a saved label on the mapped Zebra 450 queue; verify stock,
   orientation, quiet zones, barcode scanning and no extra pages. Verify Epson
   TM-L90 ticket output remains correct. Successful spool status is not proof of
   physical output. No shipment should be purchased to perform these checks.

Provider references consulted: [C# subscription documentation](https://supabase.com/docs/reference/csharp/subscribe),
[installed-client changelog](https://github.com/supabase-community/realtime-csharp/blob/master/CHANGELOG.md),
[UPS Shipping schema](https://github.com/UPS-API/api-documentation/blob/main/Shipping.yaml).
