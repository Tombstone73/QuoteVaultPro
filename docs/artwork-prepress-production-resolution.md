# Artwork resolution after Prepress

## Cause

The bypass path displays ordinary artwork from `line_item_artwork` through the
authenticated canonical file reader. A direct Prepress final upload correctly
persists a permanent `file_records` identity, storage placement, and an active
`line_item_files` final relationship. Final workflow outputs, including generated
layouts, do not automatically become ordinary artwork owners.

Production previously filtered ordinary artwork by those final-file identities.
When a new final had no ordinary-artwork relationship, that intersection was
empty even though its physical file and final relationship were valid. Completed
Production history could instead fall back to a different customer source.

The final-file panel and Flatbed enlarged viewer also rendered protected relative
URLs directly as images. That bypassed `apiFetch` and its API-origin/authentication
handling, unlike the working bypass-path artwork renderer.

## Correction and integrity

- `resolveProductionArtworkReferences` selects active final workflow references
  when present, and canonical ordinary artwork when no final exists. Its batch
  reader joins physical file metadata through the requested tenant.
- Production board/detail, completed history, and Fulfillment use that selection.
  Display references identify their actual source (`canonical` or `line_item_file`)
  and preserve file IDs, sides, quantities, and allocation groups. They do not
  invent ordinary ownership records or relationship IDs.
- Invalid/missing/foreign final references never cause substitution with an
  obsolete source. Existing legacy file download behavior remains available.
- Final thumbnails and the enlarged Flatbed viewer use the existing authenticated
  artwork blob reader. The selected file ID stays the same for original,
  thumbnail, and preview access. Object URLs are revoked on replacement/unmount.
- No upload, promotion, handoff, proof approval, production routing, combined-run,
  fulfillment mutation, storage lifecycle, or artwork ownership writer changes.
  No migration, file copy, ownership backfill, or customer repair is required.

Ordinary Order/Prepress/proof readers retain their established source/history
semantics. Superseded final workflow rows remain historical; active final rows
select the displayed print version. Existing physical archive/restore policy is
unchanged; this correction does not make archived or missing storage available.

## Validation

- Scoped TypeScript passes with `NODE_OPTIONS=--max-old-space-size=8192`.
- 25 focused client tests pass for authenticated image/preview reads, blob cleanup,
  preview polling, error states, and shared Production viewer behavior.
- 70 focused backend/shared tests pass for canonical reads, authorization,
  Fulfillment projection, Prepress promotion, proof preview, deletion safety,
  combined-run file contracts, and production hydration.
- Nine disposable PostgreSQL integration tests pass. They use real canonical
  migrations, records, placements, Prepress file operations, actual Complete
  Prepress, Production/detail/history routes, Fulfillment reads, and authenticated
  artwork content routes. They cover bypass, unchanged assignment, new final
  output, multiple files/lines, replacement versions, historical references,
  missing/foreign references, and preview failure without ownership mutation.
- The database reproduction explicitly shows the old ordinary-artwork/final-ID
  intersection is empty while the shared workflow projection resolves the same
  valid final file. Source placements and ordinary artwork remain unchanged.

Integration tests use isolated local file bytes. The object-store adapter's read
seam maps private derivative keys to those local bytes; provider access is not
live. Thumbnail generation is deliberately stubbed to fail, and fixture derivative
metadata/bytes are supplied separately to test successful retrieval. The test
does not claim real hosted thumbnail generation or cloud credentials work.

No operational Order, mailbox, Gmail message, hosted object, or MAIN state is
changed during validation. MAIN's live affected records were not inspected and
no deployment or live browser acceptance is claimed.
