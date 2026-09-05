# Post-M6 DEV historical-data hygiene

Snapshot: 2026-09-05T00:46:38.032Z. Target: **PrintersHero-DEV / Development**. Baseline: `555414cbb96de65ef72b7556f78100a1b968ec91`. Database mutations: **0**. Provider calls: **0**. Safe-to-delete determinations: **0**. This report is a retention/recovery review, not a deletion manifest.

The inventory used the canonical `requireV2DeploymentDatabaseUrl` guard before pool creation, one acquired connection, `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`, local statement/lock timeouts, server-side read-only/isolation verification, and rollback/release/end on completion or failure. It emits IDs, states, timestamps, counts and provenance flags; no customer names, emails, addresses, payment amounts, storage keys, credentials or provider transaction/message IDs. No M7 work or historical migration edits were made.

## Scope and provenance

- **primary** = `56e0f644-bb25-43ef-8ee1-473831115849`: operational DEV tenant; 35 products, 26 Orders, 34 Quotes, 8 Payments.
- **sandbox** = `d51ff3e7-75aa-462f-b0ab-3751bd888306`: name explicitly marks a sandbox; 18 products, no V2 Sales documents or Payments. This label alone is not enough to permit deletion. Its 10 unroutable active standard-production products remain REVIEW.
- 114 additional organizations have IDs matching existing M21/M22/M23/P7B/P7C/P7D/routing-http rehearsal generators. Together they hold 59 Orders, 14 Quotes and 77 ProductVersions. The generator code in `v2/scripts/runM21ProofingRehearsal.ts`, `runM22PrepressRehearsal.ts`, `runM23ProductionRehearsal.ts`, `runP7cMaterialConsumptionRehearsal.ts`, `runP7dInventoryLedgerRehearsal.ts` and `runRoutingLifecycleHttpRehearsal.ts` provides stronger provenance than a display-name match. These are **CLEARLY SYNTHETIC / TEMPORARY DEV DATA** by origin, with disposition **KEEP AS HISTORY** because they retain regression/tenant-isolation/inventory evidence.
- All-organization scope was explicit. Tenant-scoped rerun returned only primary rows. Broad DEV counts must not be presented as primary-tenant readiness. Existing P7 rehearsal names refer to prior product work, not authorization to start M7.

## Category decisions

| Category | Observed | Disposition and reason |
| --- | --- | --- |
| Abandoned Product drafts | 50 DRAFT versions; 19 primary, 12 sandbox, 19 rehearsal; 8 older than 30 days | REVIEW. Age, inactivity and no detected snapshot references do not prove abandonment. |
| Synthetic QA Orders | 59 known-rehearsal Orders; 15 additional primary Orders with QA-customer label | KEEP AS HISTORY. Preserve route, artwork, commercial and audit relationships. |
| Synthetic QA Quotes | 14 known-rehearsal Quotes; 19 additional primary Quotes with QA-customer label | KEEP AS HISTORY. Preserve acceptance/checkpoint/conversion evidence. |
| Synthetic QA Payments | 8 primary QA-customer-linked Payments: 7 provider cards, 1 manual check; each allocated | KEEP AS HISTORY. Keep all 5 Refunds, 15 provider events and 14 provider financial operations too. |
| Stale queue jobs | 18 pending financial outbox events (3 older than 7 days); 4 ambiguous deliveries; 4 sent emails; 5 succeeded QuickBooks jobs | REVIEW unresolved events; KEEP completed delivery/accounting history. No retry or provider call. |
| Historical Prepress Requirements unconfigured | 18 primary lines plus 1 M22 rehearsal line | ARCHIVE / HIDE FROM ACTIVE WORK using Needs configuration view; preserve and allow recovery. |
| Orphan-like QA artifacts | 1 unreferenced artwork-file candidate; 3 adopted upload intents | REVIEW artwork. KEEP adopted intents. Missing direct links do not prove safe storage deletion. |
| Duplicate test customers | 5 exact normalized display-name collision groups, 10 IDs; none has QA marker | REVIEW. No duplicate-test provenance proven; V2-document count zero does not exclude legacy/contact/portal relations. |
| Old test ProductVersions | 196 DEPRECATED, 3 ARCHIVED and 97 ACTIVE versions across DEV | KEEP AS HISTORY. Published/deprecated trees may be referenced by immutable Sales, Formula, Recipe and Routing snapshots. |
| Failed/replaced migration-test artifacts | 26 failed OperationRequests: 23 retryable Product publish, 3 permanent Quote delivery failures | REVIEW / KEEP evidence. These are application failures, not proof of failed migrations; no migration-ledger rewrite or inferred cleanup. |

## Historical Prepress disposition

The primary's 18 unconfigured lines all reference QA customer ID `601ea2f8-276a-4269-afb8-3ee81f1bf964`, whose explicit DEV QA fixture label is also used by existing CRM API tests. They were created August 28–30, 2026. All 18 have zero requirement rows, declared count zero, no requirement fingerprint, zero Prepress units and zero Production works. Their resolved configuration and pricing-result JSON are nonempty. Every order has audit evidence. Two unconfigured lines already have artwork assignments, so artwork existence cannot supply authoritative requirements.

These primary records are QA/history candidates, but **not proven pre-current-schema records**: configured primary lines already existed on August 21. Do not invent a schema-origin explanation from an unconfigured flag. Do not fabricate requirements or archive a whole Order automatically; ORD-1013 also has configured work that must remain accessible.

The new canonical view split preserves all records: default UI **Active work** requests configured rows; **Needs configuration** exposes recovery candidates; **All** retains the combined view. The API's omitted-filter behavior stays compatible. Local canonical `PrepressApplicationService` → `PostgresPrepressTransaction` execution against DEV at 2026-09-05T00:45:19.492Z returned **4 configured / 18 unconfigured / 22 all**. Each total matched the complete fetched page; coverage states matched filters; no returned line was from another tenant, a non-open Order or an archived Order. This was a read-only SQL verification, not a deployed-UI claim.

