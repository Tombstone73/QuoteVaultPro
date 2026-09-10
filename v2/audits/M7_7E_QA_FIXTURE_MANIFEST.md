# M7.7E-C QA fixture manifest

All entries below are retained only inside `PrintersHero M7 QA` (`b6f969b2-dda3-4133-9d75-c417dabb8f3a`). They contain synthetic QA data and no provider configuration.

| Type | Reference | Classification | Purpose |
| --- | --- | --- | --- |
| Customer/contact | M77E Customer A and synthetic contact | REUSABLE QA | Commercial, Orders, Fulfillment, Finance, and station validation |
| Customer/contact | M77E Customer B and synthetic contact | REUSABLE QA | Future portal/IDOR validation |
| Product | M77E Service Fee | RETAIN AS EVIDENCE | active flat-fee, no-physical-work regression fixture |
| Order/invoice | ORD-1000 / service-fee | RETAIN AS EVIDENCE | $2.50 commercial-only behavior |
| Product | M77E Fulfillment Only | RETAIN AS EVIDENCE | physical-work exclusion and handoff regression fixture |
| Order/invoice | ORD-1001 / fulfillment-only | RETAIN AS EVIDENCE | 40/35/25 handoff, manual shipment, payment/refund history |
| Shipment | QA manual shipment attached to ORD-1001 handoff | RETAIN AS EVIDENCE | carrier/tracking/container behavior |
| Route/Product | M77E Flatbed standard-production fixture | REUSABLE QA | Explicit frozen Flatbed destination and minimal enabled runtime option |
| Order/Artwork/Prepress/Production | Flatbed standard-production fixture | RETAIN AS EVIDENCE | Completed Prepress handoff plus two-attempt quantity completion |
| Route/Product | M77E Roll standard-production fixture | REUSABLE QA | Explicit frozen Roll destination and minimal enabled runtime option |
| Order/Artwork/Production | Roll front/back fixture | RETAIN AS EVIDENCE | Canonical front/back assignment separation and Roll completion |
| Order/Artwork/Production | Direct Production Flatbed fixture | RETAIN AS EVIDENCE | Strict direct transition, frozen route, explicit production-open, and replay evidence |
| Order/invoice | ORD-1011 inbound lifecycle fixture | RETAIN AS EVIDENCE | Inbound conversion once; reused synthetic front/back QA art; Prepress → frozen Roll Production → pickup → payment auto-close → refund auto-reopen, with immutable history preserved |

No fixture is copied from an ordinary DEV tenant. No broad cleanup was performed: these deterministic records are valuable regression evidence. The incomplete Proof, Portal, Inbound, and AI scenarios have no synthetic substitute fixture. Synthetic IDs and provider-free values are intentionally not reproduced here beyond human-readable fixture references.
