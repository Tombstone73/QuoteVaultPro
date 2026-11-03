# New Order PDF page dimensions

## Implementation

- The existing inbound PDF geometry detector is extracted unchanged into `server/services/artwork/analyzePdfSize.ts`. Inbound keeps its existing exported entry point and metadata persistence adapter.
- The authenticated, internal-staff `/api/artwork/pdf-size` endpoint is read-only. It accepts an uploader-owned finalized temporary Order upload, or a canonical file ID already attached to a tenant-scoped Quote/Order. Storage paths are never client inputs. Unlinked inbound evidence cannot use this endpoint.
- New Order's artwork panel displays inches, individual mixed-size pages, and an explicit **Apply to Line Size** action. Applying updates the shared width/height controls and existing PBV2 pricing pipeline. Fixed-size products retain configured size. PDF geometry remains informational.
- There are no migrations, new ownership records, storage writes, or changes to Order persistence, classification, approvals, routing, or production gates.
- Existing geometry limits remain 100 pages; the adapter permits at most 25 MiB and bounds inspection to 15 seconds. The client has a 20-second request timeout. Failure leaves manual dimensions available.

## Focused validation

- Scoped TypeScript: all 12 changed TypeScript source/test files, 8192 MB heap, zero diagnostics.
- Client Jest: 46 passing tests in the PDF dimensions, attachments panel, shared line editor, and override suites.
- Server Jest: 26 passing tests in the PDF detector, read-only adapter, and artwork access route suites.
- A real finalized local chunked upload was inspected without changing its session metadata. No PostgreSQL or remote storage was used; persistence contracts did not change.
- Local Chrome at 100% zoom, 1440 × 1000 CSS pixels: single-page decimal PDF, equal/mixed multipage PDFs, portrait/landscape selection, bad PDF fallback, explicit application, fixed-size product protection, canonical PBV2 request dimensions, quantity 28, exact $165 total override, failed submission retention, source upload IDs/roles, and mocked saved Order readback. Light/dark screenshots and keyboard focus were checked.
- Browser runner: `node --import tsx e2e/local-inbound-workflow/verify-pdf-artwork-dimensions.mjs`. It uses the real PDF detector with generated PDFs; upload transport, pricing responses, Order creation, and Order readback are mocked. Shared-editor rehydration is also covered by a component fixture, not a database readback.

## Outstanding acceptance

DEV deployment, remote storage access, real database save/reload, and live PBV2 repricing remain unverified. MAIN is not part of this release.
