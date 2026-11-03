# Customer portal shipment tracking (DEV)

## Existing integration and shipped code

The existing UPS integration owns tenant OAuth/account authorization, rates,
address verification, label purchase/recovery/void, and package-to-label mapping.
Shipments, shipment Orders/items/packages, and UPS label history remain canonical.
There was no tracking API client, carrier webhook handler, event store, or status
synchronizer. The portal previously projected one tracking number and no URL.
FedEx, USPS and DHL existed as carrier names/links, without tracking credentials
or API adapters in this repository. Stripe webhooks are payment-specific and are
not reused for carrier events.

The Orders list, Order Detail header and Fulfillment Summary now share a tracking
component with trusted HTTPS links, copy controls, per-package carrier labels,
last event/check times, carrier estimates, confirmed delivery and unavailable
states. True legacy Order-level numbers are retained without guessing a carrier.
Voided shipments, sandbox/uncertain/voided UPS purchases and unmapped labels do not
become active tracking. Combined shipments expose only the Order's mapped UPS
packages. No label bytes, recipient addresses or internal notes enter the DTO.

Migration `0247_shipment_tracking_observations` is additive. It adds cached carrier
observations and append-only normalized events, with composite tenant/shipment
foreign keys and idempotency indexes. It never changes shipment/order ownership,
internal fulfillment status, completion, delivered_at, pricing, proof or artwork.
The legacy `carrier_last_status` field is not treated as confirmed delivery.

## Live status and activation prerequisites

UPS polling uses the existing encrypted tenant authorization and documented
[Tracking API](https://github.com/UPS-API/api-documentation/blob/main/Tracking-Ready.yaml).
The application's UPS Tracking API entitlement must be confirmed independently of
its successful Rating/Shipping access. Sandbox responses cannot produce customer
delivery confirmations. No live provider call was made during implementation.

Automatic polling is **off by default**, including production-mode DEV servers.
An administrator must deliberately configure all of:

- Existing UPS production app/account authorization (`UPS_ENVIRONMENT=production`).
- UPS Tracking API entitlement for that app.
- `WORKER_SHIPMENT_TRACKING_ENABLED=true`.
- `SHIPMENT_TRACKING_ORGANIZATION_IDS` containing explicitly approved tenant IDs.
- Existing global worker gate permitting work (`WORKERS_ENABLED=false` overrides).

This release does not change environment variables or enable mailbox workers.
Polling runs a bounded batch once per minute, seeds up to 100 recent UPS shipments
per tenant, and checks at most ten due packages per tenant. Each package is cached
for 30 minutes; failures back off to 24 hours. Tracking stops after confirmed
delivery or the 90-day polling window. Expired claims recover after one minute;
late responses cannot overwrite a newer claim. A tracking-identity replacement or
void fences publication. Old observations/history are retained. Delivered is
terminal for this projection; carrier corrections/returns after delivery require a
separately reviewed policy, not a silent regression.

Portal pages refresh cached UPS observations every two minutes while visible and
on window focus. Customer reads never issue carrier requests. Failed checks keep
the last confirmed observation, explain unavailable updates, and never infer a
delivery date from the internal Shipped state. Dates without a trustworthy carrier
timestamp are not fabricated into events. Carrier responses with suppressed
details are not published. Full carrier payloads/signatures/POD are not retained.

## Other carriers, webhooks and costs

FedEx/USPS/DHL tracking numbers remain visible, copyable and linked to trusted
carrier pages. Their live status is explicitly unavailable until an authorized
adapter/account is configured; the shared carrier-event contract supports those
future adapters. No new shipping/tracking provider, dependency or subscription is
introduced.

UPS Track Alert supports push subscriptions but needs separate onboarding and
[webhook credential management](https://github.com/UPS-API/api-documentation/blob/main/UPSTrackAlert-Ready.yaml).
There is deliberately no speculative public webhook endpoint or subscription.
Only the authenticated outbound UPS adapter can populate the current polling
path. A future webhook must verify the carrier's actual authentication contract
before calling the same ingestion service; a tracking number is not authorization.

Expected external cost: no new paid service is activated. UPS's published
[2026 service guide](https://assets.ups.com/adobe/assets/urn%3Aaaid%3Aaem%3A4e276319-a380-4918-946f-977141becaf1/original/as/preview-service-guide-base-gb-en.pdf)
lists the basic Tracking API as free; tenant/app entitlement and current US terms
still require verification. FedEx documents free
[Basic Integrated Visibility](https://www.fedex.com/en-us/digital/premium-features/integrated-visibility.html);
its advanced webhooks are subscription-based. USPS
[API access](https://www.usps.com/business/api-access.htm) depends on shipper/Mailer
ID authorization; service-provider data access can require a monthly fee and IP
agreement. No numeric quote is established for optional webhook subscriptions or
USPS service-provider access, and none is authorized/activated by this release.

## Validation and acceptance boundaries

Focused unit/component tests cover trusted URLs, missing/unknown tracking,
package matching, status mapping, no fabricated timestamps, copy success/failure,
legacy DTOs and distinct exception/delivery labels. Disposable PostgreSQL tests
exercise the actual canonical migration stream, portal list/detail projection,
independent readback, duplicate/out-of-order events, carrier outages, late workers,
replacement/void, tenant/customer isolation, multiple packages/shipments and UPS
test/void history. Provider responses are controlled fixtures, not live UPS data.

`node e2e/local-portal-tracking/verify.mjs` renders the actual portal pages with
synthetic read-only API responses in Chrome at scale 1, 1440/390 px and both themes.
It verifies header visibility, links, focus, wrapping and absence of horizontal
overflow. Screenshots are under `node_modules/.cache/portal-tracking/`.
Browser persistence is mocked; PostgreSQL persistence is tested separately.

Release checks: 19 focused server tests, 12 portal component regressions, and nine
real PostgreSQL integration tests passed. Scoped TypeScript uses an 8192 MB heap;
the production build packages all 241 migrations through 0247. Two additional
legacy portal boundary assertions still fail on unchanged baseline source: one
expects the former Stripe confirmation implementation, and the other forbids the
already-supported portal product endpoint. Neither payment nor storefront logic
is changed or claimed repaired by this feature.

Outstanding DEV acceptance: automatic migration on the deployed DEV database,
real authenticated customer scope, deployed storage compatibility, UPS entitlement
and successful production-mode Tracking API response, optional operator-approved
worker activation, and real carrier scan/estimate/delivery readback. MAIN is not
part of this release. Do not treat a successful Git push as deployment completion.
