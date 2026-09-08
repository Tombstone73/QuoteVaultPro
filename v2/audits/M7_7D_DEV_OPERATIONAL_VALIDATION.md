# M7.7D — DEV operational validation

## Scope and safety

Starting source was `03a8628d2a9b8a5c38d9832621610b6a74d3b49f` on `dev`. The active Railway DEV deployment at validation start was successful and served that commit. An authenticated staff session loaded the DEV Orders workboard with paging and operational projections.

No production resource was contacted or mutated. No provider write was attempted. No M7.7D business fixture was created: the deployed dedicated-QA provisioner requires explicit environment-only enablement and an expected QA organization/credentials, and no safe fixture creator for the wider Product/Order workflow matrix exists. Existing historical QA records were observed but not modified, deleted, or repurposed.

## Results

| Area | Result | Evidence / boundary |
| --- | --- | --- |
| Orders reads | PASS | Authenticated DEV Orders loaded at the expected DEV origin; M7.7C deployment was current. |
| Product Builder | SOURCE PASS; DEV mutation pending | Draft/edit/publish paths and focused contracts were traced. A named, dedicated QA Product is required for a safe live mutation. |
| Workflow actions | SOURCE PASS; DEV mutation pending | Direct Production and Production Not Required are capability-gated, idempotent, frozen-route operations. Live testing needs a purpose-built mapped QA Order. |
| Proofing / Prepress | SOURCE PASS; clone mutation suite pending | The complete browser harness is deliberately `TEST_DATABASE_URL` clone-only. |
| Flatbed / Roll / Fulfillment | SOURCE PASS; DEV mutation pending | Canonical attempt/allocation paths were traced. Service-fee projection defect was repaired; provider-free live mutations require physical QA jobs. |
| Inbound | SOURCE PASS; DEV mutation pending | Review/convert/reject/retry routes exist. No safe manually-ingested QA record was available; Gmail was not used. |
| Portal | SOURCE PASS; DEV mutation pending | Canonical portal order route derives principal scope. The existing seed is explicitly configured and not a generic fixture tool. |
| Payment / refund | SOURCE PASS; provider test pending | No Stripe live/test write was attempted. Existing test-only validation remains configuration-gated. |
| AI | SOURCE PASS; DEV write validation pending | Prepare/GO/cancel and authority re-resolution are present. A dedicated Admin QA identity and low-risk command fixture are required. |

## Safe test database

The comprehensive browser mutation harness refuses any target other than an explicitly enabled `TEST_DATABASE_URL`. No disposable clone/branch is available to this environment, and DEV was not substituted. This is correct fail-closed behavior.

## QA cleanup

No M7.7D fixture was created, so no cleanup action was performed. Historical QA data remains untouched.
