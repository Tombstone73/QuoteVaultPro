# Post-M6 V2 hygiene milestone report

Completed on V2 `dev` from baseline `555414cbb96de65ef72b7556f78100a1b968ec91`. Deterministic source cleanup, canonical queue consolidation, read-only DEV classification, and the Prepress recovery view are complete. Primary-tenant routing and affected behavior regressions pass. Broader DEV routing has 72 pre-existing unroutable sandbox/rehearsal Products and is explicitly not a global zero pass.

Work ran in the existing clean `QuoteVaultPro-v2-recovery` dev worktree after reconciling origin/dev. The attached older, dirty `QuoteVaultPro-clean` reconstruction worktree was left untouched. Five requested audit roles contributed; the primary agent reviewed and integrated deletion decisions. Only origin/dev was pushed. V1, MAIN, historical migrations, M7, and Product read-only View mode were not changed.

## 1. Authoritative V2 domain-path map

[The complete 23-domain map](POST_M6_SOURCE_GRAPH.md#authoritative-path-map) identifies the canonical API/router, UI route/component, application service, repository/query, and state/contracts separately for CRM, Catalog, Builder, Formula, Matrix, Recipe, Routing, Artwork, Proofing, Prepress, Production, Fulfillment, Orders, Quotes, Billing, Payments, Stripe, QuickBooks, Portal, Email, Finance, Settings and RBAC.

Evidence combined a parsed graph of 3,092 tracked JS/TS files with HTTP/UI registration, all three runtime/build roots, workers, scripts, configuration, tests, dynamic imports, and symbol/string searches. Of 299 initial V2 production modules, 269 were runtime-root reachable; 26 remaining modules had genuine rehearsal/recovery/test consumers and were retained. No deletion depended solely on an unused diagnostic.

## 2. Dead code removed

Four unconsumed source modules: `ui/src/InvoiceWorkspace.tsx` (35 lines), `src/modules/artwork/quoteArtworkContracts.ts` (84), `src/repositories/contracts.ts` (26), and `src/modules/pricing/parityFixtures.ts` (33). Paths here are relative to v2. Historical pricing vectors were preserved in architecture documentation. Uncalled Artwork closures, unused matrix/formula locals, and the obsolete test-only Prepress client search helper were also removed. The source audit records individual reachability proof.

## 3. Superseded implementations removed

Removed the unused unpaged Finance ledger service/port/query (93 lines), QuickBooks single-invoice enqueue wrapper (3) and payment-only retry implementation (17). Their live owners are the paged ledger, bulk admission including single selections, and generic subject-kind retry. Removed obsolete Builder ReviewSummary presentation props/fallbacks and 47 selectors belonging exclusively to the deleted InvoiceWorkspace. Shared Invoice/Finance/Portal styles remain.

## 4. Canonical paths consolidated

Proofing, Prepress and Production share `OperationalQueuePager`. Prepress active/recovery/all views use one repository query and bound predicate, with identical count/item filtering before pagination. Finance uses its existing paged SQL projection. The quote-artwork application retains the sole consumed contract and strict validator. No functioning architecture was rewritten to centralize superficial arithmetic.

## 5. Compatibility shims retained and why

KEEP historical Customer/Product readers, PBV2 options/selection IDs/formula sources/tier shapes/rotation, Formula freeze recovery, Recipe compatibility, immutable Sales snapshots, financial legacy projections and Portal lists. Six primary standard-production Products still require ProductType routing compatibility. KEEP QuickBooks provider/import/recovery and credential infrastructure, legacy Gmail adoption, and historical staff-authority rehearsal modules. Both server build roots are live package-script owners. V1 shared provider infrastructure was not edited.

## 6. Product Builder cleanup

`ProductWorkspace -> ProductBuilderReference -> productBuilder/lovableRoot` remains the only authoritative Builder. Reference/lovable naming did not justify deletion. Removed obsolete ReviewSummary inputs and unused locals. Kept working-draft isolation, first-save identity remapping, matrix staging, revision-aware saves, live-preview fingerprints and publication validation. [Detailed Builder audit](../docs/POST_M6_BUILDER_PRICING_AUDIT.md).

## 7. Pricing/formula cleanup

The existing V2PricingParityAdapter remains the pricing authority for preview/Quote/Order base price, option impacts, matrix tiers, minimums and rounding. No pricing arithmetic changed. Representative before/after Coroplast quantities 8/10/91/100/101 stayed 4400/4400/32960/32960/36256 cents; rotation q5 stayed 8800 versus 4400 cents. Matrix misses still fail closed. Legacy mathjs option formulas and constrained Formula Library grammar remain distinct supported contracts. Unit-quantization and whitespace-selection differences are REVIEW, not safe cleanup.

## 8. Email/queue cleanup

Confirmed one invoice sender: PostgresInvoiceEmailSender owns planning, recipients, PDF, MIME, Gmail and per-invoice audit. The durable invoice queue schedules and delegates to it. No obsolete second invoice sender/MIME builder/worker was found. Quote, proof, invitation and reset delivery are distinct live contracts. Provider-attempt uncertainty, pacing, leases and intentional retry remain intact. No email was sent by this audit.

## 9. QuickBooks cleanup

V2QuickBooksBillingWorker remains the sole V2 financial writer. Removed two unreachable admission/retry methods and updated obsolete assertions. Added 13 executable recovery scenarios covering invoice/payment/refund, tenant-bound queries, deduplication, approvals and refusal of uncertain/completed/in-flight outcomes. Import/recovery, PMT sequencing, frozen projections and credential reconciliation remain. No real provider write was initiated. [Finance/provider audit](../docs/post-m6-finance-hygiene.md).

## 10. Operational queue cleanup

Prepress defaults to configured **Active work**, exposes **Needs configuration** with a visible count, and offers **All routed work**. Existing API callers omitting requirementState still receive all work, preserving Production behavior. Tenant/RBAC/open/nonarchived/route scope is unchanged. Search and filtering run server-side before pagination. Incoming historical line/unit links select the combined view. [Operational audit](POST_M6_OPERATIONAL_HYGIENE.md).

## 11. Historical DEV data findings

[DEV classification and exact candidate IDs](POST_M6_DEV_DATA.md) records the 2026-09-05T00:46:38.032Z snapshot. All inventory transactions were explicitly READ ONLY with rollback and verified DEV identity; scope was explicit. No database rows were mutated or determined safe to delete.

| Category | Finding | Disposition |
| --- | --- | --- |
| Drafts | 50, including 19 primary; 8 older than 30 days | REVIEW intent; age is not abandonment proof |
| QA Sales history | 73 documents in known rehearsal organizations; 15 primary QA Orders and 19 primary QA Quotes | KEEP regression, acceptance, conversion, route and audit history |
| QA payments | 8 allocated Payments, 5 Refunds, 15 provider events, 14 provider operations | KEEP immutable financial history |
| Queues | 4 ambiguous deliveries, 18 pending financial outbox events; 4 sent emails and 5 succeeded QBO jobs | REVIEW unresolved outcomes; KEEP completed evidence |
| Customer collisions | 5 normalized-name groups, 10 IDs, none proven QA duplicates | REVIEW full identities/relationships |
| Artwork | 1 orphan-like candidate; 3 adopted upload intents | REVIEW file; KEEP adoption evidence |
| ProductVersions | 196 deprecated, 3 archived, 97 active, plus 50 drafts | KEEP published/history; REVIEW draft intent |
| Failed operations | 23 retryable Product publish and 3 permanent Quote delivery failures | KEEP/REVIEW application evidence; not migration failure proof |

## 12. Historical Prepress disposition

All 18 primary unconfigured lines have the QA fixture customer, nonempty pricing/configuration snapshots, no frozen requirements/fingerprint, no Prepress units and no Production work. Two retain Artwork. They were created August 28-30, after configured records already existed; pre-schema origin is not proven. The additional M22 historical line has five Artwork assignments and three Prepress units and remains valuable regression evidence.

All are retained and separated from configured operator work through recovery views. No requirements were fabricated and no whole Order was archived: ORD-1013 contains both configured and unconfigured lines. Canonical DEV reads and the deployed browser both confirmed **4 active / 18 needs configuration / 22 all** for primary. The browser opened retained Artwork context and the original ORD-1013 from unconfigured line `ce19e2fd-662a-4298-9a46-37ba029478eb`.

## 13. Schema/migration findings

All 83 public V2 base tables were checked for occupancy. The four empty tables have live permission-ceiling, portal-reset and invitation-attempt owners. Legacy option/formula/version fields, Recipe replacement markers, requirements state/count/fingerprint/rows and independent commercial/routing/execution states remain live contracts. No safe table/column removal was established. No migration was added, rewritten or run. Audit/inventory/reconciliation/provider history was preserved.

## 14. Tests removed/updated

Retargeted the stale invoice source assertion to FinanceWorkspace/App and QBO retry assertion to generic retry. Corrected six pricing tests to the current ApplicationResult.value envelope, a financial parity Map assertion to .size, and historical staff fixtures to existing customer.edit authority. Original business assertions remain. Two obsolete client-search assertions were replaced by a real UI server-search regression. Added recovery UI/API/SQL, QBO no-write recovery, and read-only inventory guard tests. No meaningful behavior suite was deleted.

## 15. Size of cleanup

Four deleted modules total 178 source lines; Finance/QBO removed another 113 implementation lines. Forty-seven dead CSS selectors removed 2,992 bytes from a minified block. Three pager copies became one shared component. The two implementation commits together touch 45 files, with 1,340 insertions and 385 deletions; new audit reports, inventory tooling and regression coverage account for most additions. This final report and routing worklist are additional documentation-only files.

## 16. Risks and limits

Compatibility cannot be retired while current/imported/frozen records depend on it. Uncertain provider outcomes cannot be treated as unsent. Recovery is a derived queue view, not a new persisted archival facility. Existing queue deep links outside the current bounded page still require paging. Pricing boundary/grammar differences remain characterized rather than silently unified. Global DEV routing does not satisfy zero. Existing UI build chunk-size warning remains (main JS about 1.26 MB before gzip); no bundling redesign was attempted.

## 17. Static validation

PASS: `npm run v2:check`, `npm run v2:ui:check`, `npm run v2:boundaries`, explicit inventory script/helper/test TypeScript check, and `git diff --check`. The React checklist was applied to edited components. Misleading deployment-branch/migration-journal documentation and obsolete pricing/staff comments were corrected.

## 18. Automated tests

PASS: full `npm run v2:ui:test` (48 top-level programs); 15 focused Jest suites / 96 tests; 23 standalone regression programs. Coverage includes Builder draft/formula/matrix/options/rotation/Recipe/routing, Finance/Billing/payment/refund parity, Artwork, staff compatibility, Prepress filtering/RBAC/pagination/deep links, Stripe ingress/settings/recovery, Portal boundaries, QBO queue/readiness/projections, invoice email scheduling, and inventory read-only guards.

An initial Artwork invocation used the standalone runner for a Jest file and failed at test registration; rerunning it with Jest passed all six tests. Final counts above reflect the correct runner. Opt-in DB migrations were explicitly disabled and provider/query dependencies mocked for tests; local TEST_DATABASE_URL was not used.

## 19. Local validation

PASS: server build (`v2:server:build`), UI build (`v2:ui:build`), foundation/full build (`v2:build`), representative pricing before/after, DOM interaction tests, route/service/SQL contract tests and no-write queue recovery tests. Local logs remain under `codex-artifacts/post-m6/`. The migration/seed-heavy M6 rehearsal was not rerun against DEV during a read-only cleanup; this milestone does not claim a new full cutover rehearsal or live payment/send test.

## 20. DEV validation

`api-dev.printershero.com/version` reported functional commit `0664c4ecc374040c36885dfd7d824fddc56635e5`; health was ok and readiness application was ok. Authenticated `dev.printershero.com` browser checks verified Prepress 4/18/22 filters, retained Artwork and Order navigation, Finance native/legacy invoice presentation after CSS removal, payment/refund ledger, and Banner's existing draft/review/version history with a live pricing result. No save/publish/payment/refund/send/sync controls were used.

DEV SQL validation used only the named PrintersHero-DEV / Development service environment and read-only transactions. All-tenant inventory plus a tenant-scoped rerun passed; canonical Prepress query results matched view totals and excluded cross-tenant, archived and non-open records.

## 21. Routing-readiness regression

Before at 00:39:49Z and after at 00:51:39Z on 2026-09-05 had identical per-organization counts and per-Product readiness states. Primary: 21 active Products, 17 standard-production, 11 version-routable, 6 compatibility-routable, **0 unroutable before and after**. All DEV: 96 active Products, 89 standard-production, **72 unroutable before and after** (10 sandbox, 62 rehearsal). [Exact routing review inventory](POST_M6_ROUTING_READINESS.md).

The primary M6 regression passes. An all-organizations zero requirement remains unmet by pre-existing data and must not be represented as passing or forced by destructive cleanup.

## 22. Commits pushed

1. `0bda4c02d1cef8cc327290b77c79f04f65d1e0ae` — Remove superseded V2 source and restore current regression contracts.
2. `0664c4ecc374040c36885dfd7d824fddc56635e5` — Separate Prepress recovery work and add read-only DEV hygiene inventory.
3. The documentation-only commit carrying this report and the exact routing inventory follows those two commits; its SHA is supplied in the final handoff. Only origin/dev is the push destination.

## 23. Current DEV SHA

The verified functional deployment at report creation is `0664c4ecc374040c36885dfd7d824fddc56635e5`. The final handoff records the latest origin/dev and deployed SHA after the documentation-only commit. Functional code and all test/build results are identical across that documentation step.

## 24. Candidates requiring human approval or a business decision

Exact IDs are in the data and routing reports: 50 drafts, 19 unconfigured Prepress lines, four ambiguous deliveries, 18 pending financial outbox entries, five Customer collision groups, 72 sandbox/rehearsal routing candidates, and artwork file `23e8fcd9-9ff4-4327-a9f3-a6568f6e6725`. Retention decisions also apply to the sandbox and 114 historical fixture organizations. Destructive deletion requires stronger dependency proof and explicit scope; provider recovery requires reconciliation of attempted outcomes. Existing canonical lifecycle actions should implement any approved discard/archive/merge/repair. No broad deletion, retry or fabricated state change was performed or requested for approval as part of this completed nondestructive work.

## 25. Remaining technical debt

Retained legacy/imported data projections, Portal's bounded native/legacy invoice list, shared V1/V2 provider infrastructure, historical rehearsal modules, pricing unit quantization/grammar distinctions, UI preview whitespace completeness, bounded queue deep-link navigation, and bundle size remain documented. No further source candidate met the multi-signal deletion standard. That is an evidence-bounded audit result, not proof that all possible dead code is absent.

## 26. Recommendation before M7

Keep this cleanup as the new V2 dev baseline. Preserve the canonical owners and regression checks. Resolve or explicitly accept delivery/outbox recovery and historical retention debt. Define the routing acceptance scope: primary is green; if zero is required across every DEV organization, repair or archive the 72 documented candidates through an approved lifecycle before declaring that gate passed. M7 and Product read-only View mode remain unstarted.
