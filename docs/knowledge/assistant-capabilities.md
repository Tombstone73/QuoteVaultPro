---
slug: assistant-capabilities
title: Assistant capabilities and confirmations
category: ai-assistant
version: 2026-08-12
status: active
audience: staff
summary: What the assistant can explain, read, and propose.
route_patterns: [/settings/ai]
feature_tags: [assistant]
---
# Assistant capabilities and confirmations

The assistant provides System Guide explanations, current-screen help, approved read-only record context, and a reviewed set of confirmation-gated commands. These include bounded Product, Quote, Order, Customer/Contact, Production, Fulfillment, Invoice, and manual-payment operations.

Mutation commands prepare a persisted proposal and require the dedicated GO control. Free-text GO never executes a command. Execution revalidates the server-owned actor, tenant, required grant, current record state, proposal fingerprint, and idempotency key before invoking the same canonical business operation used by the reviewed UI path.

Skills explain source-backed workflow. They do not grant capabilities or authority. Owner or Developer login cannot elevate AI beyond the Admin-eligible tenant ceiling. Organization destruction, ownership transfer, infrastructure/developer operations, arbitrary SQL or API execution, cross-tenant mutation, processor refunds, and other hard-denied capabilities remain unavailable.
