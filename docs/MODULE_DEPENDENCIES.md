# TitanOS Module Dependencies

> Map of how modules depend on each other. Use this when sequencing features and refactors.

Status legend:
- ✅ baseline implemented
- 🟡 partially implemented / needs extension
- 🔴 not implemented yet

---

## 1. Dependency Table

| Module                     | Depends On                                      | Used By                                          | Status |
|----------------------------|-------------------------------------------------|--------------------------------------------------|--------|
| Auth & Multi-tenancy       | (core infra)                                    | ALL                                              | 🟡     |
| CRM (Customers/Contacts)   | Auth, Multi-tenancy                             | Quotes, Orders, Invoices, Portal, Credit         | ✅     |
| Product Catalog & Pricing  | CRM (sometimes), Materials (sometimes)         | Quotes, Orders                                   | 🟡     |
| Quotes                     | CRM, Products                                   | Orders, Portal                                   | ✅     |
| Orders                     | CRM, Products, Quotes                           | Jobs, Inventory, Invoices, Shipments, Portal     | ✅     |
| Jobs & Production          | Orders, Order Line Items, Job Status Config    | Inventory, Dashboards                            | ✅     |
| Inventory                  | Materials, Orders, Jobs, Purchase Orders       | POs, Production Planning, Reporting              | ✅     |
| Vendors & Purchase Orders  | Vendors, Materials, Inventory                   | Inventory, Costing                               | ✅     |
| Invoices & Payments        | Orders, CRM                                    | Accounting Sync, Portal (future)                 | ✅     |
| Fulfillment & Shipping     | Orders, Shipments                              | Portal, Customer Communication                   | ✅     |
| Customer Portal            | CRM, Quotes, Orders, Fulfillment               | Customer Self-Service                            | 🟡     |
| Automation (Email, PDFs)   | Orders, Products, CRM, Files                   | Pre-order entry, routing, thumbnails, parsing    | 🟡     |
| SaaS Layer (Tenant Mgmt)   | Auth, Multi-tenancy                            | All                                              | 🔴     |

---

## 2. Layered Build Order

> We should not build/enhance modules out of order when they introduce new dependencies.

1. **Layer 0** – Auth, multi-tenancy, global config
2. **Layer 1** – CRM
3. **Layer 2** – Product Catalog + Pricing Engine
4. **Layer 3** – Quotes
5. **Layer 4** – Orders
6. **Layer 5** – Jobs & Production
7. **Layer 6** – Inventory
8. **Layer 7** – Vendors & Purchase Orders
9. **Layer 8** – Invoices & Payments
10. **Layer 9** – Fulfillment & Shipping
11. **Layer 10** – Customer Portal
12. **Layer 11** – Automation & AI
13. **Layer 12** – SaaS, Tenant Management UI, Billing

---

## 3. Rules for Adding New Features

When adding a feature:

1. Identify which module it belongs to.
2. Confirm all modules it depends on are "ready" enough.
3. Update this dependency map if new cross-links are created.
4. If a feature cuts across modules (e.g., "time tracking per job with impact on costing"), make a small RFC note before implementing.

---

## 4. Examples

- **Feature:** "Job time tracking + labor cost per job"  
  - Module: Jobs & Production  
  - Depends on: Orders, Job statuses, possibly Inventory (for materials vs labor costing).  
  - Affects: Reporting, future accounting integration.

- **Feature:** "Customer can pay invoices via portal"  
  - Module: Portal + Invoicing  
  - Depends on: Invoices & Payments being stable, Portal auth.  
  - Affects: Accounting Sync, credit balances.

---