The additional M22 line has empty historical pricing/configuration JSON, 5 artwork assignments and 3 Prepress units, so it is clearly valuable prepress regression history. Retain all evidence and show it in recovery, not configured work.

| Organization | Order number | Order ID | Unconfigured line ID | Artwork assignments |
| --- | --- | --- | --- | --- |
| primary | ORD-1011 | 6adfefa7-75e3-4e09-9acc-b10eff51f01f | 80191cb5-f765-4caa-b5aa-2a58b13ac0e5 | 0 |
| primary | ORD-1011 | 6adfefa7-75e3-4e09-9acc-b10eff51f01f | efa08cf9-bfee-4f50-aa92-5e08c62f8c37 | 0 |
| primary | ORD-1011 | 6adfefa7-75e3-4e09-9acc-b10eff51f01f | 3fe3d23b-90b3-4c46-844d-15e6645ebd56 | 0 |
| primary | ORD-1012 | 1f248b73-888d-4502-ae2c-3473ee5e2919 | de8165c4-6b66-4c17-b436-1ff229e2ef42 | 0 |
| primary | ORD-1012 | 1f248b73-888d-4502-ae2c-3473ee5e2919 | 381206c6-f340-4974-81b2-d0340e8c1565 | 0 |
| primary | ORD-1012 | 1f248b73-888d-4502-ae2c-3473ee5e2919 | ca102e1a-afdc-48ac-a4d6-fad0527520cf | 0 |
| primary | ORD-1013 | b35880d1-af8e-4c31-bef6-202a752d6fb3 | ce19e2fd-662a-4298-9a46-37ba029478eb | 1 |
| primary | ORD-20110 | 22a2ad00-ab49-40e9-bef7-57d0ac5b8f98 | f850ebec-1779-49cb-b8ec-43a7e887cb1d | 0 |
| primary | ORD-20111 | a536b25f-baae-4471-afb7-9fa4ff7eab35 | 9500257e-c927-42fa-ac92-aae9519cc38c | 0 |
| primary | ORD-20113 | a36c40f8-ba9f-472e-a749-8b96edb4c1fe | 3a755e73-aaf8-4582-9915-163fabd93e2f | 0 |
| primary | ORD-20114 | ff2fa7c3-5c8e-4b3f-941f-26669c99cb9b | 2e2e7101-0209-4ea2-a556-1572898dad39 | 0 |
| primary | ORD-20115 | c5b9e457-8a18-4c97-8f3d-0b53aaf844b8 | 7cc7feda-247f-47b7-a497-1979c4922212 | 0 |
| primary | ORD-20117 | db1e2b5f-ca32-4d1d-8881-38e064ec8de1 | 37666d05-b6d0-42e3-a416-b97201679268 | 0 |
| primary | ORD-20118 | c6e41455-2202-417d-92eb-86bd1d4ffdcb | ad16ad8d-37a2-444b-aa87-429b94d5a180 | 0 |
| primary | ORD-20120 | c30d6cc5-2c8f-4dd2-b34c-f89884624458 | 0b01fd7f-1f0a-449b-a542-e73e6a2855ea | 0 |
| primary | ORD-20122 | 8cc07c93-0c51-4ae5-ac6a-5545a6bf90ed | 0479cb03-e357-4264-895c-32743fc61b5e | 0 |
| primary | ORD-20123 | 5a0b8e3d-1044-4a10-8385-e8d799ec8bf6 | 993d30f6-0208-4cb5-8695-7f7d1ff3ba8e | 2 |
| primary | ORD-20125 | f32303f8-961c-4000-9da3-e7ed67e1258e | a99335b1-24a2-4a62-8fc8-8e61bd24e3a9 | 0 |
| m22-36f3c804-e1d0-47ab-8a84-f1d626c36e19 | ORD-36f3c804-e1d0-47ab-8a84-f1d626c36e19 | m22-order-36f3c804-e1d0-47ab-8a84-f1d626c36e19 | m22-line-36f3c804-e1d0-47ab-8a84-f1d626c36e19 | 5 |

## Product drafts requiring review

No draft was deleted or automatically declared abandoned. The eight rows marked old exceed the explicit 30-day reporting threshold; that threshold is not a retention rule. No draft has a detected current V2 Sales JSON reference in this query, but that is not an exhaustive dependency proof. `product_sales_line_count` includes lines for any version of the Product, preventing an old draft beside a used Product from being mistaken for an unused Product. V1/imported dependencies were not deleted or modified.

