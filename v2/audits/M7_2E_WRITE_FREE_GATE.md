# M7.2E write-free cutover gate

## Gate contract (superseded by M7.2F actual-topology contract)

M7.2F narrows the executable contract to deployed authorities and records its current meaning in `M7_2F_RUNTIME_AUTHORITY_FINAL.md`. The historical M7.2E inventory is superseded; it must not be used to decide a cutover.

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
