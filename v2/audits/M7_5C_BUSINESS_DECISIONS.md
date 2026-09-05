# M7.5C business decision register

| Question | V1 behavior | Current V2 behavior | Options | Recommended default |
| --- | --- | --- | --- | --- |
| Is inbound email order intake required at launch? | V1 parses/reviews/converts inbound records | absent | rebuild V2-native; retain V1 temporarily; explicitly disable | treat as P0 unless business declares an alternate intake process |
| Which workflow paths may an operator choose? | tends to force stages | model has partial no-production foundation, no policy UI | strict normal path; authorized direct production; fulfillment-only; shop policy variants | configurable, permissioned policy with frozen Order evidence |
| Must shipping labels/tracking/carriers launch with V2? | V1 supports shipping packages/manifests | V2 supports exact shipment allocation only | build full shipping; pickup-only launch; external process | decide explicitly before cutover; P0 if shipping is used |
| What portal scope must existing customers retain? | orders, quotes, documents, proofs, invoices/profile | proofs, invoices/payment only | full parity; phased portal-off; reduced approved scope | P0 decision; never silently route old URLs to invoices |
| Is a dedicated staff traveler needed beyond V2 PDF? | dedicated traveler route | PDF exists, no dedicated traveler evidence | define required fields and add traveler; use PDF | decide from floor workflow; do not copy route by name |
| Is Customer a primary activity hub? | orders/quotes/invoices/transactions/activity tabs | CRUD/contact cards only | linked read-only canonical activity; keep minimal profile | add linked read model if staff use it operationally |
| Should V2 restore production boards/calendar/batching? | rich boards/calendar and batching concepts | queue/attempt core; calendar non-authoritative | define canonical scheduling/batching model; defer | do not restore cosmetic non-authoritative board |
| When should AI return? | broad assistant/parsing/automation | deliberately absent | rebuild after operations; retain V1; disable | dedicated future V2 AI milestone after canonical workflows stabilize |

Every decision changes data/API/permission scope; none is resolved by this audit.
