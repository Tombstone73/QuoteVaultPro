# M7.2E write-free cutover gate

## Gate contract

`v2/src/modules/cutover/writeFreeRuntimeGate.ts` implements a fail-closed assertion over a sanitized, read-only evidence manifest. It requires fresh evidence (five-minute default) for every authority:

`v1-http-mutation-ingress`, `v1-background-workers`, `v1-standalone-prepress`, `v1-migration-runner`, `stripe-webhook-application`, `quickbooks-workers`, `email-delivery-workers`, `financial-outbox-consumer`, `mcp-production`, `mcp-development`, `v2-writers`, and `reconciliation-executor`.

Each observation must say the process is `stopped` or `not_deployed`, admission is `closed` or `not_applicable`, mutation capability is exactly `false`, and include a non-secret evidence reference. Required sources are Railway read-only inventory for deployed-process authorities, database read-only evidence for migration/executor, an HTTP maintenance probe for V1 ingress, provider-console read-only evidence for Stripe retry policy, and MCP-registry read-only evidence for both MCP endpoints.

Run it only against a sanitized JSON array:

```text
M72E_EVIDENCE_FILE=<sanitized-manifest.json> npm run v2:m7_2e:write-free-gate
```

The command prints only PASS or authority failures; it never connects to production, stops a process, or prints evidence references. It rejects missing, duplicate, stale, malformed, open, running, mutable, or unknown authority observations.

## PASS conditions

1. Authenticated read-only Railway evidence identifies every service, replica, worker, scheduler, and start command, and confirms V1/V2 writer processes stopped.
2. A non-mutating edge probe confirms staff, portal/token, assistant, provider-mutation and webhook-application paths reject at maintenance boundary.
3. Read-only database checks find no automatic migration runner and no conflicting reconciliation executor.
4. Standalone prepress has a successful bounded-drain exit proof (or is proven absent).
5. Stripe, QuickBooks, email/outbox, and both MCP endpoints have the prescribed evidence and no remaining mutation capability.

## FAIL conditions and manual evidence

Any absent control-plane integration fails this gate; an operator assertion alone cannot pass it. Where an API cannot supply a fact, attach a timestamped, sanitized read-only console/export reference to the manifest and make it reviewable. Railway read-only inventory is available, but the current live V1 replica and asset-preview writer mean the gate must fail now. Vercel and MCP read-only authority remains required before an eventual PASS.
