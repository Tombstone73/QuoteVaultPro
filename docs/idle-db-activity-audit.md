# Idle Database Activity Audit & Fix Report

**Date:** 2026-03-25
**Scope:** Full server-side audit — background workers, session store, connection patterns
**Question answered:** What is causing continuous Neon database activity overnight when no user is actively using the app?

---

## Executive Summary

Three root causes were identified and fixed. The highest-impact cause was a bug in the thumbnail worker that created an infinite reprocessing loop, generating continuous DB UPDATEs and Supabase Storage calls even when all thumbnails were already complete. The second cause was the thumbnail worker's fixed 10-second polling interval keeping Neon compute awake 24/7 even when there was no pending work. The third was the session store touching (UPDATE-ing) the sessions table on every authenticated request.

All three have been fixed.

---

## Root Causes (ranked by impact)

### 1. Infinite thumbnail reprocessing loop — confirmed UPDATE source

**File:** `server/workers/thumbnailWorker.ts`

**Status: FIXED**

#### What was happening

The `commonWhere` filter in `pollOnce()` included `thumb_ready` rows where:

```sql
storageProvider = 'local' OR storageProvider IS NULL
```

Any attachment row with `thumbStatus = 'thumb_ready'` and `storageProvider` not set (NULL) — a common state for rows created before the `storageProvider` column was added — would be fetched on every 10-second tick.

The processing loop had no guard for non-local `thumb_ready` rows. It would:

1. Call `getCanonicalOriginalWorkInput()` — 3 DB queries — returning `storageProvider = 'supabase'`
2. Skip the local self-heal block (since `storageProvider !== 'local'`)
3. Call `claimForProcessing()` — no-op UPDATE (WHERE requires `thumbStatus IN ('uploaded', 'thumb_pending')`)
4. Call `generateImageDerivatives()` — download original from Supabase, regenerate thumbnail, re-upload to Supabase, UPDATE row with `thumbStatus = 'thumb_ready'`
5. **`storageProvider` still NULL after the update → row matched again next tick**

This created an infinite loop: every 10 seconds per affected row, the worker would re-download the original file from Supabase, regenerate both derivatives, re-upload them, and write the result back — leaving the row in exactly the same state it started in.

This was simultaneously:
- The source of the continuous DB UPDATE pattern in Neon
- A significant contributor to the excess Supabase Storage API call volume documented in the [storage audit](supabase-storage-audit.md)

#### Fix

**Change 1 — WHERE clause** (`server/workers/thumbnailWorker.ts`):

```typescript
// Before (bug):
sql`(${table.storageProvider} = 'local' OR ${table.storageProvider} IS NULL)`

// After (fix):
sql`${table.storageProvider} = 'local'`
```

Supabase and managed `thumb_ready` rows no longer enter the work queue.

**Change 2 — defensive loop guard** (`server/workers/thumbnailWorker.ts`):

```typescript
// Belt-and-suspenders: skip any non-local thumb_ready row that reaches the loop
if (row.thumbStatus === 'thumb_ready' && storageProvider !== 'local') {
  continue;
}
```

#### Diagnostic query (run against production)

```sql
SELECT id, thumb_status, storage_provider, updated_at
FROM quote_attachments
WHERE thumb_status = 'thumb_ready'
  AND (storage_provider = 'local' OR storage_provider IS NULL)
  AND file_record_id IS NOT NULL
UNION ALL
SELECT id, thumb_status, storage_provider, updated_at
FROM order_attachments
WHERE thumb_status = 'thumb_ready'
  AND (storage_provider = 'local' OR storage_provider IS NULL)
  AND file_record_id IS NOT NULL
ORDER BY updated_at DESC;
```

Any rows returned were being continuously reprocessed before this fix. To fully clean up the data, backfill `storage_provider` to the correct value (e.g., `'supabase'`) for those rows. The loop is stopped regardless.

---

### 2. Thumbnail worker fixed 10-second polling — continuous compute wake

**File:** `server/workers/thumbnailWorker.ts`

**Status: FIXED**

#### What was happening

The worker used a fixed `setInterval` at 10 seconds in production. When no pending attachments exist — the normal overnight state — the worker still issued 2 SELECTs per tick:

| Metric | Value |
|---|---|
| Queries per minute | 12 |
| Queries per hour | 720 |
| Queries per day | 17,280 |

This pattern alone is sufficient to prevent Neon compute from auto-suspending. Neon suspends after ~5 minutes of inactivity. A SELECT every 10 seconds guarantees the compute stays awake permanently.

#### Fix

Converted `setInterval` → recursive `setTimeout` chain with idle backoff.