| Organization | Product ID | Draft version ID | Updated | Older than 30d | Product active | Product Sales lines |
| --- | --- | --- | --- | --- | --- | --- |
| primary | 01481233-b02e-4bf7-89c1-895cd4ceb76d | 761ca2c7-2d7d-4af6-b7f4-91befffcb774 | 2026-09-04 | false | true | 0 |
| primary | 03254469-3eb3-4e7c-972e-41088f4f46ab | 3edd9bc6-72dd-4d66-b0b8-88c32430ae32 | 2026-09-03 | false | true | 0 |
| primary | 12327a19-8884-4f48-b4d4-9b2ab171a9e4 | 52dd2dbd-7387-4cf6-8346-54f47ff10d03 | 2026-08-19 | false | true | 0 |
| primary | 34867d4f-7b3e-4887-a877-246427d2fd84 | 23b4096e-d09b-46b6-9d85-17c74d282dac | 2026-09-04 | false | true | 0 |
| primary | 4523052a-7990-4d35-93d3-cac66e2bbe77 | 21c56647-031b-4b14-b759-26f360c41413 | 2026-08-21 | false | true | 16 |
| primary | 7043e637-0cec-4c17-9b75-1ba1f5b44d34 | f64ccf4a-56cb-4413-8e08-d7046b8b72b8 | 2026-09-03 | false | true | 43 |
| primary | 7f78dfef-6ea4-4bc0-842c-2373f79f830f | 441286f2-9c02-4b58-8cce-7bf85533e40f | 2026-07-15 | true | false | 0 |
| primary | 977d1112-acaa-4b1e-b1be-fe3af0cc2753 | 4fdeaf47-1521-4bde-aaef-91bac3e23ea5 | 2026-07-12 | true | false | 0 |
| primary | a16ac8d9-7b74-4f32-b45f-7d55edb89897 | 0f81bcb8-1d51-4ee0-8f7f-3bfe0841e254 | 2026-08-21 | false | false | 0 |
| primary | b4834aaa-869d-487c-8663-1e0bca886fc1 | 8684759a-c7e9-485b-84ab-a81296ec79db | 2026-08-21 | false | false | 0 |
| primary | b9217a21-afe9-4fa1-96c6-f3dd2511e244 | 3f29eec4-6170-4949-8bd0-142535d28f46 | 2026-09-04 | false | true | 0 |
| primary | bb6c3ffb-1aba-4330-bcb1-fce6e27b21af | e9577206-c995-4f2b-97d5-1dc60e012813 | 2026-08-21 | false | false | 0 |
| primary | c06282bb-cb68-4a5d-bfa8-35bca836f921 | 0bf025c0-6d95-4ceb-9679-686f4ca46e4e | 2026-07-12 | true | true | 1 |
| primary | cb3722d8-8ca7-4361-b443-ec5791b42863 | 97de9526-d443-4c19-86bb-8b6deca7cff9 | 2026-08-21 | false | false | 0 |
| primary | d0cc5608-9bbc-4171-a4e6-ecfee0d4320c | 40ed1238-3119-45cc-91f9-55be9ff6b89d | 2026-08-25 | false | false | 0 |
| primary | de38f115-67a4-4dbd-b27c-46d66ce50734 | ae29b040-66fe-4849-9d32-6399e171a00e | 2026-08-25 | false | false | 0 |
| primary | df00792e-ab23-4516-baa3-9f174f69c495 | a49a5962-62c2-4145-90b2-1a72c30421aa | 2026-08-23 | false | true | 4 |
| primary | fa42b2e5-ca58-4c60-82ed-9d04c5fe41d9 | 024bd469-475f-4db9-ad0a-20abae8d27c1 | 2026-08-21 | false | false | 0 |
| primary | fe2a8bb5-d47e-4046-a4a7-310240bf978d | 2cfa35d7-d58d-46d5-99c1-92aaa51f9019 | 2026-07-16 | true | true | 0 |
| sandbox | 07918cf8-15b2-4406-9aef-9b21714fe050 | d6195ec9-743a-4183-9fed-17c62f424c80 | 2026-08-19 | false | true | 0 |
| sandbox | 144b3508-64a4-4c0b-ad5e-4a99b959f27e | de3e0e8e-9cb1-49d3-8c04-62f72b2effe5 | 2026-08-19 | false | true | 0 |
| sandbox | 2b6f69d4-b23f-4261-9b3d-90645d30029f | a6bc6a9e-cf70-46b1-be2f-2ac34c906f68 | 2026-05-26 | true | true | 0 |
| sandbox | 3034c7ea-fb73-479a-840d-5ade0e8ecca8 | ae2760e8-cab9-4c5e-b127-0810ddbe91f5 | 2026-08-19 | false | true | 0 |
| sandbox | 61650b61-7e7b-481d-8371-102684c06889 | a3dcd21f-8da7-4447-83e2-1b73dbab0081 | 2026-08-18 | false | true | 0 |
| sandbox | 7c8ae55d-55b7-4b64-8268-05fd5f216755 | 55b88613-598f-4b85-befa-19f0b57544f9 | 2026-06-02 | true | false | 0 |
| sandbox | 80443195-4b08-4521-bca5-987df4ae7f4f | dc7baa1d-3115-4ae5-8728-b530456be0a3 | 2026-06-08 | true | false | 0 |
| sandbox | 8b68835b-d245-440a-8e9d-4614095eb17d | e4c83b34-8d21-4473-b633-062ead6675d5 | 2026-08-18 | false | true | 0 |
| sandbox | 8cade329-9133-4cd1-8c49-1169fb4fa5d2 | 3a5f0bed-7fe7-448f-a21f-0771887075fe | 2026-05-20 | true | true | 0 |
| sandbox | 99758f86-d72a-4f78-b9c3-e2083c361d60 | 5e24c9f6-95aa-4b8d-abc4-6ecf86d581d0 | 2026-08-18 | false | true | 0 |
| sandbox | aca0d66c-a331-432d-ab12-82169fd82de6 | 043d38b1-e8f3-410b-8485-7e0c8b871acb | 2026-08-18 | false | true | 0 |
| sandbox | ae5bcdfd-2905-4335-b015-434664182b33 | 03198494-ac20-45dd-8059-7d4ea775dc51 | 2026-08-18 | false | true | 0 |
| p7b-org-1df59fc4-1027-4783-9e67-7e2b8b94180f | p7b-product-1df59fc4-1027-4783-9e67-7e2b8b94180f | b58aec9e-e533-42e5-9f8e-10937f8550cf | 2026-08-19 | false | true | 3 |
| p7b-org-46f18d4e-e2f1-4e89-8517-01b4c8160a71 | p7b-product-46f18d4e-e2f1-4e89-8517-01b4c8160a71 | 4b2ef2eb-37e7-4982-b839-68d5dce1aa00 | 2026-08-19 | false | true | 3 |
| p7b-org-b6f1bc8c-659d-4750-a1b5-40862c21ceec | p7b-product-b6f1bc8c-659d-4750-a1b5-40862c21ceec | a7fa0722-3503-4e8f-8fed-3133b8c0bfc3 | 2026-08-19 | false | true | 3 |
| p7d-258c594d-3b10-415d-ba12-08fe0f1c704f | p7d-product-258c594d-3b10-415d-ba12-08fe0f1c704f | ce0945fa-0587-4748-a179-f5411523a828 | 2026-08-19 | false | true | 1 |
| p7d-25b9c315-0228-4660-9857-a29a76949cba | p7d-product-25b9c315-0228-4660-9857-a29a76949cba | 9f22da68-18e5-40d7-a618-fa2c685acc58 | 2026-08-19 | false | true | 1 |
| p7d-4226c56e-492f-4153-9a13-e2a750e9301a | p7d-product-4226c56e-492f-4153-9a13-e2a750e9301a | cc41dfc1-f8f7-42e6-b051-b6a100923e66 | 2026-08-19 | false | true | 1 |
| p7d-6096f781-197a-4d1e-9ec1-291567110562 | p7d-product-6096f781-197a-4d1e-9ec1-291567110562 | 49ed819e-dc5d-4fb4-918c-cd5c25d56fa6 | 2026-08-19 | false | true | 1 |
| p7d-85bbd3f1-2c70-44d6-b260-36d5143cf030 | p7d-product-85bbd3f1-2c70-44d6-b260-36d5143cf030 | f20ba7df-5e51-43c8-bb17-4b0a0e872337 | 2026-08-19 | false | true | 1 |
| p7d-8bafa6ca-9e13-4eb9-9861-914618970aa1 | p7d-product-8bafa6ca-9e13-4eb9-9861-914618970aa1 | efdbe979-8197-45fc-b109-9d0ed424b1f0 | 2026-08-19 | false | true | 1 |
| p7d-96153f09-2e47-4e52-9f4f-21dc4a357f42 | p7d-product-96153f09-2e47-4e52-9f4f-21dc4a357f42 | 2a7fe71f-31a1-446d-801b-2ce6f8295b02 | 2026-08-19 | false | true | 1 |
| p7d-9f08c9b5-8096-4aa6-80bc-e643227583ff | p7d-product-9f08c9b5-8096-4aa6-80bc-e643227583ff | bc967941-9d2d-49a7-8b87-f5ac8e88ea59 | 2026-08-19 | false | true | 1 |
| p7d-acaa2065-3afc-46e5-92d6-a2486df5c705 | p7d-product-acaa2065-3afc-46e5-92d6-a2486df5c705 | 0d0c1e2f-03f6-497d-8d13-d1c2ff5ccbb1 | 2026-08-19 | false | true | 1 |
| p7d-ae054d1c-12c6-4c02-b885-851f715d5aea | p7d-product-ae054d1c-12c6-4c02-b885-851f715d5aea | e8e81f32-9a56-4bac-aa6d-94eefb33b242 | 2026-08-19 | false | true | 1 |
| p7d-d90722cf-e7f4-4d92-b05b-9ff71c1035e6 | p7d-product-d90722cf-e7f4-4d92-b05b-9ff71c1035e6 | 36613f1a-2a3c-4f61-a93e-64d63f32796f | 2026-08-19 | false | true | 1 |
| p7d-e1f7c52b-0f98-48c6-abd2-351e4da17c9d | p7d-product-e1f7c52b-0f98-48c6-abd2-351e4da17c9d | 0a462183-d991-4f1b-9cab-2ac8ae69413d | 2026-08-19 | false | true | 1 |
| p7d-eee7ac6d-36b0-405e-906b-94b38ad987e1 | p7d-product-eee7ac6d-36b0-405e-906b-94b38ad987e1 | b38e9148-93c9-42d5-9924-5bb345c4001a | 2026-08-19 | false | true | 1 |
| p7d-f1fe17d6-3ba9-4651-bc56-e5266ca0e18b | p7d-product-f1fe17d6-3ba9-4651-bc56-e5266ca0e18b | a72f3b07-ec78-4407-a0de-b5de6bede630 | 2026-08-19 | false | true | 1 |
| p7d-f6a7f722-60ea-4353-b2fc-6925748489bc | p7d-product-f6a7f722-60ea-4353-b2fc-6925748489bc | 4a73b5b6-10f1-4438-ab17-665791396d6a | 2026-08-19 | false | true | 1 |
| p7d-f7c83458-800c-4aa9-84e8-46b34a3dea29 | p7d-product-f7c83458-800c-4aa9-84e8-46b34a3dea29 | 90aa8ccb-7a41-4be5-9a55-ad92fd7fab4a | 2026-08-19 | false | true | 1 |

