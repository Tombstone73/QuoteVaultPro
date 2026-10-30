# Disposable PostgreSQL payment tests on Docker Desktop

Reuse an existing disposable test container when one is available; do not repeat bootstrap against a populated database. The setup below is only for a new isolated test database. It must never be pointed at a DEV, MAIN, production, or shared business database. The test runner retains the existing `TEST_DATABASE_URL` and server-address guards.

From PowerShell, with Docker Desktop running and a cached `postgres:16` and Node-capable image (the example uses `n8nio/n8n:latest`):

```powershell
$paymentDocker = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
$paymentContainer = 'printershero-payment-test-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$paymentPassword = [guid]::NewGuid().ToString('N')
& $paymentDocker run --detach --rm --name $paymentContainer --label 'codex.task=printershero-payment-test' --publish '127.0.0.1::5432' --env 'POSTGRES_USER=payment_test' --env "POSTGRES_PASSWORD=$paymentPassword" --env 'POSTGRES_DB=printershero_payment_test' postgres:16
& $paymentDocker port $paymentContainer 5432/tcp
& $paymentDocker exec $paymentContainer pg_isready -U payment_test -d printershero_payment_test
```

Verify the container name and loopback binding with `docker inspect`, and use its reported host port in the following URL. A basic rollback probe can be run with `docker exec`: create and insert into a test table inside `BEGIN`, issue `ROLLBACK`, then verify `to_regclass` returns null. Keep credentials in the current shell only; do not commit them. The schema bootstrap uses `DATABASE_URL` only in a child process and must target the new empty database:

```powershell
$paymentPort = '<reported-host-port>'
$paymentUrl = "postgresql://payment_test:${paymentPassword}@127.0.0.1:${paymentPort}/printershero_payment_test"
$env:DATABASE_URL = $paymentUrl
npm.cmd run db:push -- --force
Remove-Item Env:DATABASE_URL
```

Check the output: `drizzle-kit` has returned exit code zero even when schema creation reported an error. On the current schema an empty bootstrap can fail because the foreign key to `ink_master_printers` is created before its `(organization_id, id)` unique index. If and only if that exact error occurs and the target is the verified new disposable container, add the repository-defined index inside it and retry the push:

```powershell
& $paymentDocker exec $paymentContainer psql -U payment_test -d printershero_payment_test -v ON_ERROR_STOP=1 -c 'CREATE UNIQUE INDEX IF NOT EXISTS ink_master_printers_org_id_uidx ON public.ink_master_printers (organization_id, id);'
$env:DATABASE_URL = $paymentUrl
npm.cmd run db:push -- --force
Remove-Item Env:DATABASE_URL
```

Run the suite in a separate disposable Node container sharing the database container network namespace. A Windows connection forwarded to Docker does not satisfy the existing `inet_server_addr()` loopback check; sharing the namespace does, without weakening that check. The checkout is mounted read-only. Adjust the checkout path only to the intended V1 checkout.

```powershell
& $paymentDocker run --rm --network "container:$paymentContainer" --mount 'type=bind,source=C:\titan-automation\QuoteVaultPro-v1-ai-live-defects,target=/work,readonly' --workdir /work --env "TEST_DATABASE_URL=postgresql://payment_test:${paymentPassword}@127.0.0.1:5432/printershero_payment_test" --env 'NODE_OPTIONS=--experimental-vm-modules' --entrypoint node n8nio/n8n:latest node_modules/jest/bin/jest.js --config jest.local-postgres.config.js --runInBand server/tests/customerSettlementLifecycle.postgres.integration.ts
```

The suite verifies database identity and schema before its fixtures. Test data and schema are disposable. Stop only the container created by this procedure when finished: `& $paymentDocker stop $paymentContainer`. The `--rm` option removes it after stopping. Do not run real gateway charges.

## Grouped staff/portal milestone

Run both server/tests/groupedStripeInitiation.postgres.integration.ts and server/tests/customerSettlementLifecycle.postgres.integration.ts with the command above. The former executes actual portal adapters and staff HTTP routes, durable single/grouped races, idempotent replay, unpaid recovery, tenant/permission rejection, webhook replay, and saved invoice balances. Stripe and browser runtime configuration are mocked; no real cards are used. Native image processing imported by the portal module is outside these tests.

Unlinked reservations older than 23 hours require processor review because the original provider idempotency key may expire. Linked declined/unpaid intents can be explicitly released only after Stripe confirms cancellation. Processing or successful funds are never locally canceled to create a replacement. Grouped QuickBooks posting retains the existing accounting review hold.

## Linked Redo Orders

Run `server/tests/redoOrders.postgres.integration.ts` with the same disposable PG16 command. Apply the new forward migration `0241_linked_redo_orders.sql` only to the verified disposable database before this suite. The local setup restores the station ID default from migration 0001, which `db:push` omits. The suite creates synthetic closed/paid/fulfilled sources, partial no-charge Redos, production jobs and pickup handoffs; it checks immutable source history, draft invoices, group integrity, durable replay, tenant/permission rejection and rollback. No business database or gateway is used.
