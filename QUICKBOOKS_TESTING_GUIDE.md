# QuickBooks Integration Testing Guide

This guide walks you through testing QuickBooks OAuth and invoice sync end-to-end.

## Goal (2-Hour Sprint)
1. Connect QuickBooks via OAuth
2. Sync at least ONE invoice to QuickBooks
3. Verify invoice shows 'synced' status in TitanOS UI

---

## Prerequisites

### 1. QuickBooks Developer Account
- Sign up at https://developer.intuit.com/
- Create a new app in the QuickBooks Developer Portal
- Choose "Accounting" scope
- Note your **Client ID** and **Client Secret**

### 2. Environment Variables

Add these to your `.env` file:

```env
# QuickBooks OAuth Configuration
QUICKBOOKS_CLIENT_ID=<your_client_id>
QUICKBOOKS_CLIENT_SECRET=<your_client_secret>
QUICKBOOKS_REDIRECT_URI=http://localhost:5000/api/integrations/quickbooks/callback
QUICKBOOKS_ENVIRONMENT=sandbox

# Enable QuickBooks debug logging (DEV only)
QB_DEBUG_LOGS=1

# Your existing vars
DATABASE_URL=<neon_connection_string>
SESSION_SECRET=<your_session_secret>
```

### 3. QuickBooks App Configuration

In your QuickBooks app settings (developer.intuit.com):

**Redirect URIs:**
- `http://localhost:5000/api/integrations/quickbooks/callback`

**Scopes:**
- Accounting

---

## Testing Workflow

### Step 1: Start the Application

```powershell
npm run dev
```

Verify:
- Server starts on port 5000
- Frontend accessible at http://localhost:5173
- No startup errors in console

### Step 2: Navigate to Settings → Integrations

1. Log in to TitanOS (use local credentials or Replit auth)
2. Go to **Settings** page (usually `/settings`)
3. Look for **QuickBooks** integration section

### Step 3: Connect QuickBooks

1. Click **Connect QuickBooks** button
2. You'll be redirected to QuickBooks OAuth screen
3. Log in with your QuickBooks sandbox credentials
4. Select a company to connect (use sandbox company)
5. Click **Authorize**

**Expected behavior:**
- Redirects back to `/settings?qb_connected=true`
- Settings page shows "Connected to QuickBooks"
- Check server console for QB OAuth debug logs (if `QB_DEBUG_LOGS=1`):
  ```
  [QB OAuth] Authorization URL generated { organizationId: '...', state: '...', environment: 'sandbox' }
  [QB OAuth] parseOAuthState: valid state { organizationId: '...', ageSeconds: 5 }
  [QB OAuth] Exchanging authorization code { organizationId: '...', realmId: '...' }
  [QB OAuth] Tokens received { organizationId: '...', realmId: '...', hasAccessToken: true, hasRefreshToken: true, expiresIn: 3600 }
  [QB OAuth] Connection stored successfully { organizationId: '...', realmId: '...' }
  ```

### Step 4: Create/Find a Test Invoice

**Option A: Create new invoice**
1. Navigate to **Invoices** page (`/invoices`)
2. Create a new invoice with:
   - Customer (create test customer if needed)
   - At least one line item (description + amount)
   - Status: **Billed** (must be billed to sync to QB)
3. Click **Save**

**Option B: Use existing invoice**
1. Navigate to **Invoices** page
2. Open any existing invoice
3. Ensure status is **Billed** (if draft, click **Bill Invoice** button)

### Step 5: Sync Invoice to QuickBooks

1. Open invoice detail page
2. Look at **Status Strip** (below customer info)
3. Find **QB Sync** tile:
   - Shows current status: `Pending` | `Needs resync` | `Synced` | `Failed`
   - If `Failed` or `Needs resync`, a **Retry** button appears
4. Click **Retry** button (or wait for background sync job)

**Expected behavior:**
- Button shows "Retry…" briefly
- Status changes to **Synced**
- **Accounting Status** tile shows "QB up to date"
- If failed, hover over red badge to see error message

**Server logs (if `QB_DEBUG_LOGS=1`):**
```
[QB Push Invoices] Starting job <job_id>
[QB Push Invoices] Found 1 invoices to sync
[QB Push Invoices] Completed: 1 synced, 0 errors
```

