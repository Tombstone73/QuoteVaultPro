# M1.3 Compatibility Reads

## Boundary

M1.3 adds read-only anti-corruption adapters over the compatible PostgreSQL schema. They accept explicit organization scope, return V2 DTOs, and expose neither raw Drizzle/PostgreSQL rows nor PBV2 tree JSON to Sales. There are no Customer, Product, PBV2, Sales, Billing, or other commercial writers.

## Customers / CRM

`PostgresCustomersCompatibilityReader` reads a Customer only with its organization and an active commercial lifecycle: active flag, non-archived/non-deleted status, and no merge successor. Contact reads are organization-scoped and active-only.

Customer/contact membership is proven only through `customer_contact_links` with an active link, active Contact, and same-organization active Customer. The deprecated `customer_contacts.customer_id` field is never used as ownership truth. A contact-only reference is an organization-scoped standalone CRM lookup; it does not invent a Customer relationship. Later Sales commands that require both must submit the three-part scoped reference.

Presentation mapping provides only recipient-visible company/customer/contact names, email/phone, and structured billing/shipping address fields. It intentionally excludes internal notes, credit, QuickBooks, tax, audit, and platform fields. Legacy unstructured address text is not parsed into historical identity.

## Products / PBV2 / Formula Library

Normal pricing reads bind all of the following in one predicate:

`organization + product + product active-pointer + tree organization + tree product + ACTIVE tree status`.

This prevents V1’s known foreign/same-organization-wrong-Product active-tree risk. A null/stale pointer, inactive Product, non-ACTIVE tree, or wrong association returns safe not-found before Pricing. Normal callers cannot supply a PBV2 tree id. Historical configuration is a separate checkpoint-only contract and deliberately has no generic lookup until Sales checkpoints exist.

Formula reads bind Product organization and Formula organization and require `is_active = true`. Formula evidence has a compatibility version from the source update timestamp and a SHA-256 hash over resolved id/profile/expression/config; historical `PricingResult` therefore never relies only on a later mutable formula row.

Product Type reads expose identity only plus a conservative `routingRequired: false` placeholder. Legacy station/step/send-to-production fields do not become Routing authority.

## Resolution before Pricing

The pure resolver uses the reviewed `resolveRuntimeVisibility` and fixed-dimension helpers. It applies visible defaults, rejects unknown/hidden selections, checks visible required selections, injects trusted fixed dimensions, strips geometry from quantity-only Products, and maps pricing V2 base/tier/matrix facts (including selected-tier minimum charges) into `PricingRules`.

Selected visible choice `priceDeltaCents` and supported PBV2 pricing impacts map to the established M1.2 calculated-price rules: fixed, per-quantity, per-square-foot, base-percentage, and multiplier. Conditional impacts, line/options-subtotal percentage bases, linear/inch units, inline impact formulas, and selected base-rate/minimum overrides have no proven M1.2 representation, so they reject the read with a validation compatibility error rather than silently changing price. The resolved DTO records only normalized effects; it never carries the tree.

The M1.2 evaluator’s supported formula vocabulary remains arithmetic plus `ceil`. Active formulas using `floor`, `min`, `max`, `abs`, ternary expressions, or sheet/roll helper calls fail closed as a validation compatibility limitation; they are not approximated. A later Pricing compatibility increment must expand each function only with characterization evidence. Physical Pricing facts remain limited to dimensions and the caller-supplied pricing nesting evidence seam—no material stock, reservations, consumption, or reorder state crosses the boundary.

An active Formula Library pointer with no active row or a blank expression returns a safe compatibility error. Other function calls, including `sqrt`, are also rejected unless the sole function is `ceil`; unsupported behavior is never approximated.

## Verification and limits

Focused tests prove organization predicates, active Customer/contact-link lifecycle, cross-customer substitution rejection, active-pointer association predicates, default/hidden/required selection handling, selected option-impact/tier-minimum mapping, fixed/custom/quantity-only dimensions, unsupported/blank-formula rejection, and a Product resolution to M1.2 Pricing result.

`v2/scripts/runM13CompatibilityReadRehearsal.ts` is an explicit clone-only PostgreSQL rehearsal. It reuses M0’s fail-closed `TEST_DATABASE_URL` and opt-in guard, creates fixtures only inside a transaction, rolls back unconditionally, and closes its pool. No authorized disposable clone URL is configured in this workspace, so the physical rehearsal was added but not executed here.

The clone rehearsal covers foreign Customer/Contact/Product/Product Type lookups, cross-Customer contact substitution, inactive Customer/Contact/Product/tree state, same-organization wrong-Product active-tree pointers, and foreign/inactive/blank Formula Library associations before a valid read-to-Pricing path. No authorized disposable clone URL is configured in this workspace, so this physical rehearsal was added but was not executed here.

## Next milestone

**M1.4 — Temporary Staff Authority Compatibility.** It must provide narrowly scoped Staff issuer compatibility and negative-scope/retirement evidence; it must not add broad role bypasses or commercial writers.
