# 📚 TitanOS Documentation Hub

Welcome to the TitanOS / QuoteVaultPro documentation directory.  
This folder contains the **core architectural, development, and module-level documents** that guide the entire system.

This README is your entry point.

---

# 🔷 What TitanOS Is

TitanOS is a full-stack, multi-tenant ERP/MIS/CRM system built for the print industry, supporting:

- CRM & customer management  
- Product catalog & pricing engine  
- Quotes & order workflows  
- Jobs & production  
- Inventory & materials  
- Vendors & purchase orders  
- Invoicing & payments  
- Fulfillment & shipping  
- Customer portal  
- Automation (AI-driven parsing, file routing, thumbnails, etc.)  

The system follows the principles of the **Titan Kernel Architecture**, ensuring:

- Predictability  
- Stability  
- Correct module sequencing  
- Multi-tenant safety  
- Copilot-friendly workflows  
- Long-term maintainability  

---

# 🔷 Directory Structure

```
/docs
├── ARCHITECTURE.md
├── PROMPTS_KERNEL_STYLE.md
├── MODULE_DEPENDENCIES.md
├── DEVELOPMENT_FLOW.md
├── modules/
│   ├── vendors_purchase_orders.md
│   ├── invoicing_payments.md
│   ├── inventory_management.md
│   ├── quotes_orders.md
│   ├── jobs_production.md
│   ├── fulfillment_shipping.md
│   ├── customer_portal.md
│   └── crm_customers.md
└── future/
    ├── SaaS.md
    ├── Automation.md
    └── PricingEngine.md
```

---

# 🔷 Core Documentation Files

### 📘 **ARCHITECTURE.md**
Master blueprint for TitanOS. Defines system layers, multi‑tenancy, RBAC, data models, cross‑module dependencies, backend/frontend rules, and invariants.

---

### 🧠 **PROMPTS_KERNEL_STYLE.md**
How we talk to Copilot. Ensures prompt discipline, intentional changes, architectural consistency, and predictable output.

---

### 🔗 **MODULE_DEPENDENCIES.md**
A full dependency graph explaining correct build sequencing, upstream requirements, and safe development order.

---

### 🧭 **production-routing-contract.md**
Compact API contract for production routing diagnostics (`lineItemDiagnostics`) across schedule and production jobs DTOs.

---

### 🛠️ **DEVELOPMENT_FLOW.md**
Official workflow for Batman → ChatGPT → Copilot development loop.

---

### 🔀 **GIT_WORKFLOW.md**
Comprehensive guide for git operations, branching strategy, and merging changes into the default branch via Pull Requests.

---

# 🔷 Module-Level Documentation

Documents live in `/docs/modules` and include data models, service logic, API routes, workflows, RBAC, gaps, and test plans.

---

# 🔷 Architecture Stack

1. Auth & multi-tenancy  
2. CRM  
3. Products & pricing  
4. Quotes  
5. Orders  
6. Jobs & production  
7. Inventory  
8. Vendors & purchase orders  
9. Invoicing & payments  
10. Fulfillment & shipping  
11. Customer portal  
12. Automation  
13. SaaS layer  

---

# 🔷 Contribution Notes

- See **[CONTRIBUTING.md](../CONTRIBUTING.md)** for how to merge changes and create Pull Requests
- See **[GIT_WORKFLOW.md](GIT_WORKFLOW.md)** for detailed git workflow and branch management
- Update all relevant docs when adding features  
- Enforce organizationId  
- Use Zod validation  
- Follow Kernel prompt discipline  
- Maintain naming conventions  
- Add critical tests  

---

# 🦇 Final Word

This documentation hub is the centralized brain of TitanOS.  
Keep it clean. Keep it consistent. Build the empire.
