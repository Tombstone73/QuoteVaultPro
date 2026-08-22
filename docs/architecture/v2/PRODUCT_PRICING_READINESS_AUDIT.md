# Product pricing readiness audit

**Audit date:** 2026-08-22  
**Scope:** the authenticated DEV V2 Product catalog and the restored canonical
V1-parity pricing spine at `80b848a900261e751093a73814cd2b7ac84aa5a0`.

This is a read-only classification.  It created no Draft, ProductVersion,
Quote, Order, Invoice, Inventory, Formula Library, Recipe, or routing data.
`MAIN` was not read or changed beyond its remote SHA check.

## Method and limits

The authenticated DEV catalog reported **32 configurable products**.  Its
visible catalog state, V2 Product read contracts, the current canonical
resolver, and established V1 parity vectors were used together.  The browser
catalog intentionally does not expose Product IDs; IDs are included where
they are available from prior authoritative V2 reads.  A direct authenticated
catalog-API navigation was blocked by the browser client, and the configured
`TEST_DATABASE_URL` remains unsafe, so neither was used as a workaround.

Accordingly, an `F` result means exactly that commercial correctness was not
proven from safe read-only evidence; it is not a claim that the product is
mispriced.  “Route … Unconfigured” in the catalog is a Product Type routing
fact, not by itself a pricing defect.

## Classification rule

| Code | Meaning |
| --- | --- |
| A | Ready as-is: current active configuration has a characterized successful canonical result. |
| B | Legacy-compatible: the ACTIVE configuration is read by an explicit compatibility boundary and can continue to price; canonicalize before a relevant edit. |
| C | Needs canonicalization before further editing: an existing Draft can lose or fail to preview an ACTIVE compatibility fact. |
| D | Pricing-critical configuration missing: normal canonical pricing cannot be trusted until an intentional Draft correction. |
| E | Invalid/broken: a current canonical result demonstrably fails or is commercially invalid. |
| F | Insufficient evidence: safe evidence does not establish commercial correctness. |

## Catalog classification

| Product | Product ID | Pricing model / provenance | ACTIVE ProductVersion | Primary | Authorable now? | Primary issue / action | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 3mm Acrylic Signs | not exposed by catalog | Not configured | none; Draft only | D | No | Configure a canonical price before publication. | P1 |
| ACM / Dibond / Max Metal / Aluminum Composite Material | not exposed by catalog | Matrix | present | F | Requires characterization | No safe V1/V2 replay for its current Matrix/default combinations. | P3 |
| Banner | not exposed by catalog | Formula / characterized square-foot and option-impact vectors | present | A | Requires characterization before formula/matrix edit | 36×42 V1/V2 vector is preserved; do not infer all advanced edits are safe. | — |
| Cardstock - 24pt Tango Board | not exposed by catalog | Matrix | present | F | Requires characterization | No representative replay. | P3 |
| Concept 204 Low Tac | not exposed by catalog | legacy product Formula | present; Draft exists | C | No | ACTIVE compatibility pricing is supported, but Draft formula preview/editor does not own the legacy Product-row expression. Canonicalize before publishing the Draft. | P1 |
| Contour-Cut Stickers | not exposed by catalog | Formula; inactive | none | F | Requires characterization | Inactive and no safe commercial replay. | P3 |
| Coroplast | `df00792e-ab23-4516-baa3-9f174f69c495` | typed ProductVersion sheet Formula, Matrix tiers, option-driven rotation | `4de9ac11-7f9e-4a0c-a29f-b690c3992e66` | A | Yes | Published review proves default flute=Yes/rotation OFF and No/ON sheet behavior. | — |
| Economy Yard Sign Stakes | not exposed by catalog | quantity-only Formula compatibility | present | A | Requires characterization before formula edit | V1/V2 quantity vector is preserved. | — |
| Flatbed Basic product | not exposed by catalog | Matrix; inactive | none | F | Requires characterization | Inactive, no replay. | P3 |
| Foam Board | not exposed by catalog | Matrix | present | F | Requires characterization | No representative Matrix/default replay. | P3 |
| Installation | `b7bbfe12-0cd9-4793-8fa2-a51b270bb327` | legacy fee profile `flatFee` compatibility | present | B | Requires canonicalization before edit | Current flat-fee behavior is supported by the parity resolver; retain the legacy fact until an intentional ProductVersion conversion. | P2 |
| Magnetic - .020 High Force | not exposed by catalog | Formula | present | F | Requires characterization | No safe live vector. | P3 |
| OppBogga Recyclable Display Board | not exposed by catalog | Matrix | present | F | Requires characterization | No representative Matrix/default replay. | P3 |
| PVC | not exposed by catalog | Matrix | present | F | Requires characterization | No representative Matrix/default replay. | P3 |
| Posters | not exposed by catalog | legacy product Formula | present; Draft exists | C | No | Canonicalize legacy Formula provenance before continuing the existing Draft. | P1 |
| RUSH | `c06282bb-cb68-4a5d-bfa8-35bca836f921` | fee profile with no `flatFee` | present; Draft exists | D | No | Canonical resolver correctly rejects missing Fee/Service amount. Supply a deliberate flat-fee Draft configuration. | P0 |
| Reflective Vinyl - Nikkalite | not exposed by catalog | Formula | present | F | Requires characterization | No safe live vector. | P3 |
| Retractable Banner | not exposed by catalog | quantity-only Matrix | present | A | Requires characterization before advanced Matrix edit | Controlled V2 commercial flow priced $75.00 and froze correctly through Quote → Order. | — |
| Shipping | not exposed by catalog | Flat fee | present; Draft exists | F | Requires characterization | Catalog summary alone does not establish its required fee amount or V1 semantics. | P3 |
| Stickers | `0334a47d-df91-42c7-a94d-77676b4f5ce4` | legacy `products.pricing_formula` | `9868ce72…`; Draft exists | C | No | ACTIVE 12×12 V1=V2 600¢ through the compatibility source, but the open Draft cannot safely retain/edit that source. | P1 |
| Stickers (Copy) | not exposed by catalog | Formula; Draft only | none | F | Requires characterization | Unpublished copy; do not infer pricing readiness. | P3 |
| Stickers - Clear Background | not exposed by catalog | legacy product Formula; inactive | none | B | Requires canonicalization before edit | Supported legacy Formula family; no immediate mutation is required while inactive. | P2 |
| Styrene | not exposed by catalog | Matrix; inactive | none | F | Requires characterization | Inactive, no replay. | P3 |
| Substance 2755 - Sign Vinyl | not exposed by catalog | legacy product Formula | present | B | Requires canonicalization before edit | Supported legacy Formula provenance; active pricing need not be rebuilt. | P2 |
| Substance 2755 - Sign Vinyl (Copy) | not exposed by catalog | Formula; inactive | none | F | Requires characterization | Inactive copy, no replay. | P3 |
| V2 Catalog Builder Smoke 2026-08-21 1938 | not exposed by catalog | Not configured | none; Draft only | D | No | Test Draft lacks pricing configuration. | P1 |
| V2 Catalog Builder Smoke 2026-08-21 2008 | not exposed by catalog | Not configured | none; Draft only | D | No | Test Draft lacks pricing configuration. | P1 |
| V2 Product Builder UI Smoke 2026-08-21 | not exposed by catalog | Not configured | none; Draft only | D | No | Test Draft lacks pricing configuration. | P1 |
| Window Cling | not exposed by catalog | Formula | present | F | Requires characterization | No safe live vector. | P3 |
| Window Perf | not exposed by catalog | legacy product Formula | present | B | Requires canonicalization before edit | Supported legacy Formula provenance; canonicalize before formula edits. | P2 |
| Yard Signs | not exposed by catalog | Not configured | none; Draft only | D | No | Configure a canonical price before publication. | P1 |
| test product | not exposed by catalog | Not configured | none; Draft only | D | No | Test Draft lacks pricing configuration. | P1 |

