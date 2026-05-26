# PBV2 Pricing Regression Checklist

Use this checklist when changing PBV2 pricing, Product Editor pricing preview, quote line pricing, order pricing, formula library handling, or pricing snapshots.

## Golden Fixture

The canonical regression fixture is Coroplast-style sheet-yield pricing:

- Formula source: Formula Library
- Formula: `sheet_consumption_sqft(w,h,q,sheet_width,sheet_length,usable_drop_min,billable_length_increment,minimum_billable_sqft) * base_price`
- Sheet: `48 x 96`
- Formula defaults: `usable_drop_min = 0`, `billable_length_increment = 1`, `minimum_billable_sqft = 32`
- Tier basis: `computed_sheet_usage`
- Tier rates: `1+ = 1.375`, `10+ = 1.03`, `51+ = 0.94`

## Required Assertions

- `24 x 18`, qty `8`, `10`, `91`, `100`, and `101` use layout-yield sheet counts, not finished-square-foot equivalents.
- `24 x 18`, qty `10` bills `32` sqft at `1.375` and totals `$44.00`.
- `24 x 18`, qty `91` and `100` select the `10+` sheet tier and bill `320` sqft.
- `24 x 18`, qty `101` bills `352` sqft and still selects the `10+` sheet tier.
- `24 x 36`, qty `5`, rotation off uses `4` pieces per sheet and `2` sheets.
- `24 x 36`, qty `5`, rotation on uses mixed layout, `5` pieces per sheet, and `1` sheet.
- High-precision tier rate `1.375` survives JSON save/reload and is not rounded to `1.38`.
- Quote aggregate totals use the current PBV2 line price, not stale quote totals.
- Pricing snapshots preserve formula source, selected tier, sheet-yield details, allow-rotation state, raw base price, and rounded totals.

## Test Entry Points

- `server/services/pricing/tests/fixtures/pbv2GoldenPricing.fixtures.ts`
- `server/services/pricing/tests/PricingService.goldenRegression.test.ts`
- `server/routes/helpers/tests/quoteTotals.helpers.test.ts`

Run before merging:

```bash
npm run check
npm test -- --runTestsByPath server/services/pricing/tests/PricingService.goldenRegression.test.ts server/routes/helpers/tests/quoteTotals.helpers.test.ts
```