## Primary QA-labelled commercial history

These 34 IDs have a QA-customer label signal and are retained. The remaining 26 primary Sales documents have no QA label signal and are also retained. The 73 documents in known rehearsal organizations remain regression history; no cross-tenant cleanup is authorized.

| Kind | Number | Document ID | Lines | Invoice references | Quote checkpoints | Audit events |
| --- | --- | --- | --- | --- | --- | --- |
| order | ORD-1011 | 6adfefa7-75e3-4e09-9acc-b10eff51f01f | 3 | 1 | 0 | 2 |
| order | ORD-1012 | 1f248b73-888d-4502-ae2c-3473ee5e2919 | 3 | 1 | 0 | 1 |
| order | ORD-1013 | b35880d1-af8e-4c31-bef6-202a752d6fb3 | 2 | 1 | 0 | 2 |
| order | ORD-20110 | 22a2ad00-ab49-40e9-bef7-57d0ac5b8f98 | 1 | 1 | 0 | 2 |
| order | ORD-20111 | a536b25f-baae-4471-afb7-9fa4ff7eab35 | 1 | 1 | 0 | 1 |
| order | ORD-20113 | a36c40f8-ba9f-472e-a749-8b96edb4c1fe | 1 | 1 | 0 | 1 |
| order | ORD-20114 | ff2fa7c3-5c8e-4b3f-941f-26669c99cb9b | 1 | 1 | 0 | 1 |
| order | ORD-20115 | c5b9e457-8a18-4c97-8f3d-0b53aaf844b8 | 1 | 1 | 0 | 1 |
| order | ORD-20117 | db1e2b5f-ca32-4d1d-8881-38e064ec8de1 | 1 | 1 | 0 | 1 |
| order | ORD-20118 | c6e41455-2202-417d-92eb-86bd1d4ffdcb | 1 | 1 | 0 | 1 |
| order | ORD-20120 | c30d6cc5-2c8f-4dd2-b34c-f89884624458 | 1 | 1 | 0 | 1 |
| order | ORD-20122 | 8cc07c93-0c51-4ae5-ac6a-5545a6bf90ed | 1 | 1 | 0 | 1 |
| order | ORD-20123 | 5a0b8e3d-1044-4a10-8385-e8d799ec8bf6 | 1 | 1 | 0 | 1 |
| order | ORD-20125 | f32303f8-961c-4000-9da3-e7ed67e1258e | 1 | 1 | 0 | 1 |
| order | ORD-20126 | 55338806-5eb1-41d6-a8c9-48384a66b63a | 1 | 1 | 0 | 9 |
| quote | QT-1015 | 5629a0ca-2052-4adb-a1d2-d1f87a7d8b69 | 2 | 0 | 0 | 2 |
| quote | QT-1016 | 1a8700cf-1cbd-4e58-a394-39faa779e854 | 3 | 0 | 3 | 6 |
| quote | QT-1017 | 0f3df8cf-fa3c-4d7d-91cd-98de30541971 | 2 | 0 | 3 | 3 |
| quote | QT-20016 | c0ca0904-106b-4f33-8701-fbd4dd0ad11f | 1 | 0 | 0 | 1 |
| quote | QT-20017 | 84ca6048-5b68-4459-9c08-ccfeab6449da | 1 | 0 | 0 | 1 |
| quote | QT-20018 | 8fad71e5-4bf7-4e68-b165-9f142f5f63c5 | 1 | 0 | 0 | 1 |
| quote | QT-20021 | e37b7d86-96ae-4206-ab4c-342c2b12e864 | 1 | 0 | 0 | 1 |
| quote | QT-20022 | 83567005-dc92-445c-873e-9fcf31f2d57b | 1 | 0 | 0 | 1 |
| quote | QT-20024 | efb9ff34-ac04-4c28-9685-579616fe1c24 | 1 | 0 | 0 | 1 |
| quote | QT-20026 | 767b1b31-2694-425c-8d37-1eed7a84e7d2 | 1 | 0 | 0 | 1 |
| quote | QT-20027 | 2e30b7b1-c176-4b74-8259-a107f4ead55d | 1 | 0 | 0 | 1 |
| quote | QT-20029 | a1e1a52b-f77e-4ffe-85b4-1988a5250676 | 1 | 0 | 0 | 1 |
| quote | QT-20031 | 8af084b8-b6a9-4a11-ab17-38908f1c11c9 | 1 | 0 | 0 | 1 |
| quote | QT-20032 | f8c6259c-e2b7-43f8-9f6c-d5f5266cae55 | 1 | 0 | 0 | 1 |
| quote | QT-20034 | 66250e58-10a1-435c-8f7d-352d00c18c4b | 1 | 0 | 0 | 1 |
| quote | QT-20036 | eea95c2d-823e-4613-9407-87d899782084 | 1 | 0 | 0 | 1 |
| quote | QT-20037 | 8021944b-e97e-48cc-898c-4ffb8e834bd7 | 1 | 0 | 0 | 1 |
| quote | QT-20039 | 9d4a255d-01cc-4bbe-a380-151127cd9061 | 1 | 0 | 0 | 1 |
| quote | QT-20040 | 18068047-3917-46e2-ab3c-68ba7d921d66 | 1 | 0 | 3 | 3 |

