# M2.2.5 — Prepress UI & API Integration

## Scope and authority

`reference/lovable-ui/src/routes/_shell.prepress.tsx` remains the visual and interaction reference. The running implementation is `v2/ui/src/PrepressWorkspace.tsx`; it uses the M2.UI0 shell and global appearance tokens. The reference project is comparison material only and is not a V2 runtime dependency.

The workspace is order-centric in presentation and unit-centric in execution:

```
Order -> OrderLine -> frozen required production unit -> Artwork coverage -> PrepressUnit
```

There is no order-level or line-level persisted Prepress status. The queue emits a bounded tenant-scoped read projection, grouping real OrderLines by Order in the browser. Each required Front/Back/page/layer unit remains independently selectable and independently starts/completes.

## API and React Query

Authenticated routes live under `/v2/organizations/:organizationId/prepress`:

- `GET /queue?limit=` — bounded order/line/requirement coverage projection;
- `GET /lines/:orderLineId/coverage` — exact frozen requirement coverage;
- `GET /lines/:orderLineId/units` — units for one legitimate OrderLine;
- `POST /units` — open a unit for an explicit production Artwork assignment;
- `POST /units/:id/start` and `POST /units/:id/complete` — unit-scoped mutations.

The runtime resolves a fresh Permission Set Principal per request, applies CSRF, uses the existing operation-request coordination, and remains tenant scoped. React Query keys include the opaque session scope and organization. Mutations invalidate the authoritative queue and Artwork read; there is no browser-local business state.

The visible **Start Prepress** control composes M2.2's idempotent open and start operations when the unit is not yet materialized. It starts only its selected exact requirement/assignment; it cannot start a sibling. **Complete Prepress** records immutable completion only for that unit.

## Owner projections

| Visible concern | Owner / treatment |
| --- | --- |
| Required Front/Back/page/layer and missing production art | Product/PBV2 frozen OrderLine requirements + Artwork coverage |
| Production Artwork file, filename, metadata, lineage, rendition availability | Artwork |
| Unit availability/in-progress/completion | Prepress timestamps/evidence |
| Proof gate/current coarse position | Routing projection; Prepress does not persist proof state |
| Route advance/release to Production/Production Ready | Deferred: Routing and future Production |
| Production destination/plan | Future Production; reference control is not wired |
| Material visibility | Product/Inventory read projection; not fabricated |
| Prepress notes/flags and Production alerts | Deferred until ownership/lifecycle is defined |

## UI/domain decisions

### UI / DOMAIN DECISION REQUIRED

1. **Reference “released to production” / Production Ready treatment.** It implies both a Routing transition and Production eligibility/execution. M2.2.5 can truthfully show only Prepress completion. Options: retain a future-domain inactive affordance, replace it through an approved Routing/Production composition, or redesign the status after M2.3. Recommended: retain/defer until the Routing-owned explicit transition and Production foundation exist.
2. **Reference Production Destination and compact Production Plan.** These imply a Production planning/assignment owner, which does not exist. Recommended: keep the approved panel composition but use the truthful deferred presentation until M2.3 provides a read model.
3. **Reference Material, Prepress Notes & Flags, and Production Alerts.** No authoritative material projection or durable note/alert lifecycle exists. Recommended: defer rather than create Prepress-owned mock state.
4. **Reference Upload/Replace Production Art.** A safe browser upload/adoption adapter and a multiple-candidate current-production-art policy are not supplied by this milestone. Existing Artwork assignment remains the authoritative path. Recommended: connect that approved Artwork flow only after its selection policy/placement is approved.

### UI PLACEMENT DECISION REQUIRED

None for the M2.2.5 start/complete vertical slice: the approved inspector already supplies an action location. The deferred owners above need an approved future-domain design before permanent controls are wired.

## Visual comparison

At `1440×900`, local screenshots compared `reference/lovable-ui` `/prepress` with the authenticated V2 Prepress workspace before and after unit completion. The shared shell, left order-centric queue, center Artwork/preview, right selected-unit inspector, lower compact areas, typography, surfaces, and token-driven theme treatment were exercised. Real V2 uses one clone-backed OrderLine rather than the reference’s mock six-order queue; filename/count/date differences are real-data differences. The reference’s mock Production destination/release and invented material/alert values were intentionally not copied.

## Browser and clone proof

The guarded clone browser test constructs clone-only fixture data, then uses real authenticated HTTP services for Artwork and Prepress. It proves customer-supplied-only Art does not cover a production requirement; explicit Front/Back production assignments do; each unit starts/completes independently; aggregate completion changes only after both units complete; replay returns one unit; limited authority is denied; a foreign-tenant coverage read is opaque not-found; and Routing remains unchanged by Prepress operations.

The test-only route-context setup establishes an already-active frozen `prepress` step because the explicit Proofing-to-Routing composition remains deferred. It is not a production endpoint and Prepress never writes Routing tables.
