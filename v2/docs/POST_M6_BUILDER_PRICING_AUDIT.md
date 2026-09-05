# Post-M6 Builder, pricing, and operational queue source audit

Baseline: 555414cbb96de65ef72b7556f78100a1b968ec91 on V2 dev. Source changes only; no provider writes, database mutations, historical migration edits, V1 edits, or M7/View-mode work. Paths below are repository relative.

## Canonical owners

All staff API paths start with /v2/organizations/:organizationId. Runtime mounts are in v2/src/interfaces/http/app.ts; server composition is in v2/src/deployment/server.ts.

| Domain | UI and API | Service / query owner | Contracts |
| --- | --- | --- | --- |
| Product Catalog | /products; ProductWorkspace.tsx; /products API, productRoutes.ts | PostgresProductWorkspaceReads; ProductVersionLifecycleApplicationService | productVersionLifecycle.ts, products/contracts.ts; ui/api.ts projections |
| Product Builder | /products/new or /product-builder/:id?draft=1; ProductWorkspace -> ProductBuilderReference -> productBuilder/lovableRoot; /products/:id/draft/* | ProductVersionLifecycleApplicationService, ProductPublicationApplicationService; postgresProductVersionLifecycle.ts, postgresProductPublication.ts | ProductBuilderDraftState; ProductDraft* in productVersionLifecycle.ts and ui/api.ts |
| Formula Library | /formulas; FormulaLibraryWorkspace.tsx; /formulas API, formulaRoutes.ts | FormulaDomainApplicationService; PostgresFormulaDomainReads/TransactionRunner; evaluateFormulaDefinition -> evaluateResolvedFormula | formulaDomain.ts, formulaRuntimeContract.ts; FormulaDomain* UI projections |
| Matrix | Builder matrix-pricing.tsx; /products/:id/draft/pricing/matrix | ProductVersionLifecycleApplicationService; PostgresProductDraftPricingMatrixReader and draft transaction in postgresProductVersionLifecycle.ts | ProductDraftPricingMatrix; PricingRules.matrix |
| Recipe | Builder recipe.tsx; /products/:id/draft/recipe and /active/recipe | ProductRecipeApplicationService; PostgresProductRecipeTransactionRunner, PostgresProductWorkspaceRecipeReader in postgresProductRecipes.ts | productRecipes.ts; ProductRecipeComponent and quantity/unit contracts |
| Routing | /routing, RoutingWorkspace.tsx; Builder production-routing.tsx; /routing API and /products/:id/draft/routing | RoutingLifecycleApplicationService, RouteTemplateAuthoringApplicationService; postgresRoutingLifecycleTransaction.ts, postgresRouteTemplateAuthoring.ts, postgresRoutingWorkspaceReads.ts; ProductRoutingApplicationService + postgresProductRouting.ts for draft selection | routing/contracts.ts, productRouting.ts, routeTemplateAuthoring.ts |
| Pricing | Builder pricing-preview.tsx renders server results; /products/:id/draft/pricing/preview | PostgresProductDraftPricingPreview -> resolveActivePbv2PricingInput -> V2PricingParityAdapter; Quote and Order transactions use the same adapter | pricing/contracts.ts: PricingCalculationRequest, PricingRules, PricingResult; products/contracts.ts |
| Proofing | /proofing; ProofingWorkspace.tsx; proofingRoutes.ts | ProofingApplicationService; PostgresProofingTransaction.listWorkQueue/readWork | proofing/contracts.ts; OperationalQueuePage |
| Prepress | /prepress; PrepressWorkspace.tsx; prepressRoutes.ts | PrepressApplicationService; PostgresPrepressTransaction.listQueue/coverage | prepress/contracts.ts; shared/productionRequirements.ts; OperationalQueuePage |
| Production | /production and station URLs; ProductionWorkspace.tsx; productionRoutes.ts | ProductionApplicationService, ProductionMaterialConsumptionApplicationService; PostgresProductionTransaction.listStationQueue/readWork, postgresMaterialConsumptionTransaction.ts | production/contracts.ts; productionCompletion.ts; OperationalQueuePage |

## REMOVE NOW: completed

- Removed ReviewSummary's unused original-adapter errors, activeVersion, and draftVersion props/fallbacks. Repository-wide symbol search finds one production caller, ProductBuilderReference, which already supplies canonical lifecycle/findings/validation. Tests also use canonical props. This was presentation compatibility, not historical-data compatibility.
- Removed the unused local formula flag in matrixFromTree and unused local matrix-row variables in resolveActivePbv2PricingInput. TypeScript unused diagnostics were corroborated by inspecting all lexical uses and the pure JSON/row reads. Matrix rate resolution remains in resolveProductOptionPricingMatrixBaseRateCents.
- Removed v2/src/modules/pricing/parityFixtures.ts, an unimported source-only catalog. Runtime/import graph, package scripts, test references, dynamic paths, and symbol searches found no executable consumer. Its exact vectors are retained as explicitly historical documentation in docs/architecture/v2/M1_PRICING_PARITY.md. Executable pricing parity coverage remains intact.
- Corrected the pricing adapter's misleading future-reader comment; the compatibility resolver is already live.

## CONSOLIDATE NOW: completed

- The identical QueuePager implementations in ProofingWorkspace, PrepressWorkspace, and ProductionWorkspace now use OperationalQueuePager.tsx. Row limits, range text, disabled buttons, callbacks, CSS class, query ownership, and page reset behavior are preserved.
- No pricing arithmetic consolidation was necessary: V2PricingParityAdapter already owns base pricing, minimum-charge application, option impacts, matrix row/tier selection, formula-result rounding, and pricing evidence for Draft/Quote/Order callers.

## KEEP

- ProductBuilderReference and all productBuilder components are production code despite reference/lovable naming. App route registration and ProductWorkspace composition are authoritative; no alternate V2 Builder implementation was found.
- stageProductBuilderDraft prevents nested edits from mutating React Query snapshots. firstSaveIdentity, optionIdMappingFromSaved, remapProductBuilderDraftOptionReferences, matrixRef staging, live-preview fingerprints, and revision-aware save/publish logic have live callers and targeted regressions.
- pbv2CompatibilityResolution retains legacy embedded/library/Product-row formulas, option IDs/selection keys, old tier representations, and ProductVersion rotation fallback. Immutable historical versions and imported records still need these paths.
- evaluateLegacyOptionImpactFormula intentionally retains mathjs compatibility for broader legacy addFormula syntax. Formula Library expression evaluation uses the constrained evaluateResolvedFormula. These are different supported grammars, not interchangeable calculators.
- Shared PBV2 sheet/roll geometry helpers and pricingNestingEstimate are live pure dependencies; no V1 runtime services were removed or rewritten.
- ProductType default-route compatibility in postgresProductRouting.ts and the explicit routing-compatibility API remain necessary for versions without authored routing specs. PostgresRoutingRepository is used by Order transaction creation; it is not superseded by the lifecycle transaction.
- Formula freeze inventory/rehearsal helpers remain operational recovery tools and have package-script/test consumers. validateFormulaRevisionInputValues is an alias to the same validator, not a second validation implementation.
- Domain queue queries remain separate: Proofing and Production order-level history reads intentionally differ from operator queues.

## REVIEW / DO NOT DELETE

- Unit conversion: V2PricingParityAdapter quantizes inches to 12 decimal places; resolveFormulaSheetEstimate multiplies dimensions by the unit scale without that quantization. Unifying this requires boundary characterization because sheet yield/tier outcomes could change. No arithmetic was changed.
- UI preview completeness checks differ for whitespace-only string selections between request preparation and rail presentation. This is a behavior correction candidate, not safe dead-code deletion.
- Active-definition/catalog projections still interpret historical Product/PBV2 snapshots independently from draft authoring. They are read projections, not alternate pricing calculators; collapsing them requires stronger current/historical data proof.
- Historical schema fields/tables and unknown data were retained. This source audit authorizes no destructive cleanup.

## Operational queue findings at baseline

- normalizeOperationalQueuePage is the common server request owner (25/50/100 rows, bounded search); the shared pager is presentation only.
- Proofing listWorkQueue filters open, nonarchived Orders; it intentionally includes approved/latest-version evidence while an Order remains open.
- Prepress listQueue filters open, nonarchived Orders and pending/active routes containing a prepress step. It can include unconfigured requirements or a different current route step. Coverage remains an explicit unconfigured result; the UI does not fabricate requirements. A historical-data/recovery disposition belongs to the primary audit, not this source consolidation.
- Production listStationQueue filters open, nonarchived Orders and unattempted work or work with an attempt at that station. Completed attempts can remain while the Order is open; the list is not a second scheduler.
- Deployment starts exactly the V2 QuickBooks, invoice-email, and proof-email delivery workers and closes them on shutdown. Proof email's durable queue remains separate because it owns proof-version recipients and portal evidence. No second Prepress/Production worker was found in the V2 deployment path.

## Test cleanup and validation

- Updated rotationOptionPricing.test.ts to consume the current ApplicationResult.value envelope. Six preexisting tests had failed before reaching their pricing assertions because they accessed removed top-level fields. All original assertions remain, including 24x36/36x24 quantities, rotation ceiling, historical no-control behavior, matrix tier, and fail-closed stale identity.
- Before/after pure checks passed: pricingParityCorrections, legacyFormulaDraftAuthoring, formulaDomain. Representative results include Coroplast quantities 8/10/91/100/101: 4400/4400/32960/32960/36256 cents; rotation q5: 8800 vs 4400 cents; matrix misses fail closed; minimum and epsilon rounding remain covered.
- After cleanup: 11 focused Jest suites, 67 tests passed: pricingParityAdapter, productDraftFormula, productDraftMatrix, productDraftOptionPricing, productDraftPricing, rotationOptionPricing, productDraftRouting, productRecipes, legacyFormulaFreezeInventory, historicalFormulaRevisionFreeze, formulaDomain.
- UI checks passed: Builder review, matrixPricing, optionIdentityRemap, livePricingPreview; Proofing workflow, Prepress workspace and permission/hook transitions, production material selection; V2 UI TypeScript check.
- Local Node 24 requires --no-experimental-global-navigator for the existing jsdom Prepress hook test. Jest was run with TEST_DATABASE_URL, DATABASE_URL, MIGRATION_DATABASE_URL, and DIRECT_DATABASE_URL blank in the child process; setup confirmed migrations disabled. No DB/provider calls were made by these checks.
- Full build/UI-suite, DEV routing-readiness counts, browser validation, data disposition, and git integration are owned by the primary milestone report.
