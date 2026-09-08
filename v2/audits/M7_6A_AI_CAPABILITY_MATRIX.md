# M7.6A — AI capability matrix

| Domain | Operation | User capability | AI read | AI write | GO | Status | Canonical service |
|---|---|---|---|---|---|---|---|
| Customers | search/contact summaries | `customer.view` | Yes | — | — | AVAILABLE_READ | Customer workspace reader |
| Customers | create/add contact | `customer.edit` | — | Yes | Yes | AVAILABLE_WRITE_WITH_GO | Canonical customer/contact services |
| Products | search/configuration | `product.view` | Yes | — | — | AVAILABLE_READ | Product reader |
| Pricing | preview only | `product.view` | Yes | — | — | AVAILABLE_READ | Canonical pricing preview |
| Quotes | search/status | `quote.view` | Yes | — | — | AVAILABLE_READ | Sales workspace reader |
| Orders | search/details | `order.view` | Yes | — | — | AVAILABLE_READ | Order workspace reader |
| Orders | create/header/note | `order.create` / `order.edit` | — | Yes | Yes | AVAILABLE_WRITE_WITH_GO | Order application service |
| Workflow | prepress/production/no-production | V2 policy capability | Yes | Yes | Yes | AVAILABLE_WRITE_WITH_GO | Prepress/production/order policy |
| Artwork, proofs, production, fulfillment, inbound | bounded status reads | respective `.view` | Yes | — | — | AVAILABLE_READ | V2 domain readers |
| Finance | balances/payment/refund history | `invoice.view` / `payment.view` | Yes | — | — | AVAILABLE_READ | Financial read service |
| Finance/provider mutation | charge/refund/provider call | n/a | — | No | n/a | PERMANENTLY_DENIED | n/a |
| Organization/infrastructure/secrets/SQL | destructive/internal | n/a | No | No | n/a | PERMANENTLY_DENIED | n/a |

Fulfillment write, proof delivery, and all other operations remain unsupported until their canonical idempotency/outbox contracts can be bound safely.
