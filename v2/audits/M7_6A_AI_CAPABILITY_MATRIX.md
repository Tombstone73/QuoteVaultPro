# M7.6A — AI capability matrix

| Domain | Operation | User capability | AI read | AI write | GO | Status | Canonical service |
|---|---|---|---|---|---|---|---|
| Customers | search/contact summaries | `customer.view` | Yes | — | — | LIVE_READ | Customer workspace reader |
| Customers | create/add contact | `customer.edit` | — | No | n/a | BLOCKED_IDEMPOTENCY | Canonical customer/contact services lack the required business-request seam |
| Products | search/configuration | `product.view` | Yes | — | — | LIVE_READ | Product reader |
| Pricing | customer/Product preview only | `pricing.preview` | Yes | — | — | LIVE_READ | Typed canonical Product resolution plus customer-commercial pricing adapter |
| Quotes | search/status | `quote.view` | Yes | — | — | LIVE_READ | Sales workspace reader |
| Orders | search/details | `order.view` | Yes | — | — | LIVE_READ | Order workspace reader |
| Orders | create/header/note | `order.create` / `order.edit` | — | No | n/a | NOT_COMPOSED | Safe canonical command adapters pending proof of idempotency |
| Workflow | mark Production Not Required | `workflow.override` | Via order read | Yes | Yes | LIVE_WRITE_WITH_GO | Canonical workflow service with request reservation and current-state revalidation |
| Workflow | prepress/direct-production/other changes | V2 policy capability | Contract only | No | n/a | NOT_COMPOSED | Existing services are not exposed to the provider |
| Artwork | bounded assignment metadata | `artwork.view` | Yes | — | — | LIVE_READ | Canonical Artwork workspace read projection; object keys, checksums, and binary content are excluded |
| Proofs | bounded proof queue/status | `proof.view` | Yes | — | — | LIVE_READ | Canonical Proofing application service; recipients/comments are excluded |
| Prepress | bounded readiness/blockers | `prepress.view` | Yes | — | — | LIVE_READ | Canonical Prepress application service, including missing-art/readiness states |
| Production | bounded Flatbed/Roll queue progress | `production.view` | Yes | — | — | LIVE_READ | Canonical Production application service; physical output is not writable by AI |
| Fulfillment | remaining quantity/shipment/tracking summaries | `fulfillment.view` | Yes | — | — | LIVE_READ | Canonical read-only Fulfillment workspace projection |
| Inbound | bounded intake queue/detail summaries | `inbound.view` | Yes | Yes: mark duplicate | Yes | LIVE_READ_AND_NARROW_WRITE | Canonical Inbound service; conversion/review remain withheld pending multi-capability delegation |
| Customer activity | timeline entries | `customer.view` | Yes | — | — | LIVE_READ | Exact customer-ID, bounded canonical Customer workspace activity projection |
| Finance | invoice balances; payment/refund history | `payment.view` | Yes | — | — | LIVE_READ | Canonical financial read service; no finance mutation is registered |
| Finance/provider mutation | charge/refund/provider call | n/a | — | No | n/a | PERMANENTLY_DENIED | n/a |
| Organization/infrastructure/secrets/SQL | destructive/internal | n/a | No | No | n/a | PERMANENTLY_DENIED | n/a |

`assistant.use` is additionally required for every assistant route and tool. Finance/provider mutation, fulfillment write, proof delivery, customer creation, and all other operations remain unsupported until their canonical idempotency/outbox contracts can be bound safely.
