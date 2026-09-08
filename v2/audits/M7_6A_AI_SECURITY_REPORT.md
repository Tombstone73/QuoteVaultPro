# M7.6A — AI security report

- Tenant identity is not tool input. The route obtains a verified session; the V2 issuer re-resolves staff authority for the requested organization.
- A command is checked at prepare and GO. GO reissues the staff principal and creates a narrowed `delegated_ai` principal, so a removed capability fails closed.
- Only literal `GO` is accepted; `yes`, cancellation, expiry, another proposal, and a repeated GO cannot execute a command.
- Pending commands have one active proposal per conversation/user/org, a fingerprint, expiry, compare-and-set claim, stable business request ID, and immutable audit events.
- Read ports have bounded input (maximum 50 results) and no raw SQL/global search escape hatch.
- Direct provider, financial mutation, secrets, SQL, organization destructive, infrastructure, and audit-disable names are permanently denied by registry enforcement.
- Tests use deterministic fakes and prove tenant context propagation, denied registration, exact GO, one-time execution, delegated identity, and audit output. Additional integration tests are required when concrete canonical ports are composed into runtime.