## Payment and delivery history

Every Payment below has an allocation and remains immutable financial evidence. Seven have provider transaction evidence. Payment/reference retention applies even when a customer name marks a QA fixture. Refunds and provider events were counted, not re-created or sent.

| Payment ID | Invoice ID | Source | Method | Allocation count | QuickBooks reference count |
| --- | --- | --- | --- | --- | --- |
| f5531eff-dfd6-43c7-9bb3-8fa4be1d4984 | 8c280e99-abdf-4419-9a99-a1d0bf5652be | manual | check | 1 | 0 |
| 39dd38ec-86a8-46a1-b096-746cc8ef0001 | 8c280e99-abdf-4419-9a99-a1d0bf5652be | provider | card | 1 | 0 |
| 49d4f543-9ecf-4f13-bfb9-2e29cbea056d | 431ab0c2-84da-4a5b-ace2-8c3bc1560aae | provider | card | 1 | 0 |
| ef838f08-fe44-40ed-b9b0-812419be98f7 | 431ab0c2-84da-4a5b-ace2-8c3bc1560aae | provider | card | 1 | 0 |
| 35df628a-2680-48a3-9132-45fc18e9f86a | 8c280e99-abdf-4419-9a99-a1d0bf5652be | provider | card | 1 | 0 |
| 9014959a-0e2a-46b5-8576-16eae314ec5a | 0afca8f1-b07e-408e-8a59-72f7ac291dd8 | provider | card | 1 | 0 |
| 9cd5747c-1421-489f-92be-217352598a23 | 9e0e70b6-c60e-421b-9b1e-e3fe4db13db4 | provider | card | 1 | 0 |
| 1ec933ca-829c-4b84-80ad-3b5c77322bf7 | 431ab0c2-84da-4a5b-ace2-8c3bc1560aae | provider | card | 1 | 1 |

