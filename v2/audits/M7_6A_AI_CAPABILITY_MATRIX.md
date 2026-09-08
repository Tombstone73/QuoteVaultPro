# M7.6A — AI capability matrix

| Domain | Operation | User capability | AI read | AI write | GO | Status | Canonical service |
|---|---|---|---|---|---|---|---|
| Customers | search/contact summaries | `customer.view` | Yes | — | — | LIVE_READ | Customer workspace reader |
| Customers | create/add contact | `customer.edit` | — | No | n/a | BLOCKED_IDEMPOTENCY | Canonical customer/contact services lack the required business-request seam |
| Products | search/configuration | `product.view` | Yes | — | — | LIVE_READ | Product reader |
| Pricing | preview only | `pricing.preview` | Contract only | — | — | NOT_COMPOSED | Canonical pricing adapter still needs its typed AI input contract |
| Quotes | search/status | `quote.view` | Yes | — | — | LIVE_READ | Sales workspace reader |
| Orders | search/details | `order.view` | Yes | — | — | LIVE_READ | Order workspace reader |
| Orders | create/header/note | `order.create` / `order.edit` | — | No | n/a | NOT_COMPOSED | Safe canonical command adapters pending proof of idempotency |
| Workflow | mark Production Not Required | `workflow.override` | Via order read | Yes | Yes | LIVE_WRITE_WITH_GO | Canonical workflow service with request reservation and current-state revalidation |
| Workflow | prepress/direct-production/other changes | V2 policy capability | Contract only | No | n/a | NOT_COMPOSED | Existing services are not exposed to the provider |
| Artwork, proofs, production, fulfillment, inbound | bounded status reads | respective `.view` | Contract only | — | — | NOT_COMPOSED | No raw database fallback is registered |
| Finance | balances/payment/refund history | `invoice.view` / `payment.view` | Contract only | — | — | NOT_COMPOSED | Financial read service requires a shaped safe adapter |
| Finance/provider mutation | charge/refund/provider call | n/a | — | No | n/a | PERMANENTLY_DENIED | n/a |
| Organization/infrastructure/secrets/SQL | destructive/internal | n/a | No | No | n/a | PERMANENTLY_DENIED | n/a |

`assistant.use` is additionally required for every assistant route and tool. Fulfillment write, proof delivery, and all other operations remain unsupported until their canonical idempotency/outbox contracts can be bound safely.
