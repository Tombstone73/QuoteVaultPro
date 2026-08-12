# AI Operator Index

> Generated from `server/services/assistant/operatorIndex.ts`. It selects domain metadata for bounded, manifest-approved operating knowledge. It never grants capabilities or authority.

| Domain | Skill | Related domains | Capability categories | Purpose |
|---|---|---|---|---|
| products | products.pbv2@v1 | pricing, materials, proofing, production | read, configuration, lifecycle | Product definitions, configuration, options, measurement modes, and product lifecycle. |
| pricing | pricing.pbv2@v1 | products, quotes, materials | read, pricing, configuration | PBV2 pricing, matrices, tiers, rates, and pricing change sets. |
| quotes | quotes.operations@v1 | orders, customers_contacts, pricing | read, mutation | Quote drafting, editing, conversion, and internal quote notes. |
| orders | orders.operations@v1 | quotes, production, fulfillment | read, mutation, lifecycle | Order creation, editable-order updates, and order lifecycle context. |
| proofing | proofing.operations@v1 | products, prepress, production | read, lifecycle | Proof requirements and proof-related operating knowledge. |
| prepress | prepress.operations@v1 | proofing, production, orders | read, lifecycle | Prepress preparation, files, and workflow context. |
| production | production.operations@v1 | orders, prepress, fulfillment | read, mutation, reporting | Production intake, queue operations, job status, and internal notes. |
| fulfillment | fulfillment.operations@v1 | orders, production, invoicing | mutation, lifecycle | Shipments, pickup tickets, shipping status, and fulfillment notes. |
| invoicing | invoicing.operations@v1 | payments, orders, customers_contacts | mutation, reporting | Invoice creation, drafts, sending, and invoice notes. |
| payments | payments.operations@v1 | invoicing, customers_contacts | mutation, reporting | Manual payment recording and payment notes. |
| customers_contacts | customers.contacts@v1 | quotes, orders, invoicing, payments | read, mutation, reporting | Customer profiles, commercial terms, contacts, and customer analysis. |
| materials | materials.operations@v1 | products, pricing, production | read, configuration | Material selection, inventory, and supplier-related operating context. |
| settings_permissions | settings.permissions@v1 | products | read, administration | Organization settings and permission concepts; AI policy controls remain unavailable. |
| public_research | research.public@v1 | products, materials | research | Public research that remains separate from tenant business authority and persistence references. |
