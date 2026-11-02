# Railway DEV builder interruption — 2026-11-02

## Evidence

- Service: `Printershero-DEV`, Development environment.
- Failed deployment: `46684e91-a945-461f-9eb4-99cf32e097ac`.
- Source: `896e5f240d27c63b5402c3e57e2c3d9e1d45fd29`.
- Previous successful deployment: `5de6c732-6a43-4a2e-bfad-8234cdda1147`, source `306dfcc4fdaecbc07dbb5c024cc64ae1243172d6`.
- Both build logs identify Railpack `0.43.0`, Node `22.23.3`, `npm install`, `npm run build`, and `npm run start`.

The first meaningful failure, at 11:29:45 EST, was:

```text
Build Failed: build daemon returned an error < listing workers for Build: failed to list workers: Unavailable: connection error: desc = "error reading server preface: raw-read unix @->/run/buildkit/buildkitd.sock: use of closed network connection" >
```

The log ends after uploading the build snapshot, before loading the build definition or executing dependency installation/application compilation. The previous build passed those steps. There is no logged TypeScript, dependency, module resolution, environment-variable, or memory-limit failure. The failing source commit did not change dependencies, build scripts, or deployment configuration. The underlying cause of the builder connection closing is not exposed by these logs.

## Recovery and validation

This documentation commit requests a fresh automatic DEV build without changing application code or deployment settings. Both inbound fixes remain intact. No migrations, database operations, mailbox controls, or MAIN changes are included.

`npm run build` passed locally with an 8192 MB Node heap, building the frontend/backend and packaging the canonical migration journal through `0246_inbound_gmail_acknowledgements`. Local tooling is Windows Node `24.20.0` / npm `11.5.2`, rather than Railway's Linux Node `22.23.3`; this validates the application build command, not Railway's BuildKit daemon. Existing PostCSS, browser externalization, and chunk-size warnings were non-fatal.

Scoped TypeScript passed with the same heap limit. Focused regressions passed: 19 client tests covering draft ownership and import attention, plus 12 route/service tests covering draft saves, refresh, reopening, conversion/idempotency, import progress, and retry. These checks use fixtures/mocked dependencies; no new PostgreSQL, authenticated browser, provider, or live environment acceptance is claimed for this documentation-only recovery.

Railway's daemon failure cannot be reproduced or repaired inside this local application build. A new build must establish whether the provider interruption has cleared. If the same worker/socket failure recurs, investigate Railway builder availability with the deployment IDs above rather than changing inbound logic speculatively. Deployment completion and live DEV acceptance are deliberately not verified by this recovery task.