### Step 6: Verify in QuickBooks

1. Log in to QuickBooks sandbox (https://app.sandbox.qbo.intuit.com/)
2. Navigate to **Sales** → **Invoices**
3. Find invoice with matching **DocNumber** (your TitanOS invoice number)
4. Verify:
   - Customer name matches
   - Line items match
   - Total matches
   - Invoice marked as `Unpaid` in QBO

---

## Troubleshooting

### OAuth Fails with "State validation error"

**Symptom:** Redirect to `/settings?error=Invalid state`

**Causes:**
- `SESSION_SECRET` not set in `.env`
- State parameter expired (>30 minutes between auth initiation and callback)
- HMAC signature mismatch

**Fix:**
1. Ensure `SESSION_SECRET` is set in `.env`
2. Retry OAuth flow (don't wait 30+ minutes between steps)
3. Check server logs for parseOAuthState failures:
   ```
   [QB OAuth] parseOAuthState: invalid prefix
   [QB OAuth] parseOAuthState: state expired
   [QB OAuth] parseOAuthState: signature mismatch
   ```

### Invoice Sync Fails with "Customer not synced to QuickBooks"

**Symptom:** QB Sync badge shows **Failed**, error: "Customer not synced to QuickBooks"

**Cause:** Customer doesn't have `externalAccountingId` populated

**Fix:**
1. Sync customer first (Settings → Integrations → QuickBooks → Sync Customers)
2. OR: `ensureQBCustomerIdForLocalCustomer` will auto-create customer on invoice sync
3. Check server logs for customer sync errors

### Invoice Sync Fails with "QuickBooks API error: 400"

**Symptom:** QB Sync badge shows **Failed**, error: "QuickBooks API error: 400 ..."

**Cause:** Invalid data format (missing required fields, invalid date format, etc.)

**Fix:**
1. Check `qbLastError` field in invoice record (hover over failed badge)
2. Common issues:
   - Missing customer `companyName`
   - Invalid date format (must be YYYY-MM-DD)
   - Line items with $0 amount
   - Missing line item descriptions

### Token Refresh Fails

**Symptom:** Sync works initially, then fails after 1 hour with "Failed to get valid access token"

**Cause:** Refresh token expired or invalid

**Fix:**
1. Disconnect and reconnect QuickBooks (Settings → Integrations → QuickBooks → Disconnect)
2. Check `oauthConnections` table in DB:
   ```sql
   SELECT * FROM oauth_connections WHERE provider = 'quickbooks';
   ```
3. Verify `refreshToken` is not null
4. Check `expiresAt` timestamp (should auto-refresh 5 minutes before expiry)

### Background Sync Job Not Running

**Symptom:** Invoice stays in `Pending` state, never moves to `Synced`

**Cause:** Sync worker not started or job not queued

**Fix:**
1. Check if sync worker is running (should start on server boot)
2. Manually trigger sync job processing:
   ```
   POST /api/integrations/quickbooks/jobs/trigger
   ```
3. Check job status:
   ```
   GET /api/integrations/quickbooks/jobs?status=pending
   ```
4. Check server logs for:
   ```
   [Sync Worker] Found X pending job(s)
   [Sync Worker] Processing job <job_id>: push invoices
   [Sync Worker] Job <job_id> completed successfully
   ```

---

## Manual API Testing

If UI testing fails, you can test the API directly:

### 1. Check Connection Status

```powershell
curl http://localhost:5000/api/integrations/quickbooks/status `
  -H "Cookie: connect.sid=<your_session_cookie>" `
  -H "Content-Type: application/json"
```

**Expected response:**
```json
{
  "connected": true,
  "companyId": "123146096291789",
  "expiresAt": "2024-01-15T12:00:00.000Z"
}
```

### 2. Manually Sync Invoice

```powershell
curl -X POST http://localhost:5000/api/invoices/<invoice_id>/retry-qb-sync `
  -H "Cookie: connect.sid=<your_session_cookie>" `
  -H "Content-Type: application/json"
```

**Expected response (success):**
```json
{
  "success": true,
  "data": {
    "invoice": {
      "id": "...",
      "qbInvoiceId": "123",
      "qbSyncStatus": "synced",
      "qbLastError": null,
      "lastQbSyncedVersion": 1
    }
  }
}
```

**Expected response (failure):**
```json
{
  "success": true,
  "data": {
    "invoice": {
      "id": "...",
      "qbInvoiceId": null,
      "qbSyncStatus": "failed",
      "qbLastError": "QuickBooks API error: 400 Customer not found"
    }
  }
}
```

### 3. Queue Bulk Sync Jobs

```powershell
curl -X POST http://localhost:5000/api/integrations/quickbooks/sync/push `
  -H "Cookie: connect.sid=<your_session_cookie>" `
  -H "Content-Type: application/json" `
  -d '{"resources":["customers","invoices"]}'
```

**Expected response:**
```json
{
  "success": true,
  "message": "Queued 2 push sync job(s)",
  "resources": ["customers", "invoices"]
}
```

---

## Database Verification

### Check OAuth Connection

```sql
SELECT 
  provider,
  company_id,
  organization_id,
  expires_at,
  created_at,
  CASE 
    WHEN expires_at > NOW() THEN 'valid'
    ELSE 'expired'
  END as token_status
FROM oauth_connections
WHERE provider = 'quickbooks'
ORDER BY created_at DESC
LIMIT 1;
```

### Check Invoice Sync Status

```sql
SELECT 
  invoice_number,
  status,
  qb_invoice_id,
  qb_sync_status,
  qb_last_error,
  invoice_version,
  last_qb_synced_version,
  synced_at
FROM invoices
WHERE organization_id = 'org_titan_001'
ORDER BY created_at DESC
LIMIT 10;
```

### Check Sync Jobs

```sql
SELECT 
  id,
  direction,
  resource_type,
  status,
  error,
  created_at,
  updated_at
FROM accounting_sync_jobs
WHERE organization_id = 'org_titan_001'
ORDER BY created_at DESC
LIMIT 10;
```

---

## Success Criteria

✅ **OAuth Connection**
- QuickBooks connected in Settings page
- `oauth_connections` table has valid record
- Token not expired

✅ **Invoice Sync**
- At least ONE invoice with `qb_sync_status = 'synced'`
- `qb_invoice_id` populated with QuickBooks ID
- `last_qb_synced_version` matches `invoice_version`

✅ **UI Feedback**
- Invoice detail page shows **QB Sync: Synced** badge
- **Accounting Status: QB up to date** tile shows green
- Failed syncs show error tooltip on hover

✅ **QuickBooks Verification**
- Invoice appears in QuickBooks sandbox
- Customer, line items, and totals match TitanOS

---

## Debug Logging

All QB debug logs are guarded by `QB_DEBUG_LOGS=1` env var. Key log messages:

**OAuth Flow:**
```
[QB OAuth] Authorization URL generated
[QB OAuth] parseOAuthState: valid state
[QB OAuth] Exchanging authorization code
[QB OAuth] Tokens received
[QB OAuth] Connection stored successfully
```

**Invoice Sync:**
```
[QB Push Invoices] Starting job <job_id>
[QB Push Invoices] Found X invoices to sync
[QB Push Invoices] Completed: X synced, Y errors
```

**Customer Sync:**
```
[QuickBooks] customer ensure failed
[QuickBooks] API error { organizationId, endpoint, status, message }
```

**Worker:**
```
[Sync Worker] Found X pending job(s)
[Sync Worker] Processing job <job_id>: push invoices
[Sync Worker] Job <job_id> completed successfully
[Sync Worker] Job <job_id> failed: <error>
```

---

## Next Steps After Testing

Once you've successfully synced ONE invoice:

1. **Test payment sync**: Record a payment on the invoice in TitanOS, sync to QB
2. **Test bulk sync**: Queue jobs for multiple invoices/customers
3. **Test error recovery**: Disconnect QB mid-sync, verify retry logic
4. **Test multi-tenant**: Connect different QB companies to different organizations
5. **Production readiness**:
   - Remove `QB_DEBUG_LOGS=1` in production
   - Set `QUICKBOOKS_ENVIRONMENT=production`
   - Update redirect URI to production domain
   - Test webhook handling (if implemented)

---

## Contact

If you encounter issues not covered in this guide:
1. Check server console for detailed error logs
2. Review `QUICKBOOKS_IMPLEMENTATION.md` for architecture details
3. Search QuickBooks API docs: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice
