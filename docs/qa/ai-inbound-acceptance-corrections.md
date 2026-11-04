# AI / Inbound Orders acceptance corrections

## Confirmed causes and correction

- PO badges used the file role alone and always said candidate. They now distinguish automatic candidates needing review from canonical staff-confirmed POs. File safety status remains separate.
- Parsing consulted saved review-link classifications but not canonical manual attachment metadata. Older snapshots could also overwrite newer fallback classifications. Canonical attachment review now wins; the newest review is the legacy fallback. This does not release quarantined files or reconcile changed source evidence.
- The existing PO heuristic missed a Quantity/Description table row, the literal Coro stock abbreviation and reversed Price Approved wording with a written final amount. The same extractor now recognizes those general forms. No customer-specific parser or material-unit conversion was added. The summary displays the structured approved/final amount before the first raw currency occurrence.
- Product matching ignored finished size. Shared catalog lookup now checks configured active PBV2 physical dimensions, supports rotated equivalent dimensions/units and prefers a compatible fixed-size yard-sign product. Custom-size requests exclude incompatible fixed sizes. Ambiguous compatible candidates still need staff confirmation. Canonical product IDs/categories, original yard-sign descriptions, specifications and evidence remain intact; no reporting or catalog records are rewritten.
- The Assistant's PO adapter previously used exact-name lookup independently. It now uses the same tenant-scoped active PBV2 matcher, retaining exact identity resolution and duplicate-PO checks. The canonical measurement resolver supplies fixed physical dimensions, including when source dimensions are unspecified; dimension-entry products still require valid sizes. Preview and creation preserve physical size. There is no hidden 1x1 physical size.
- Job Label was absent from inbound parsed/review schemas and Order conversion used a generic label. The optional JSON field now survives extraction, repair, explicit draft save, reconciliation and canonical Order creation. The ordinary New Order and inbound editor share the actual Job Label field. Legacy drafts can deliberately adopt a PO/subject suggestion; background refresh does not replace staff values.
- Source review uses the existing persisted, collapsed disclosure with bounded internal scrolling. Its summary keeps the approval gate visible. Refresh from Latest Parse is offered only when the server reports a usable newer parse; manual source review remains protected.
- The PO tool collapsed every exception into one business-validation failure. It now reports argument validation, attachment inspection, source verification or canonical preparation separately, with safe corrective guidance and schema issue paths. Existing observations, protected GO, current permissions, version fingerprints and duplicate detection are preserved.

## Original Brainstorm evidence

The original local Purchase Order 152989 was read and rendered through the existing canonical PDF services. One readable page; no OCR requirement demonstrated. SHA256: `76dbe5a1d425b30c2b82c7a2391c4986c790c4a93417a337de77b7b35dc84ba4`.

Confirmed source: quantity 10; 15.5 x 24 inches; 4/4, different images on each side; contour cut; November 5 EOD; explicitly written $55 + $25 rush = $80. The original says **4mil Coro**, while the task reference says 4mm Coroplast. The literal source is preserved; staff must confirm the stock specification rather than silently converting mil to mm. Requested deadlines and PO amounts remain source proposals, not automatically accepted commitments or selling-price overrides.

The private PDF and rendered page are not committed. `BRAINSTORM_PO_PDF` enables the original-document extraction/render regression; the normal suite also has a small source-text/parsed-response fixture. The configured AI provider was not invoked. These tests do not prove deployed model interpretation or live tenant catalog matching.

## Validation and limits

- Scoped TypeScript uses an 8192 MB heap; no full-codebase check.
- Focused frontend: 29 passing tests covering shared Order fields, confirmed classification projection, Job Label suggestions/save/refetch, source-review disclosure and existing import preferences.
- Focused server: 60 passing tests covering original PO extraction/rendering, active PBV2 size matching, literal material, price separation, legacy classification fallback, manual evidence, tool failure/retry, existing GO/permission/version/duplicate protections and required-dimension validation.
- Real disposable PostgreSQL: three new tests cover Job Label save/reload/reconciliation, stale saves, canonical Prepress conversion and duplicate retry; active catalog dimension fitting and tenant isolation; classification API persistence/audit and unchanged quarantine/source metadata. No deployed database was used.
- Local Chromium at normal zoom: real inbound/shared editor, mocked HTTP persistence. Confirmed PO action, Job Label failed-save retention and successful save/reload, background refresh, keyboard disclosure, preference persistence, light/dark and narrower viewport passed. Screenshots were inspected. This is not live DEV acceptance.

No migration, real customer Order, Gmail mutation, worker activation, provider setting change or MAIN push. Deployment was not awaited or verified.

## Outstanding acceptance

The reported Assistant `operator_tool_failure` cannot be tied to a specific live attempt without its diagnostic reference or authorized deployed audit access. The staged failure/retry path is exercised through fixtures; this is not a claim that the historical provider incident was reproduced. Recheck the configured provider, current catalog/options, intended stock thickness and deployed draft/GO flow during DEV acceptance. Existing Order 20952 was not modified or recreated.
