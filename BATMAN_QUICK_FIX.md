# 🚨 URGENT: Railway Environment Variables Fix

## Current Problem
Railway has `AUTH_PROVIDER=local` which is **WRONG for production**.

Server will now **REFUSE TO START** until this is fixed.

---

## 🔴 MUST CHANGE IN RAILWAY DASHBOARD

### 1. Change Existing Variable
```
AUTH_PROVIDER = replit
```
(Currently set to "local" - this is wrong)

### 2. Add Missing Variables
```
PUBLIC_APP_URL = https://www.printershero.com
REPL_ID = <ask Railway support or check Replit dashboard>
REPLIT_OIDC_ISSUER = https://replit.com
```

### 3. Verify These Exist
```
NODE_ENV = production
DATABASE_URL = <should be auto-set by Railway>
SESSION_SECRET = <should exist>
```

---

## ✅ How to Fix (5 minutes)

1. Open Railway Dashboard → Your Project → Variables
2. Find `AUTH_PROVIDER`, change value to: `replit`
3. Click "+ New Variable" and add:
   - Name: `PUBLIC_APP_URL`, Value: `https://www.printershero.com`
   - Name: `REPL_ID`, Value: `<see below>`
   - Name: `REPLIT_OIDC_ISSUER`, Value: `https://replit.com`
4. Click "Deploy" or wait for auto-deploy

---

## 🤔 Where to Get REPL_ID?

### Option 1: Contact Railway Support
Ask: "What's my application's REPL_ID for OIDC authentication?"

### Option 2: Check Replit Dashboard
If you have a Replit account:
1. Go to your Replit project
2. Click Settings → Environment Variables
3. Look for REPL_ID value
4. Copy to Railway

### Option 3: Try Railway Project ID
Your Railway project ID might work as REPL_ID. Try it first.

---

## ✅ What Happens After Fix

### Server Startup Logs (Success)
```
═══════════════════════════════════════════════════════════
   Environment Configuration Status
═══════════════════════════════════════════════════════════
NODE_ENV: production
AUTH_PROVIDER: replit
PUBLIC_APP_URL: https://www.printershero.com
DATABASE_URL: ✓ set
SESSION_SECRET: ✓ set (64 chars)
REPLIT_OIDC_ISSUER: ✓ set
REPL_ID: ✓ set
═══════════════════════════════════════════════════════════

✓ Environment validation passed

[Server] Server listening on http://0.0.0.0:5000
```

### Before Fix (Server Exits)
```
✗ Environment Validation Failed
═══════════════════════════════════════════════════════════
✗ AUTH_PROVIDER
  AUTH_PROVIDER must NOT be "local" in production. Set AUTH_PROVIDER=replit for Railway/Replit deployments.

✗ PUBLIC_APP_URL
  PUBLIC_APP_URL must be set in production (e.g., https://www.printershero.com)
═══════════════════════════════════════════════════════════
Server cannot start with invalid environment configuration.
```

---

## 📋 Complete Variable Checklist

Copy/paste this into Railway Dashboard:

| Variable | Value | Status |
|----------|-------|--------|
| `DATABASE_URL` | `postgresql://...` | ✅ Should exist |
| `SESSION_SECRET` | `<random-string>` | ✅ Should exist |
| `NODE_ENV` | `production` | ⚠️ Verify set |
| `AUTH_PROVIDER` | `replit` | 🔴 **CHANGE FROM "local"** |
| `PUBLIC_APP_URL` | `https://www.printershero.com` | 🔴 **ADD THIS** |
| `REPL_ID` | `<your-repl-id>` | 🔴 **ADD THIS** |
| `REPLIT_OIDC_ISSUER` | `https://replit.com` | 🔴 **ADD THIS** |
| `SUPABASE_URL` | `<existing>` | ✅ Already set |
| `SUPABASE_SERVICE_ROLE_KEY` | `<existing>` | ✅ Already set |
| `SUPABASE_BUCKET` | `<existing>` | ✅ Already set |

---

## 🆘 Need Help?

**Read full docs:**
- [RAILWAY_DEPLOYMENT_CHECKLIST.md](./RAILWAY_DEPLOYMENT_CHECKLIST.md) - Complete guide
- [RAILWAY_PRODUCTION_CONFIG_FIX.md](./RAILWAY_PRODUCTION_CONFIG_FIX.md) - Technical details

**Contact:**
- Railway Support (for REPL_ID)
- Development Team (for other issues)
