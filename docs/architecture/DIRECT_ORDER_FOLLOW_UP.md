# Staff direct Order follow-up

The staff `POST /api/orders` route commits the Order, its lines, applicable legacy jobs, and the linked billed Invoice through the existing Orders repository and Billing service. The route waits for the canonical and route-level creation audits and any proof-override audits before starting follow-up.

Follow-up runs inside the same request replay callback. It synchronizes proof once per saved line, promotes staged artwork by submitted line index with the existing attachment helper, then routes eligible lines when requested or configured. Proof rejection is logged per line. Artwork failures return warnings and later uploads continue. An exception from the routing transaction becomes a structured result on the successful create response. The original attachment, thumbnail, proof, and routing services still carry out their respective work.

## Existing failure paths

- An awaited audit can reject after the Order and Invoice commit. This can return a create error and discard the replay entry. Retrying may create a second Order. The fault-injection tests characterize the split commit and response for this refactor. Duplicate creation is an open recovery issue.
- Request replay is process-local with a two-minute window. Cross-process and restart recovery remain separate work.
- Storage cleanup may attempt object deletion after the file relationship commits. This risk remains in the existing Storage service.
- The staff editor can show generic success when the API reports artwork or routing warnings. The saved Order's explicit routing action remains available.

The isolated HTTP tests exercise the production route registration and use fixture dependencies. The disposable PostgreSQL tests use the same registration and verify actual rollback and fresh readback of the commercial and file relationships on the repository-owned loopback cluster. Optional derivatives are stubbed in the database suite.
