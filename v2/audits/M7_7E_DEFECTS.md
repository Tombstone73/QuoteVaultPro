# M7.7E-C defect ledger

| ID | Severity | Finding | Resolution | Revalidation |
| --- | --- | --- | --- | --- |
| M77E-01 | P1 | `service_fee` publication rejected the canonical `meta.general.workflowIntent` plus `meta.pricingFormulaVariables.flatFee` shape, despite the Builder supporting that shape. | `fd0b20d7` recognizes the canonical flat-fee evidence and adds focused validator coverage. | QA Product published successfully. |
| M77E-02 | P2 | Active service-fee products were shown as `Not configured` in the Product Workspace even when canonical pricing existed. | `433afc01` projects `Flat fee` from canonical workflow metadata. | QA staff UI shows `Flat fee`. |
| M77E-03 | P1 | Shipment container create and ship accepted `businessRequestId` at HTTP level but did not reserve it. A create retry could add a second container; a changed ship retry could alter carrier metadata. | `1ab063d2` uses `v2_operation_requests`, canonical payload fingerprints, durable replay, and changed-payload conflicts. | New focused idempotency test passes; normal DEV deployment succeeded. |
| M77E-04 | P1 | The operational Orders projection counted `service_fee` lines as physical Fulfillment obligations despite the canonical lifecycle excluding them. | `c8fc6f46` filters the frozen Product workflow intent from Fulfillment counts and adds a SQL projection contract. | QA service-fee Order now projects all physical obligations as not required. |
| M77E-05 | P1 | Route Template production-destination authoring audit SQL supplied eleven expressions for ten audit columns, so every destination transaction rolled back. | `26ab3dff` corrects the bind count and adds a persistence contract. | QA Flatbed and Roll destinations saved and were consumed by frozen routes. |
| M77E-06 | P1 | Prepress handoff used bare `FOR SHARE` against a query with a nullable Product Version outer join, rejected by PostgreSQL. | `97ab9a04` locks only the required Order line and adds a handoff contract. | QA handoff advanced the frozen Route, created one work item, and replayed safely. |
| M77E-07 | P1 | Direct Production used bare `FOR UPDATE` against the same nullable join and then wrote a non-array audit payload prohibited by the audit schema. | `e31a3dbc` targets the line and Order locks; `936e6114` wraps immutable changes as an audit array. | QA strict Direct Production advanced only the frozen Route, created explicit Production work, and replayed safely. |

No defect was fixed by changing business policy, tenant scope, provider configuration, or historical data.
