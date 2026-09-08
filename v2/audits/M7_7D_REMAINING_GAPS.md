# M7.7D — current remaining gaps

| Classification | Current issue | Exact next action |
| --- | --- | --- |
| P1 | Mutation-capable Product/Order/Proof/Prepress/Flatbed/Roll/Fulfillment validation needs an isolated `TEST_DATABASE_URL` clone or a configured dedicated DEV QA provisioner and a fixture ledger. | Provide one disposable non-production clone, or enable the existing guarded DEV QA provisioner for the dedicated QA organization. |
| P1 | Inbound conversion needs a purpose-built, provider-free canonical intake fixture. | Add/review a bounded QA intake creator; do not invoke Gmail. |
| P1 | Portal order/artwork and AI exact-GO validation need dedicated scoped identities and fixtures. | Provision only through the existing DEV guard, then run the scoped mutation matrix. |
| P1 | Stripe aggregate-payment test and provider refunds remain provider-test validation work. | Use Stripe TEST configuration only; retain fail-closed production provider boundaries. |
| External M8 action | Vercel production control-plane proof, Neon recovery/restore proof, QuickBooks production OAuth, Gmail read authorization, writer-free/cutover evidence. | Complete as independently authorized M7/M8 control-plane work. |

The M7.7D service-fee physical-projection P1 is **closed in source**. Live proof awaits a dedicated service-fee QA fixture after deployment.