```typescript
// New constants
const IDLE_BACKOFF_AFTER = 6;    // scale up after ~1 min of empty polls (at 10s base)
const MAX_IDLE_INTERVAL_MS = 60_000;

// Counter incremented on each empty poll, reset when work is found
let consecutiveEmptyPolls = 0;

// Delay grows linearly in base-interval increments, capped at 60s
function getNextPollDelayMs(): number {
  const base = getPollIntervalMs();  // 10s in production
  if (consecutiveEmptyPolls < IDLE_BACKOFF_AFTER) return base;
  const factor = Math.ceil(consecutiveEmptyPolls / IDLE_BACKOFF_AFTER);
  return Math.min(MAX_IDLE_INTERVAL_MS, base * factor);
}
```

**Behavior after fix:**

| State | Interval |
|---|---|
| Active work present | 10s (unchanged) |
| Idle for ~1 min | Starts scaling toward 60s |
| Fully idle | 60s (6× reduction) |
| Work found again | Resets to 10s immediately |

At true overnight idle, polling drops from 6 queries/min to 2 queries/min.

---

### 3. Session store `touch()` on every authenticated request — continuous UPDATE source

**File:** `server/localAuth.ts`

**Status: FIXED**

#### What was happening

`connect-pg-simple` defaults to `disableTouch: false`. When a session is loaded from the database, the store calls `touch()` to refresh the session's `expire` column — an `UPDATE sessions SET expire = ... WHERE sid = ...`. With any authenticated browser tab open or any polling interval firing, this generates a continuous stream of session UPDATEs.

The session store was configured without `disableTouch`:

```typescript
// Before:
const sessionStore = new pgStore({
  conString: process.env.DATABASE_URL,
  createTableIfMissing: false,
  ttl: sessionTtl,
  tableName: "sessions",
});
```

#### Fix

```typescript
// After:
const sessionStore = new pgStore({
  conString: process.env.DATABASE_URL,
  createTableIfMissing: false,
  ttl: sessionTtl,
  tableName: "sessions",
  disableTouch: true,  // prevent UPDATE on every session read; sessions expire by original TTL
});
```

Sessions now expire based on their TTL set at creation (7 days). No session UPDATEs occur between creation and expiry. The trade-off is that a user active near the 7-day boundary will not have their session extended — acceptable given the 7-day TTL.

---

## Background Workers — Full Idle Behavior Inventory

| Worker | Interval | Idle DB writes | Idle DB reads | Notes |
|---|---|---|---|---|
| Thumbnail worker | 10s → up to 60s (after fix) | Zero when idle | 2 SELECTs/tick | Fixed: idle backoff + reprocess loop |
| QB Sync Worker | 30s | Zero when idle | 1 SELECT/tick | Early-return when `pendingJobs.length === 0` |
| QB Queue Worker | 5min | Zero when idle | 3 SELECTs/tick | Early-return when no eligible invoices/payments |
| Asset Preview Worker | 10min | Zero when idle | 1 SELECT/tick | Early-return when no pending assets |
| connect-pg-simple prune | 15min (default) | 1 DELETE/cycle | None | Removes expired sessions; no override set |

**Session store (per request):**

| Setting | Before | After |
|---|---|---|
| `resave` | `false` | `false` |
| `saveUninitialized` | `false` | `false` |
| `disableTouch` | not set (default `false`) | `true` |
| Session write per request | Yes (touch UPDATE) | No |

---

## What Explains the Neon "Updated Rows" Pattern

The `pg_stat_database.n_tup_upd` metric counts actual row updates. Continuous UPDATE activity overnight with no user traffic maps to:

| Source | Table | Write type | Frequency at idle | Fixed? |
|---|---|---|---|---|
| Thumbnail reprocess loop | `quote_attachments`, `order_attachments` | UPDATE (thumbStatus, updatedAt) | Every 10s per affected row | ✅ Yes |
| Session touch | `sessions` | UPDATE (expire) | Every authenticated request | ✅ Yes |
| connect-pg-simple prune | `sessions` | DELETE (expired rows) | Every 15 min | — Low impact |
| QB Sync Worker | `accounting_sync_jobs` | UPDATE (only on error) | Zero at idle | — No change needed |
| Thumbnail worker (new work) | `quote_attachments`, `order_attachments` | UPDATE (thumbStatus, thumbKey) | Zero at true idle | — By design |

---

## Files Changed

| File | Change |
|---|---|
| `server/workers/thumbnailWorker.ts` | Removed `storageProvider IS NULL` from thumb_ready WHERE; added non-local guard; converted to `setTimeout` chain with idle backoff |
| `server/localAuth.ts` | Added `disableTouch: true` to pgStore config |

---

## What Remains

- **QB Sync Worker at 30s**: Pure SELECT when idle. Low volume. No change made — could be increased to 60–120s if further reduction is desired.
- **connect-pg-simple prune at 15min**: A single `DELETE` every 15 minutes. No change needed.
- **Thumbnail worker base SELECT at 10s**: Still 2 SELECTs/tick at minimum. After idle backoff reaches maximum, reduces to 2 SELECTs per 60s. This is the practical floor without disabling the worker entirely.
