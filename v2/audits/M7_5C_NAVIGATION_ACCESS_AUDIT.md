# M7.5C navigation and access audit

`VisualShell.tsx` deliberately renders only items with a `page` or `href`. Therefore label-only entries are absent from the actual rendered navigation, not broken links.

| Module | V2 route/access | Finding |
| --- | --- | --- |
| Quotes, Orders, Customers, Contacts, Products, Formula Library | sidebar + App route | reachable |
| Artwork, Proofing, Prepress, Production, Routing, Fulfillment | sidebar + durable deep-link parsing | reachable; workflow completeness varies |
| Flatbed/Roll | Production station route/tab or direct `/production/flatbed|roll` | built/reachable but weak separate-station discoverability |
| Invoices, Payments | sidebar | reachable |
| Stripe, QuickBooks, Gmail, team access/permission sets/portal access | Settings internal sections, capability gated | reachable but not independent sidebar destinations |
| Inventory | direct `/inventory` href | reachable as a shell link; not audited as operational procurement parity |
| Inbound Orders, AI Assistant, Shipping, Design, Nesting, Materials, Procurement, Reports, Communications, Integrations, Bug Reports, Users & Permissions | label only; filtered out | absent/unreachable, not eligible for completion credit |
| Portal | separate `/portal` app | invoices/payment/proofs only; not V1 portal parity |

Top-bar search is visibly disabled pending a future canonical read model. The Command Center is a bounded read projection, not V1 dashboard parity. Navigation should expose completed canonical workflows only; adding links to placeholders would conceal, not close, cutover gaps.
