# Pricing Override Stale-Workspace Fix Summary

## Changed files in stale workspace
- client/src/features/quotes/editor/components/LineItemsSection.tsx
- client/src/features/quotes/editor/useQuoteEditorState.ts
- server/lib/lineItemPricingPersistence.ts
- server/routes/quotes.routes.ts
- server/storage/quotes.repo.ts
- server/tests/lineItemPriceOverrides.test.ts
- shared/lineItemPriceOverrides.ts

## Root causes discovered
- Quote line-item override PATCH had been passing JSON override metadata toward the legacy `quote_line_items.price_override` field instead of durable specs metadata.
- After the 500 was avoided, quote read/hydration still did not reliably surface `specsJson.priceOverride`, so reload returned No override/calculated price.
- Frontend override save could compute correct local UI state, then call save before React state committed, sending stale no-override payload.
- `overridePriceCents: 0` without explicit override metadata could be interpreted as an active fake Total override.
- Parent/line-item saves could send null override fields and clear server-side override metadata unintentionally.

## Intended metadata rules
- Durable metadata belongs in `quote_line_items.specs_json.priceOverride`.
- Legacy `quote_line_items.price_override` must not receive JSON override metadata.
- No override means missing/null explicit metadata; `overridePriceCents` alone is insufficient.
- `overridePriceCents: 0` plus no explicit metadata is No override.
- Intentional $0 override is valid only when explicit metadata includes mode and `valueCents: 0`.
- Revert clears `specsJson.priceOverride` and normalized override fields, restoring calculated pricing.
- Override-only PATCH should not force PBV2 repricing unless pricing drivers changed.

## Tests added in stale workspace
- Total override metadata hydrates from `specsJson.priceOverride`.
- Unit override metadata hydrates from `specsJson.priceOverride`.
- Explicit zero override survives while fake legacy zero is No override.
- Revert clears specs metadata and returns calculated price.
- Frontend hydration accepts `specsJson.priceOverride` when legacy `priceOverride` is null.

## Live DEV test outcomes before code fix
- Quote `5b708cc7-2757-4eab-bcd0-d79a09c853fa` / `QT-910321`.
- Line item `cbdc507c-8dbd-4bd6-952f-066bf163ce9a`.
- Baseline No override passed at `$8.88`, `$2.96/ea`.
- Total `$40`, Unit `$10/ea`, and explicit `$0` displayed correctly before reload but reverted to `$8.88` / No override after save/reload.
- Previous PATCH 500 was gone; persistence/hydration was still failing.
- No console error captured; PATCH response could not be captured through the Chrome tooling available at the time.
- Screenshots were saved under `codex-artifacts/quote-override-dev-910321/`.
