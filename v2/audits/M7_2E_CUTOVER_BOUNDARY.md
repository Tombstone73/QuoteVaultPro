# M7.2E cutover boundary

The production boundary is whole-system authority, not per-record transfer:

```text
maintenance / ingress closed
  -> V1 completely OFF; every independent writer proven stopped
  -> final restore point verified
  -> single reconciliation executor
  -> physical R0269 attestation + normal Drizzle
  -> V2 starts read-only and is verified
  -> V2 writers and external ingress are released deliberately
```

## Maintenance entry

1. Enable a maintenance boundary that rejects every V1 mutable staff, portal/token, assistant, provider, and webhook-application route.
2. Freeze deployments/predeploy migrations, then stop every V1 replica and separately stop standalone prepress or any independent worker/cron.
3. Record external-provider retry/hold policy and take fresh queue/lease/active-work evidence.
4. Run the M7.2E write-free gate. Failure means no reconciliation.
5. Verify the final restore point and that no reconciliation executor is active; then grant the sole schema authority to R0264--R0269 and normal Drizzle.

## V2 start and rollback

Start V2 with all writers disabled, verify health, version, database compatibility and readiness, then release operational, delivery/provider, and external-ingress authority in that order.

Before V2 accepts any authoritative write, rollback is an application rollback only if the reconciled compatibility schema is proven safe; otherwise restore/forward repair is required. Once V2 accepts authoritative writes, rollback becomes a database restore or forward-fix decision, never an automatic V1 restart.
