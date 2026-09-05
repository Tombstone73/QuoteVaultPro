# M7.4 QuickBooks production readiness

## Disposition: PRODUCTION NOT YET AUTHORIZED

M6 proves sandbox behavior only. Railway production has QuickBooks client, environment, redirect, and token-encryption variable names, but redaction prevents verification that the environment is the explicit `production` value, that the redirect matches the deployed callback, that a live realm/company is authorized, or that persisted tokens can be decrypted with the effective key.

## V2 contract

The source defaults an absent QuickBooks environment to sandbox. Production must be explicit. Token envelopes use the QuickBooks token-encryption key (or legacy alias) plus a key ID; changing the key without a migration/re-encryption plan may invalidate existing ciphertext. The V2 queue is durable, lease/idempotency aware, and retains uncertain/blocked cases rather than broadly replaying history. It starts only when `QUICKBOOKS_AUTOMATION_OWNER=queue`.

## Required M8 delta

- Verify an explicit production environment, registered redirect/callback, authorized live realm, and decryptable current token by an approved read-only readiness check.
- Preserve the effective token-encryption key and key ID, or perform a separately designed dual-key/re-encryption migration before rotation.
- Start V2 with `QUICKBOOKS_AUTOMATION_OWNER` non-queue/disabled. Enable the queue only after accounting owner approval and post-start readiness evidence.
- Do not carry `v2/ui/vercel.json` development rewrite targets into the production frontend; its QuickBooks callback currently points to the DEV API and is development-only configuration.

No OAuth refresh, sync, invoice/payment write, or QuickBooks provider action occurred.
