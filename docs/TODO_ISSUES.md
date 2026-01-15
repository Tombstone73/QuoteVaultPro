# TODO / Follow-ups

## 1) Fix VS Code Drizzle diagnostics mismatch (tsc clean)

- Title: Fix VS Code Drizzle diagnostics mismatch in manualInventoryReservationsRepo.ts
- Context: VS Code/Pylance reports Drizzle typing errors in `server/lib/manualInventoryReservationsRepo.ts` even though `npm run check` is clean.
- Goal: Align editor diagnostics with `tsc` (likely TS server config / moduleResolution / type acquisition).
- Acceptance:
  - No false-positive Drizzle diagnostics in VS Code.
  - `npm run check` remains clean.

## 2) Add endpoint-level tests for PBV2 override routes

- Title: Add endpoint-level tests for /pbv2/override routes
- Context: Current tests cover the pure selection helper only. The Express routes lack endpoint-level coverage.
- Goal: Add route tests for:
  - validate/save/toggle/disable happy paths
  - org scoping + auth/role guards
  - conflict behavior when enabled but missing override tree ID
- Note: Requires route injection/mocking (DB + auth) to stay DB-free or minimally integrated.
