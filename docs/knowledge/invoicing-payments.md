---
slug: invoicing-payments
title: Invoicing and payments
category: payments
version: 2026-08-12
status: active
audience: staff
summary: Invoice and payment concepts.
route_patterns: [/invoices]
entity_types: [invoice]
feature_tags: [payments]
---
# Invoicing and payments

An invoice draft is created from an eligible Order and snapshots the Order number, customer ownership, line descriptions, quantities, pricing, options, tax, shipping, and totals. Normal manual invoice creation allows one active manual invoice for an Order; milestone billing automation remains a separate policy and may coexist with a manual invoice.

Draft invoice details may be edited while the invoice is editable. Finalizing the draft changes its financial lifecycle and marks the linked Order billed. Marking an invoice sent is a status marker; the reviewed Assistant command does not email the customer. Actual email delivery, reminders, QuickBooks synchronization, and broad Invoice Editor actions remain separate UI workflows.

Manual payments use integer cents and apply to exactly one tenant-owned payable invoice. The shared operation locks the invoice, revalidates its current status and Order, rejects overpayment, and uses an idempotency key so retry cannot duplicate the financial effect. Draft, void, paid, canceled-Order, and imported QuickBooks invoices cannot receive this internal manual-payment operation. Partial and full payments use the same authoritative rollup.

Refunds are not a reviewed Assistant capability. Disabled processor follow-on routes do not become available through a skill or GO.