All four ambiguous deliveries have provider-attempt evidence. Resetting them to pending, deleting them or retrying without canonical reconciliation could duplicate sends. The pending outbox contains five invoice-issued, one manual payment-recorded, seven provider-payment-succeeded, four provider-refund-succeeded and one manual refund-recorded event. Generic outbox retention is not proof that a second provider writer should run. Preserve events while the canonical owners determine consumption/reconciliation status.

| Queue | Job ID | State | Event type | Older than 7d | Provider attempt evidence | Disposition |
| --- | --- | --- | --- | --- | --- | --- |
| v2_invoice_email_delivery_jobs | 0b34ea27-e0b1-43da-ab3b-76b83672463d | ambiguous | - | false | true | REVIEW |
| v2_invoice_email_delivery_jobs | 293461db-24e5-4342-8c4a-292fc1d0e214 | ambiguous | - | false | true | REVIEW |
| v2_invoice_email_delivery_jobs | 5462a64e-3533-49e5-b523-846733fcddc9 | sent | - | false | true | KEEP AS HISTORY |
| v2_invoice_email_delivery_jobs | 37755fd3-761f-41fe-b8da-339b284a297d | sent | - | false | true | KEEP AS HISTORY |
| v2_invoice_email_delivery_jobs | 52f43f87-d478-4170-b679-e08180d7f8e7 | sent | - | false | true | KEEP AS HISTORY |
| v2_invoice_email_delivery_jobs | 6ccb01b0-d114-451c-bb68-0b89e1eb7834 | sent | - | false | true | KEEP AS HISTORY |
| v2_proof_delivery_jobs | 41c8d841-3a06-4415-a183-6a70e3dcac8c | ambiguous | - | false | true | REVIEW |
| v2_proof_delivery_jobs | d1f0d260-c7dc-4dca-97e6-d7349e6961e5 | ambiguous | - | false | true | REVIEW |
| v2_quickbooks_sync_jobs | 5bd0f739-fd6d-4fa3-b2ee-49c3d4fc3e41 | succeeded | - | false | - | KEEP AS HISTORY |
| v2_quickbooks_sync_jobs | 4d7d7eee-3a57-4246-905e-aabe26478dd1 | succeeded | - | false | - | KEEP AS HISTORY |
| v2_quickbooks_sync_jobs | 41ee4105-bcef-4c82-a214-6de52b55672d | succeeded | - | false | - | KEEP AS HISTORY |
| v2_quickbooks_sync_jobs | 22bab374-ae52-4079-bc5e-30ac8072ed20 | succeeded | - | false | - | KEEP AS HISTORY |
| v2_quickbooks_sync_jobs | feb5b6ea-8aac-4895-a36c-adca6bf63b59 | succeeded | - | false | - | KEEP AS HISTORY |
| v2_outbox_messages | 4f594fce-fd32-4422-98aa-502797e527fe | pending | billing.invoice.issued.v1 | true | - | REVIEW |
| v2_outbox_messages | 53f9e7f9-e7d3-4f80-b631-d35871537e7f | pending | billing.invoice.issued.v1 | true | - | REVIEW |
| v2_outbox_messages | ffe01327-19e4-4445-bec1-87b9ccc14431 | pending | billing.invoice.issued.v1 | true | - | REVIEW |
| v2_outbox_messages | 92e030bc-30dd-44d3-8261-5f7632623fad | pending | billing.invoice.issued.v1 | false | - | REVIEW |
| v2_outbox_messages | cbf9ede7-8a47-4e75-8112-a9a0adb94cdf | pending | billing.payment_recorded.v1 | false | - | REVIEW |
| v2_outbox_messages | 5a16b5b6-993a-4796-9da3-7513403ee33c | pending | billing.refund_recorded.v1 | false | - | REVIEW |
| v2_outbox_messages | 1c67c73b-e705-43c9-b0cf-eefe3d42e1a2 | pending | billing.provider_payment_succeeded.v1 | false | - | REVIEW |
| v2_outbox_messages | df9d647b-6651-44a1-9abe-08147cb2b8b1 | pending | billing.provider_refund_succeeded.v1 | false | - | REVIEW |
| v2_outbox_messages | cf1116bf-8570-4962-960f-e48e74b2d5ec | pending | billing.invoice.issued.v1 | false | - | REVIEW |
| v2_outbox_messages | 2b4cf7a5-bdca-40c2-93c9-229fed5c4f84 | pending | billing.provider_payment_succeeded.v1 | false | - | REVIEW |
| v2_outbox_messages | a111a27f-b7d8-4cb2-a215-9c0a86890024 | pending | billing.provider_refund_succeeded.v1 | false | - | REVIEW |
| v2_outbox_messages | e4d35c72-274b-42c4-9149-24576ed40d1f | pending | billing.provider_payment_succeeded.v1 | false | - | REVIEW |
| v2_outbox_messages | 85e42ad8-d08e-4c69-841a-90fadc425a2f | pending | billing.provider_payment_succeeded.v1 | false | - | REVIEW |
| v2_outbox_messages | 4c4bea2d-71fb-4a2a-aef4-35afc4382afc | pending | billing.provider_refund_succeeded.v1 | false | - | REVIEW |
| v2_outbox_messages | c7c49a2b-cc55-4bf1-862e-6930592567c3 | pending | billing.provider_payment_succeeded.v1 | false | - | REVIEW |
| v2_outbox_messages | 9ac2196f-9fe4-4bfa-85d5-9d332c9f57ef | pending | billing.provider_refund_succeeded.v1 | false | - | REVIEW |
| v2_outbox_messages | af60819b-c1ae-4e6c-aa13-7dc1a478cfae | pending | billing.provider_payment_succeeded.v1 | false | - | REVIEW |
| v2_outbox_messages | 220dd432-b311-4e7b-80db-fb7c55bc8885 | pending | billing.provider_payment_succeeded.v1 | false | - | REVIEW |

