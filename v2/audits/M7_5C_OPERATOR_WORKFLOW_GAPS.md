# M7.5C operator workflow gaps

| Task | V2 source outcome | Stop point | Classification |
| --- | --- | --- | --- |
| A. Customer → Quote → Order | canonical quote create/configure/price/send/accept/convert exists | live email/provider and representative DEV proof pending | P1 validation |
| B. Email job → intake → customer/artwork → Order | no V2 intake route, UI, or conversion adapter | first step | P0 missing |
| C. Print-ready Order → direct Flatbed | station route exists | no operator policy selecting/authorizing bypass versus required Prepress | P0 new requirement |
| D. Prepress-required Order → artwork → Roll | queue/start/complete unit exists | no authoritative preview, production-art revision/upload, material/dimension context, or clear route handoff | P0 partial |
| E. Production complete → Fulfillment → pickup/shipment → invoice | allocation facts, partial pickup/shipment and financial reads exist | shipping packages/carrier/tracking/labels/scans and richer closure workflow absent | P0 partial if shipping launch |
| F. Proof → send → revision → replace → resend → approval | immutable version/delivery/approval core exists | visual artifact review and replacement/handoff UX incomplete | P1 partial |
| G. Catalog → Edit → Builder → Draft → publish | M7.5B restores valid Draft loading | authenticated DEV representative proof pending | P1 validation |
| H. Customer portal → orders/quotes/docs/proofs/payments | proofs/invoices/payments exist | orders, quotes, documents, profile/dashboard absent | P0 unless portal-off launch |

## List/detail implications

Orders need production, fulfillment, billing, representative, artwork-thumbnail, and actionable status projections before they replace an operator workboard. Customers/Contacts need linked canonical activity rather than V1-style client-local projections. Prepress/Production/Fulfillment need decision context—not merely a record list. Product and Finance source architecture are stronger than V1 but still require live validation.

## Flexible workflow principle

The existing `workflowIntent` foundation (`standard_production`, `fulfillment_only`, `service_fee`) proves that V2 is not required to recreate V1’s universal forced pipeline. Missing is the authorized policy that chooses normal Prepress → Production → Fulfillment, direct Production → Fulfillment, or legitimate no-production flow per Product/Order while retaining billing closure and frozen route evidence.
