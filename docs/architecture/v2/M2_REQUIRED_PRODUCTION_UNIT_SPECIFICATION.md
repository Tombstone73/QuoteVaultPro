# M2.2.1 — Required Production Unit Specification

## Ownership and model

Products/PBV2 owns the rule that resolves logical production outputs for a configured product. Sales freezes the resolved result with its Quote and Order line configuration. Artwork supplies explicit production usages; Prepress executes those usages; Routing owns route position; Production remains deferred.

The typed output is a `ProductionUnitRequirement`:

- stable `key` (`^[a-z][a-z0-9_.:-]*$`);
- optional `front`/`back` side;
- optional exact source page index;
- optional paired layer key and non-negative layer order.

There is no `both` requirement. A double-sided configuration resolves distinct Front and Back requirements even when one ArtworkFile is assigned to both usages. File page count never creates requirements by itself.

## PBV2 derivation

An active PBV2 tree may contain `meta.productionUnitSpecification`:

```json
{
  "schemaVersion": 1,
  "rules": [
    { "key": "front", "side": "front" },
    { "key": "back", "side": "back", "when": { "selectionKey": "print_sides", "equals": "double_sided" } }
  ]
}
```

The pure resolver evaluates these rules against effective PBV2 selections. It is independent of Artwork, Prepress, Routing, and UI state. Product capability is therefore distinct from configured requirement: a product may support double-sided printing while a single-sided configured line resolves only Front.

Missing specification produces the explicit state `unconfigured`, never an empty configured set. A configured empty rule set remains a real zero-output result. The frozen fingerprint covers both the source specification and the **effective resolved units**, so a single-to-double selection change replaces frozen evidence even when the Product specification is unchanged.

## Sales freeze and conversion

The resolved configuration carries `productionRequirements`. `v2_sales_document_lines` mirrors its state and frozen fingerprint, while `v2_sales_line_production_requirements` stores typed/queryable rows keyed by tenant, line, and stable requirement key.

Quote checkpoints already capture complete line configurations. Quote-to-Order conversion copies those accepted line snapshots byte-for-byte; Order persistence synchronizes requirements from that frozen configuration rather than reading the current Product/PBV2 tree. A later Product change cannot rewrite prior Quote or Order requirements.

Existing historical lines are additive-safe: migration 0202 marks them `unconfigured` and creates no guessed requirements.

## Edit and history safety

Before downstream operational history, a Draft line can explicitly resolve a new configured result and atomically replace its rows. PostgreSQL blocks requirement-row changes once the line has Artwork, Prepress, or a frozen Route Instance. This preserves operational history instead of attempting to rewrite it. Existing M1 revision and Billing synchronization transactions continue to own the surrounding commercial edit.

## Artwork and Prepress coverage

Coverage is a bounded derived projection per OrderLine. A requirement matches only a same-tenant `production` Artwork assignment with exact side/page/layer values. Customer-supplied/reference/proof usages do not match.

For every configured requirement, the projection returns matching Artwork assignments, any Prepress units, and completion. It derives:

- `productionArtworkComplete`: every required unit has matching production Artwork;
- `allRequiredPrepressUnitsComplete`: every required unit has matching completed Prepress evidence.

No missing or aggregate boolean is persisted. Extra non-required Artwork does not invalidate the aggregate. Front can remain complete while Back is missing or incomplete.

## Routing seam

M2.2.1 does not mutate Routing. The future Routing-owned coarse-step operation can consume `allRequiredPrepressUnitsComplete`; Production can later consume individual completed units according to its own policy. Prepress holds no route state.

## Physical integrity

Migration `0202_v2_required_production_unit_specification` adds:

- explicit configured/unconfigured state on Sales lines;
- a requirement-set fingerprint for configured lines;
- a frozen requirement count with deferred PostgreSQL verification against child rows;
- tenant-safe typed requirement rows;
- unique requirement identity per OrderLine;
- side/page/layer checks;
- operational-history trigger preventing replacement after Artwork, Prepress, or Route Instance history.

Raw SQL is used only for the history trigger because the protection spans several owner tables.

## UI implications

The Lovable labels “Needs Production Art,” “Missing Back,” and “Ready for Prepress” can now be derived only for `configured` lines. “Production Ready” remains a future Routing/Production projection. M2.2.1 makes no UI changes.

## Deferred

- PBV2/Product Builder authoring UI for `productionUnitSpecification`;
- Prepress UI/API wiring;
- Routing advance/completion operation;
- Production eligibility/execution;
- richer logical-page and layer authoring patterns.
