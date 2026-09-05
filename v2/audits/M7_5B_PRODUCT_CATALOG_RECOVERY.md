# M7.5B Product Catalog / Product Builder recovery

**Disposition:** PASS WITH FINDINGS — deployable source correction; not live-validated.
**Scope:** `dev` only. No DEV or production data, ProductVersion, provider, or deployment was changed.

## Root cause

Catalog navigation was already correct: a row's `Edit` action carries the stable Product ID to `/product-builder/:id?draft=1`. The defect was in `ProductDraftEntry`: it treated the coexistence of an Active pointer and a Draft pointer as a recovery condition and rendered the recovery/abandon panel.

That condition is the normal `active_with_draft` lifecycle. The Active ProductVersion is immutable history; the current Draft is the canonical editable version. The Catalog and repository both select the current Draft consistently, so the UI was misclassifying valid data. Its visual contract had codified the same mistake.

## Lifecycle behavior after the correction

| Product state | Result |
| --- | --- |
| Active only | Existing lifecycle creates a Draft from the Active version, then opens the Builder. |
| Active + valid Draft | Opens the current Draft in the canonical Product Builder. |
| Draft only | Opens the current Draft in the canonical Product Builder. |
| Inactive with Draft | Existing Draft-only editing policy is unchanged. |
| Missing/malformed Draft data | No recovery state is inferred from pointers. The current backend contract has no authoritative malformed/recoverable classification, so no destructive or misleading abandon action is offered. |

The false Draft Recovery panel and its Abandon Draft action were removed. Recovery must only be introduced later with a server-provided reason and lifecycle-safe action; it must not be guessed from Active + Draft.

## Source and history safety

- The Builder retains its existing server-authoritative reads for general configuration, options/rules, pricing, formulas, matrices, recipe, routing, and pricing preview. No local pricing authority was introduced.
- No historical ProductVersion is updated or deleted. Existing lifecycle creation/publish flows remain the only writers.
- The lifecycle reader now fetches the exact Active version referenced by the Product pointer when that version falls outside the bounded history window. This prevents a busy Product with newer drafts/history from appearing to lack its Active configuration.

## DEV scope evidence

No authenticated DEV runtime environment is available in this workspace, so this milestone did not connect to DEV. The last safe read-only DEV inventory (2026-09-05) recorded 35 Products in the primary operational organization, 26 non-null Active-version pointers, and 19 Draft versions. Those aggregate counts do not prove the Active/Draft intersection, structural validity, or current UI success rate, so they are not represented as current live-validation results. The same inventory recorded compatibility fields used by operational Products; they remain untouched.

## Findings

- **P0 resolved in source:** normal Active + Draft Products no longer land in false Draft Recovery.
- **P1 remaining:** the API does not classify malformed historical Drafts with a reason. A future recovery UX needs that explicit contract before it can safely offer an abandon/recreate action.
- **P1 remaining:** authenticated DEV visual validation of representative Banner, Coroplast, OppBogga, Ultraboard, quantity-only, formula-priced, and matrix-priced Products was unavailable here.
- **P2 resolved in source:** an old but pointed Active ProductVersion is no longer lost behind the bounded lifecycle history window.
