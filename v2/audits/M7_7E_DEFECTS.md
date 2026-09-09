# M7.7E-B defect ledger

| ID | Severity | Finding | Resolution | Revalidation |
| --- | --- | --- | --- | --- |
| M77E-01 | P1 | `service_fee` publication rejected the canonical `meta.general.workflowIntent` plus `meta.pricingFormulaVariables.flatFee` shape, despite the Builder supporting that shape. | `fd0b20d7` recognizes the canonical flat-fee evidence and adds focused validator coverage. | QA Product published successfully. |
| M77E-02 | P2 | Active service-fee products were shown as `Not configured` in the Product Workspace even when canonical pricing existed. | `433afc01` projects `Flat fee` from canonical workflow metadata. | QA staff UI shows `Flat fee`. |
| M77E-03 | P1 | Shipment container create and ship accepted `businessRequestId` at HTTP level but did not reserve it. A create retry could add a second container; a changed ship retry could alter carrier metadata. | `1ab063d2` uses `v2_operation_requests`, canonical payload fingerprints, durable replay, and changed-payload conflicts. | New focused idempotency test passes; normal DEV deployment succeeded. |

No defect was fixed by changing business policy, tenant scope, or provider configuration.
