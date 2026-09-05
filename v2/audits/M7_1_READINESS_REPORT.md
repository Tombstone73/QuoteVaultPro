# M7.1 read-only cutover baseline readiness report

## Disposition: BLOCKED

M7.1 source and writer discovery is meaningful, but the production database
baseline cannot begin without positive target identity and a separately
authorized read-only production connection.  This is not an M7 GO/NO-GO.

## Findings

- **P0 — dedicated audit role credential unavailable.** The production target
  and restricted role are now proven through Railway and PostgreSQL catalog
  evidence, but the role's generated password could not be safely retained by
  the local execution context.  A database administrator must reset/deliver it
  out of band before the role can be connection-tested or used for inventory.
- **P1 — live production service is confirmed V1.** Railway identifies one
  V1 production service from `main` at `1326ad1b…`, but worker-gate values and
  actual process topology remain unread for safety.
- **P1 — V1 retained writers can collide with V2.** V1 starts broad mutation
  routes, migrations and several workers.  The prepress poller bulk-marks all
  queued jobs running while processing one; it must be stopped, not repaired,
  in this milestone.
- **P1 — provider and delivery dual authority.** V1 Stripe, QuickBooks, Gmail
  and portal/inbound paths must be explicitly stopped, retained, or migrated
  before their V2 counterparts start.
- **P2 — historical production shapes unknown.** No migration journal,
  aggregate inventory, provider uncertainty, compatibility data, or
  organization-scoped production evidence was gathered.  DEV history is not a
  substitute.

## Validation

| Area | Result |
| --- | --- |
| Worktree / source gate | PASS: clean `dev`; `HEAD = origin/dev = e77808b37883051c05a44e33328f923fd99bf179`. |
| Git remote verification | PASS: `git fetch origin dev` completed; no source was changed. |
| Static source evidence | PASS: Post-M6 reports, existing audit tooling, V1/V2 writers, deployment wiring and public routing were inspected. |
| Automated tests | Not run: no executable code/tooling change was safely made. |
| Local / DEV database validation | Not run for M7.1; existing Post-M6 DEV read-only evidence remains authoritative for DEV only. |
| PROD read-only validation | PASS for application-identity metadata sessions: `REPEATABLE READ READ ONLY`, `transaction_read_only=on`, rollback/close, Railway/Neon provenance and role-catalog proof.  BLOCKED for the required dedicated-role connection proof and business inventory. |
| MAIN validation | Not performed; MAIN untouched. |

## Next bounded milestone after unblock

Have the production database administrator reset the existing
`printershero_m7_audit` password and transmit it through the approved
out-of-band secret channel.  Then prove the dedicated-role connection and run
the bounded aggregate M7.1 inventory.  Once M7.1 can pass or pass with
findings, M7.2 should be the bounded
migration-chain/schema/postcondition/rollback-readiness milestone.  Do not
start M7.2 automatically.
