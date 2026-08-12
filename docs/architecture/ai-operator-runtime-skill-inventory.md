# AI Operator runtime skill inventory

> Generated from `server/services/assistant/operatorSkillManifests.ts`. Skills supply bounded operating knowledge only; capability discovery and authority remain server-owned.

| Domain | Skill | Coverage | Approved sources | Minimal fallback |
|---|---|---|---|---|
| products | products.pbv2@v1 | partial | docs/knowledge/products-pbv2.md<br>docs/knowledge/materials-sell-units.md<br>docs/knowledge/production-routing.md | No |
| pricing | pricing.pbv2@v1 | partial | docs/knowledge/products-pbv2.md<br>docs/knowledge/customer-pricing-tax.md | No |
| quotes | quotes.operations@v1 | partial | docs/knowledge/quote-lifecycle.md<br>docs/knowledge/quote-to-order.md<br>docs/knowledge/parent-child-line-items.md | No |
| orders | orders.operations@v1 | partial | docs/knowledge/order-lifecycle.md<br>docs/knowledge/order-entry-to-production.md<br>docs/knowledge/parent-child-line-items.md | No |
| proofing | proofing.operations@v1 | partial | docs/knowledge/artwork-proofs-prepress.md | No |
| prepress | prepress.operations@v1 | partial | docs/knowledge/artwork-proofs-prepress.md<br>docs/knowledge/order-entry-to-production.md | No |
| production | production.operations@v1 | partial | docs/knowledge/production-routing.md<br>docs/knowledge/production-stations.md<br>docs/knowledge/order-entry-to-production.md | No |
| fulfillment | fulfillment.operations@v1 | partial | docs/knowledge/production-to-fulfillment.md<br>docs/knowledge/fulfillment-invoicing.md | No |
| invoicing | invoicing.operations@v1 | partial | docs/knowledge/fulfillment-invoicing.md<br>docs/knowledge/invoicing-payments.md | No |
| payments | payments.operations@v1 | partial | docs/knowledge/invoicing-payments.md | No |
| customers_contacts | customers.contacts@v1 | partial | docs/knowledge/customer-pricing-tax.md | No |
| materials | materials.operations@v1 | partial | docs/knowledge/materials-sell-units.md | No |
| settings_permissions | settings.permissions@v1 | partial | docs/knowledge/permissions-roles.md<br>docs/knowledge/customer-pricing-tax.md | No |
| public_research | research.public@v1 | minimal | No domain manual | Yes |