## Duplicate customers and orphan-like artwork

No group below is proven to be a duplicate QA customer. Counts include V2 Sales only; zero is not proof of no relationship to contacts, portal access, accounting or imported business records. A future approved merge must use canonical CRM behavior with full relationship review.

| Organization | Customer IDs | V2 Sales documents | All QA labels |
| --- | --- | --- | --- |
| primary | 177362db-23a1-46e5-8e40-d5398c65acf4, f1974796-5649-4d4f-a7e5-4579d1ad7088 | 0 | false |
| primary | 29e82a0f-7acf-416a-8870-a7051bab0f9c, 4d33dc5d-1049-4cb3-9c71-ee4924f657ba | 0 | false |
| primary | 2a475d18-7ccc-4d9c-8778-867f449090a4, bdf2f686-a876-405a-b6f1-615a413b5f02 | 0 | false |
| primary | 3cc17e72-6797-4e15-bdd7-c497f6cea95d, 3fc1211c-33aa-4aaa-8b05-e1c901702843 | 0 | false |
| primary | 7eed7cba-30c1-47a5-aea4-13c85c6eab3a, 820b4311-eade-4852-9a3c-13ae3ad21ec1 | 0 | false |

Artwork file `23e8fcd9-9ff4-4327-a9f3-a6568f6e6725` in primary was created 2026-08-29, source `customer_upload`, with no adopted upload-intent link. No direct references were found in Order/Quote assignments, accepted Quote artwork, Proof artwork, Prepress units, Production works, or derived-file parents. This remains **REVIEW** because immutable JSON evidence, external storage ownership and pending workflow intent were not exhaustively proven absent. No file/object deletion occurred. All three upload intents are already adopted and retained.

## Failed operations / migration-test evidence

Primary has 14 retryable Product publish failures and 3 permanent Quote delivery failures. Nine additional Product publish failures belong to known P7D rehearsals. No failed migration or replaced artifact is inferred from these rows, and no ledger row is changed. OperationRequest identities are needed for failure diagnosis and idempotent replay. Exact review IDs follow.

| Organization | OperationRequest ID | Operation | Status | Created |
| --- | --- | --- | --- | --- |
| primary | e2b9f13a-9a1b-4c4e-9ab7-b6728f64c5f7 | product.draft.publish.v1 | retryable_failure | 2026-08-19 |
| primary | 061d796b-4c81-4e41-87c2-9b80ea53eb54 | product.draft.publish.v1 | retryable_failure | 2026-08-20 |
| primary | ab80b030-88fe-4216-97f5-ff33727c2e53 | product.draft.publish.v1 | retryable_failure | 2026-08-21 |
| primary | 8e4123e6-b41a-4be4-a225-95b30f315d1f | product.draft.publish.v1 | retryable_failure | 2026-08-22 |
| primary | a5f2e1bc-f3e8-49b0-a93f-e3955e4038db | product.draft.publish.v1 | retryable_failure | 2026-08-22 |
| primary | 8f068d2e-c010-4297-bde5-9b439e812d86 | sales.quote.delivery.v1 | permanent_failure | 2026-08-28 |
| primary | 167a7ee6-1860-4280-8df8-0efddfcdcc3b | sales.quote.delivery.v1 | permanent_failure | 2026-08-29 |
| primary | 7bc1ff99-f1c6-4026-af6b-0c18c8cc498d | sales.quote.delivery.v1 | permanent_failure | 2026-08-31 |
| primary | 035bcc94-5fb9-4f6d-bf1e-c18095c2ff3a | product.draft.publish.v1 | retryable_failure | 2026-09-03 |
| primary | d2feeb07-e1d5-459c-b773-3c0e7ea26a16 | product.draft.publish.v1 | retryable_failure | 2026-09-03 |
| primary | f45f8879-d453-4839-a99b-f79787cad7b0 | product.draft.publish.v1 | retryable_failure | 2026-09-03 |
| primary | a6c5fa8a-0e2a-4fc6-830b-5f44f1bb281e | product.draft.publish.v1 | retryable_failure | 2026-09-03 |
| primary | d21a7b24-2c1f-413f-b00e-65632e858eb6 | product.draft.publish.v1 | retryable_failure | 2026-09-03 |
| primary | 36a9d4fe-9809-404e-984a-38c6b294f6d9 | product.draft.publish.v1 | retryable_failure | 2026-09-03 |
| primary | 67456dde-eb62-475f-bfb8-ec2ea9874042 | product.draft.publish.v1 | retryable_failure | 2026-09-04 |
| primary | 8f9af6fe-e48e-477b-837a-16e2bef40ed8 | product.draft.publish.v1 | retryable_failure | 2026-09-04 |
| primary | a815323e-8eb8-4def-959b-4da93d7ff2c4 | product.draft.publish.v1 | retryable_failure | 2026-09-04 |
| p7d-258c594d-3b10-415d-ba12-08fe0f1c704f | a68fba09-5dba-413e-b99a-7c4b7e363d45 | product.draft.publish.v1 | retryable_failure | 2026-08-19 |
| p7d-4226c56e-492f-4153-9a13-e2a750e9301a | 47fd527a-fdc4-457f-8d5b-b5640fbe0f48 | product.draft.publish.v1 | retryable_failure | 2026-08-19 |
| p7d-6096f781-197a-4d1e-9ec1-291567110562 | f9ee17e9-59f6-428e-9c1c-fa64bb25f8cd | product.draft.publish.v1 | retryable_failure | 2026-08-19 |
| p7d-96153f09-2e47-4e52-9f4f-21dc4a357f42 | ed30381b-fdf0-4c87-ad81-4996ccd5bfc6 | product.draft.publish.v1 | retryable_failure | 2026-08-19 |
| p7d-9f08c9b5-8096-4aa6-80bc-e643227583ff | 6189b720-63de-49fa-a7da-704eb3c65a90 | product.draft.publish.v1 | retryable_failure | 2026-08-19 |
| p7d-e1f7c52b-0f98-48c6-abd2-351e4da17c9d | 29b51741-54ad-4d8d-adc8-8e6264585acc | product.draft.publish.v1 | retryable_failure | 2026-08-19 |
| p7d-eee7ac6d-36b0-405e-906b-94b38ad987e1 | 1ff26935-bc5d-47c4-bce0-4a9b20043d76 | product.draft.publish.v1 | retryable_failure | 2026-08-19 |
| p7d-f6a7f722-60ea-4353-b2fc-6925748489bc | 8970972b-50ce-4be2-bcfd-1fb36d371c7a | product.draft.publish.v1 | retryable_failure | 2026-08-19 |
| p7d-f7c83458-800c-4aa9-84e8-46b34a3dea29 | ff1bdd13-4e6a-49a5-9490-1f80faf9c9f2 | product.draft.publish.v1 | retryable_failure | 2026-08-19 |

