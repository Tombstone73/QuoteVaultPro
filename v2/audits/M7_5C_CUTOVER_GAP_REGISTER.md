# M7.5C cutover gap register

| ID | Domain | Capability | Current V2 state | V1 reference | Impact | Priority / effort | Dependencies | Recommended action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| GAP-01 | Inbound | intake/review/parse/association/convert | absent UI/API | Inbound Orders route/page/service | email-originated work stops | P0/L | canonical order/customer/artwork, email authority | build V2-native intake or explicitly retain/disable V1 authority |
| GAP-02 | Orders | high-volume operational list + traveler decision | list lacks production/fulfillment/billing/rep/thumb/action projections | Orders list/detail/traveler | staff cannot efficiently operate work | P0/M-L | operational read model, document decision | complete projection; decide staff traveler versus canonical PDF |
| GAP-03 | Prepress | production-art revision, preview, context, handoff | queue actions exist but station is incomplete | V1 prepress/production tooling | required-prepress orders cannot be safely completed | P0/L | artwork viewer/access, route policy | complete owner-separated Prepress workflow |
| GAP-04 | Production | Flatbed/Roll operator station completeness | queue/attempt/material core exists; viewer/context/batching/touch gaps | V1 Flatbed/Roll boards | station use is not shop-ready | P0/L | artwork access, workflow policy, machine decisions | complete station task model; do not invent scheduling |
| GAP-05 | Fulfillment | shipping/package/label/scan operations | exact pickup/shipment allocation only | V1 shipping/manifests | shipping customers cannot be completed | P0/L if shipping launch | carrier/label business choice, document model | build or make an explicit pickup-only launch decision |
| GAP-06 | Portal | existing customer portal scope | proof/invoice/payment only | V1 portal orders/quotes/docs/profile | customers lose portal functions | P0/L unless explicit portal-off launch | scoped portal DTOs, upload policy | decide scope; then build canonical portal surfaces |
| GAP-07 | Workflow | direct-production/no-production policy | model foundation only | V1 rigid flow is unsuitable | work is forced or bypasses are unsafe | P0/M-L | authorization, Product/Order policy, frozen routes, finance closure | define configurable policy before station repair |
| GAP-08 | Proofing | visual review/revision handoff | immutable proof core exists, visual artifact flow partial | V1 proof UI | slower/unsafe proof revision handling | P1/M | artwork preview/access, portal readiness | complete without weakening immutable evidence |
| GAP-09 | CRM | customer activity/comms read model | CRUD only | V1 customer/contact tabs | account service workflow reduced | P1/M | canonical sales/finance/comms reads | add read-only linked history |
| GAP-10 | Shell | dashboard/search/notifications | bounded dashboard; search disabled | V1 top bar/dashboard | reduced operator discovery | P1/M | canonical cross-entity read model | build after core operations |
| GAP-11 | Product | live edit/publish validation | source-correct, not live-proven | V1 product admin | M7.5B remains unproven live | P1/S | authenticated DEV | validate representative products; no redesign |
| GAP-12 | Providers | production OAuth/webhooks/workers | source architecture exists | V1 live provider authority | integrations cannot be released safely | P1/S-M | post-cutover credentials/topology/gate | validate after approved deployment control |
| GAP-13 | Navigation | separate station/admin discoverability | core modules linked; label-only entries omitted | V1 broad sidebar | hidden/absent capability ambiguity | P1/S | resolved module ownership | link only completed modules |
| GAP-14 | AI | assistant/automation | missing by design | V1 assistant | not a safe V2 feature | FUTURE/L | stable canonical operations, tenant/auth/audit design | dedicated post-parity milestone |

No gap authorizes implementation in M7.5C.
