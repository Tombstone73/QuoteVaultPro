# M1.8 — Routing Identity

## Status and scope

M1.8 establishes the durable Routing identity foundation required by M1.9. It creates no Order writer, Draft Invoice writer, Routing HTTP API, route UI, Production job, Artwork/Proof flow, Prepress work, Fulfillment action, external handoff, or route transition engine.

Routing owns **internal PrintersHero work movement**. It does not own commercial state, Artwork, Prepress results, Production execution, Inventory, Fulfillment handoff, Shipping, or Integrations. Those modules report their own facts to a future named Routing operation; Routing then validates and changes only route position.

## Route templates

`v2_route_templates` is an organization-owned template family with an active flag, revision, and definition fingerprint. Ordered `v2_route_template_steps` define only the coarse initial destinations:

- `proofing`
- `prepress`
- `production`
- `fulfillment`

This is deliberately not a BPMN/workflow engine, station model, or machine assignment system. A one-step `fulfillment` template is valid for static/resale work. The conceptual Printed template is Proofing → Prepress → Production → Fulfillment. Service/fee work normally has no template or route.

Templates are organization-owned rather than globally mutable system records. Canonical Printed and Static/Resale definitions are future provisioning/catalog presets, not hard-coded display names or M1.8 seed rows. A template update increments its revision and changes future instantiation only.

## Products boundary

Products owns Product Type route-selection policy, stored directly on `product_types`:

- `route_required` + an organization-scoped `default_route_template_id`
- `no_route`
- `unconfigured`

Routing owns the referenced template. The compatibility read returns a typed policy; it does not use V1 `default_station_key`, `default_step_key`, Product Type names, `send_to_production_default`, prepress flags, or PBV2 routing metadata. Existing Product Types are deliberately `unconfigured`, so M1.9 must fail closed for a routable line until Products has explicitly supplied final routing configuration. `no_route` is an intentional absence, not a dummy Route Instance.

## Route instances and frozen steps

A `RouteInstance` is one frozen internal route for one typed `SalesOrderLineWorkReference`:

```text
Order-line identity → selected active Route Template → frozen Route Instance Steps
```

The M1.8 physical work reference is strongly typed as an organization, Order ID, and **OrderLineId**; it cannot be a Quote-line alias and cannot be omitted. M1.9 validates the real Sales Order-line ownership in its caller-owned transaction before invoking Routing. This preserves the required no-routed-job-without-an-Order-line invariant without inventing an M1.8 Order writer or fake Order records.

`v2_route_instances` stores the source template ID, revision, and fingerprint. `v2_route_instance_steps` copies the ordered kind and receives distinct durable IDs. No instance re-queries a current template for its meaning. A template changed after Route A is created can produce a different Route B, but can never reinterpret Route A.

The instance records definition-level provenance (template ID, revision, and fingerprint), not a foreign key to an individual mutable template-step row. The frozen step's durable ID, position, and kind are its own authoritative historical meaning. Template writers lock the template header and update its revision/fingerprint with ordered steps; instantiation takes a shared header/step snapshot lock and rejects a retry that resolves to a different revision or fingerprint.

## Current position and deferred transitions

An instance is `pending`, `active`, or `completed`. Pending/active routes hold a durable `current_step_id`; completed routes hold none. A composite foreign key requires that pointer to belong to the same Route Instance. M1.8 creates pending routes at their first frozen step; it does not start, complete, skip, reroute, or cancel them.

Future public operations are named and expected-state validated: `route.start`, `route.completeCurrentStep`, `route.advance`, `route.reroute`, and `route.cancel`. There will be no generic `setRouteStatus` or caller-selected `moveToStep`. Artwork owns proof truth, Prepress owns preparation result, Production owns execution facts, and Fulfillment owns handoff facts; none may directly mutate route position.

## Integrity, tenancy, and transactions

Templates, steps, instances, and instance steps are organization scoped. Composite foreign keys protect template/step and instance/current-step membership. Unique positions protect ordered definitions. `UNIQUE (organization_id, work_kind, order_line_id)` physically enforces at most one Route Instance for the same future routable Order line.

M1.8 deliberately does not add a cross-module foreign key to a Sales Order line: M1.9 is the first Order writer and must validate the actual scoped Order-line reference before calling this transaction-participating Routing primitive. The rehearsal therefore uses strongly typed Order/Order-line fixture identities rather than inventing V2 Orders in the Routing milestone. Routing itself rejects a mismatched work organization or foreign template before persistence.

`PostgresRoutingRepository` accepts a caller-owned transactional client and never starts or commits a transaction. Its conflict-safe instance insert converges concurrent equivalent creation onto the existing scoped Route Instance. This lets M1.9 atomically coordinate Sales Order + Billing Draft Invoice + Routing instances + Audit/outbox through named module ports, without cross-module table writes or a Routing-specific outbox.

Meaningful future route operations will write the established M0 Audit stream. M1.8 fixture/template primitives do not emit business Audit noise.

## M1.9 expectations

For each real Order line, M1.9 resolves the Product Type policy through Products:

- `no_route`: create no Routing record.
- `route_required`: validate the actual Order-line/org ownership, then instantiate the selected active template inside the Order transaction.
- `unconfigured`: fail closed with an actionable commercial conflict.

M1.9 must not select a station, infer a template from V1/PBV2 fields, write Routing tables directly, or create a Production job. It receives durable Route Instance and Route Instance Step IDs for later Artwork, Prepress, Production, and Fulfillment milestones.