## Schema and compatibility findings

No schema-removal candidate has strong enough evidence. No new migration is necessary for the view split; historical migrations remain unchanged. All-DEV occupancy was checked for every public V2 base table. Four tables are empty but have live owners:

| Empty table(s) | Live owner | Decision |
| --- | --- | --- |
| v2_customer_portal_ceiling_policies / v2_customer_portal_ceiling_capabilities | postgresPermissionAdministration.ts; postgresPermissionAuthorityRead.ts | KEEP: explicit customer portal ceilings and authority reads. |
| v2_portal_password_reset_tokens | standaloneStaffAuth.ts; postgresTeamAccess.ts | KEEP: reset-token lifecycle and revocation. |
| v2_team_invitation_delivery_attempts | postgresTeamAccess.ts | KEEP: team invitation delivery and uncertain-attempt evidence. |

Primary's 35 Products retain 26 non-null legacy option trees, 26 nonempty legacy formula strings, 8 Formula Library pointers and 26 active-version pointers. There are 14 explicit Recipe components marked `replaces_pbv2_compatibility`. The canonical ProductVersion/preview/Recipe readers still consume these compatibility paths. Zero non-null `options_json` rows in primary does not establish safety for other tenants, imported records or recovery. KEEP these fields.

The primary has 59 unconfigured Sales lines across Quotes/Orders, including the 18 currently visible to Prepress; these counts describe different scopes. Requirement state/count/fingerprint plus requirement rows form a contract, not interchangeable duplicate fields. Commercial Order state, completed/archived timestamps, route state and Prepress/Production execution evidence have separate owners. Do not collapse them as redundant.

Immutable/history occupancy includes 1,209 V2 audit events, 286 inventory movements, 65 inventory reservations, 24 inventory reconciliation attempts, 15 provider events and 14 provider financial operations. These are positive evidence for retaining audit, ledger and reconciliation paths.

## Reproduction and validation

Run with the explicitly approved Railway DEV service environment:

```text
node --import tsx v2/scripts/reportDevHistoricalDataHygiene.ts --organization-id 56e0f644-bb25-43ef-8ee1-473831115849
node --import tsx v2/scripts/reportDevHistoricalDataHygiene.ts --all-organizations
node --import tsx v2/tests/infrastructure/devHistoricalDataHygiene.pure.ts
```

The report rejects missing/ambiguous scope, unsupported arguments, non-DEV identity and invalid/missing canonical database URL before pool creation. Pure tests cover these failures, read-only transaction setup, rollback/release/end after success/failure, refusal to proceed when read-only is not established, no commit, QA-label/age non-authority, Payment retention and ambiguous/uncertain/failed queue preservation. Explicit TypeScript checking of the script, helper and regression file passed. All-organization and tenant-scoped DEV runs both passed; the all-organization snapshot is recorded above.

Session evidence is in `codex-artifacts/post-m6/historical-data-all.json`, `historical-data-primary.json` and `prepress-views-dev.json`; the meaningful candidate IDs are retained in this tracked report. Other milestone build/browser/routing results belong to the primary integration report.

## Candidates requiring a human decision

- All 50 draft versions listed above: business intent/abandonment and full historical dependencies must be established before discard or deletion.
- The 19 unconfigured Prepress lines: UI separation is complete without data mutation. Any persisted archival or recovery must preserve mixed configured work and use authoritative requirements.
- The 4 ambiguous delivery IDs: canonical delivery reconciliation decision before retry or cleanup.
- The 18 pending financial outbox IDs: consumer/reconciliation decision before status changes or deletion.
- The 5 customer collision groups: identity and complete relationship review before canonical merge.
- Artwork file `23e8fcd9-9ff4-4327-a9f3-a6568f6e6725`: storage and immutable-reference review before deletion.
- The sandbox tenant and historical rehearsal organizations: choose retention/archive policy explicitly; names alone do not justify destructive cleanup.

No deletion approval was requested because the authorized non-destructive tooling, classification and queue-view work could be completed. Destructive candidates remain preserved. Before M7, keep the compatibility contracts, resolve or explicitly accept the listed recovery/reconciliation debt, and carry forward the primary-tenant routing regression separately from sandbox/rehearsal readiness.
