# M7.7E-B QA fixture manifest

All entries below are retained only inside `PrintersHero M7 QA` (`b6f969b2-dda3-4133-9d75-c417dabb8f3a`). They contain synthetic QA data and no provider configuration.

| Type | Reference | Classification | Purpose |
| --- | --- | --- | --- |
| Customer/contact | M77E Customer A and synthetic contact | REUSABLE QA | commercial, Order, Fulfillment, Finance validation |
| Customer/contact | M77E Customer B and synthetic contact | REUSABLE QA | future authorization/IDOR validation |
| Product | M77E Service Fee | RETAIN AS EVIDENCE | active flat-fee, no-physical-work regression fixture |
| Order/invoice | ORD-1000 / service-fee | RETAIN AS EVIDENCE | $2.50 commercial-only behavior |
| Product | M77E Fulfillment Only | RETAIN AS EVIDENCE | physical-work exclusion and handoff regression fixture |
| Order/invoice | ORD-1001 / fulfillment-only | RETAIN AS EVIDENCE | 40/35/25 handoff, manual shipment, payment/refund history |
| Shipment | QA manual shipment attached to ORD-1001 handoff | RETAIN AS EVIDENCE | carrier/tracking/container behavior |

No fixture is copied from an ordinary DEV tenant. No cleanup was performed: these deterministic records are valuable regression evidence. Synthetic IDs and provider-free values are intentionally not reproduced here beyond human-readable fixture references.