## Counts

| Classification | Count |
| --- | ---: |
| A. Ready as-is | 4 |
| B. Legacy-compatible | 4 |
| C. Needs canonicalization before further editing | 3 |
| D. Pricing-critical configuration missing | 7 |
| E. Invalid / broken | 0 |
| F. Insufficient evidence | 14 |
| **Total reviewed** | **32** |

## Provenance and authorability

The one V2 pricing spine remains:

```text
ProductVersion/PBV2 + explicit legacy compatibility sources
  → resolveActivePbv2PricingInput
  → V2PricingParityAdapter
  → PricingResult
  → Sales SellingPriceDecision / immutable snapshots
```

Current formula precedence is Formula Library, then embedded ProductVersion
Formula, then legacy `products.pricing_formula`.  The last is a valid ACTIVE
compatibility source, not an excuse to replace a Product.  It is deliberately
read-only in the Builder.  More importantly, the Draft preview read does not
carry that legacy Product-row Formula, so products with an existing Draft
must be canonicalized before that Draft is further edited or published.

Simple canonical pricing, typed rotation policy, supported Options, and
fully covered non-Formula matrices are authorable now.  Formula+Matrix,
computed-sheet matrix tiers, and compatibility-only formulas should be
preserved/read-only until intentionally canonicalized; that authorability
constraint does not by itself invalidate a verified ACTIVE price.

## Repair groups

| Required work | Products | Count | Priority |
| --- | --- | ---: | --- |
| Missing required fee | RUSH | 1 | P0 |
| Unconfigured Draft pricing | 3mm Acrylic Signs; the three Builder smoke Drafts; Yard Signs; test product | 6 | P1 |
| Canonicalize existing legacy Formula before current Draft publication | Concept 204; Posters; Stickers | 3 | P1 |
| Canonicalize legacy compatibility on the next intentional edit | Installation; Clear Background; Substance 2755; Window Perf | 4 | P2 |
| Acquire a representative non-mutating replay | Matrix/Formula/inactive/copy products marked F | 14 | P3 |

## Coroplast

Coroplast is **A — Ready as-is**.  Its published ProductVersion is
`4de9ac11-7f9e-4a0c-a29f-b690c3992e66`.  Its default `Flute direction
matters? = yes` resolves effective rotation OFF; `no` resolves ON.  The
previously verified canonical vectors remain 24×36×5 = 8,800¢ (Yes) / 4,400¢
(No), and 24×18 quantities 8/10/91/100/101 = 4,400/4,400/32,960/32,960/
36,256¢.  No Coroplast data was changed by this audit.

## Validation

* Confirmed `origin/v2/reconstruction` and `origin/dev` at
  `80b848a900261e751093a73814cd2b7ac84aa5a0`.
* Confirmed DEV API `/health` and `/ready` returned 200 and `/version` returned
  the same SHA.
* Authenticated DEV browser catalog inspection: 32 Product rows, with no
  Product-opening action taken.
* Source inspection of resolver provenance, fee validation, Formula/Draft
  authorability, Matrix/tier contracts, and the restored parity test evidence.
* The unsafe configured `TEST_DATABASE_URL` was not used or altered.

## Recommended next step

Repair the P0/P1 products in small, intentional ProductVersion batches only.
Separately provision an approved safe persistence-test database and run
representative non-mutating replays for the F group before assigning those
products commercial launch readiness.
