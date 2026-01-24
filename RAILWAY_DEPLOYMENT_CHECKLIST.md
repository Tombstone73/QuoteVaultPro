# Railway Production Deployment - Environment Variables Checklist

## Critical: Auth Provider Configuration

**⚠️ URGENT:** Railway currently has `AUTH_PROVIDER=local` which is WRONG for production.

### Required Action
Change Railway environment variable:
```
AUTH_PROVIDER=replit
```

**Why this matters:**
- `local` = Development-only auth with auto-login
- `replit` = Production auth with proper OIDC/OAuth flow
- Server will now refuse to start if `AUTH_PROVIDER=local` in production

---

## Railway Environment Variables Checklist

### 🔴 CRITICAL (Server won't start without these)

```bash
# Database connection (should already be set by Railway)
DATABASE_URL=postgresql://user:password@host/database?sslmode=require

# Session secret - MUST be 16+ characters
SESSION_SECRET=<generate-a-strong-random-string-32-plus-chars>

# Node environment - MUST be production
NODE_ENV=production

# Auth provider - MUST be replit for Railway
AUTH_PROVIDER=replit

# Public application URL - MUST match your domain
PUBLIC_APP_URL=https://www.printershero.com
```

### 🟡 REQUIRED for Replit Auth (when AUTH_PROVIDER=replit)

```bash
# Replit application ID
REPL_ID=<your-repl-id>

# Replit OIDC issuer URL
REPLIT_OIDC_ISSUER=https://replit.com

# Legacy fallback (optional if REPLIT_OIDC_ISSUER is set)
ISSUER_URL=https://replit.com
```

### 🟢 OPTIONAL but Recommended

```bash
# Gmail OAuth redirect URI (defaults to OAuth Playground)
GMAIL_OAUTH_REDIRECT_URI=https://developers.google.com/oauthplayground

# Google Cloud Storage (if using Supabase instead, these can be omitted)
GCS_BUCKET_NAME=<your-gcs-bucket>
GCS_PROJECT_ID=<your-gcs-project-id>

# Supabase (if using for storage)
SUPABASE_URL=<your-supabase-url>
SUPABASE_SERVICE_ROLE_KEY=<your-supabase-key>
SUPABASE_BUCKET=<your-supabase-bucket>
```

---

## Current Railway Configuration Status

Based on screenshot provided:

✅ `DATABASE_URL` - Set (Neon PostgreSQL)  
✅ `SESSION_SECRET` - Set  
✅ `SUPABASE_*` - Set (3 variables)  
❌ `AUTH_PROVIDER` - **INCORRECT** (set to "local")  
❌ `PUBLIC_APP_URL` - **MISSING**  
❌ `NODE_ENV` - Not visible in screenshot, **verify it's "production"**  
❌ `REPL_ID` - **MISSING** (required for AUTH_PROVIDER=replit)  
❌ `REPLIT_OIDC_ISSUER` - **MISSING** (required for AUTH_PROVIDER=replit)  

---

## Step-by-Step Railway Configuration

### 1. Open Railway Dashboard
Navigate to your project → Environment Variables

### 2. Update/Add Required Variables

**Change existing:**
```
AUTH_PROVIDER = replit
```

**Add new:**
```
PUBLIC_APP_URL = https://www.printershero.com
NODE_ENV = production
REPL_ID = <get-from-replit-dashboard>
REPLIT_OIDC_ISSUER = https://replit.com
```

### 3. Verify Critical Variables

Click through each variable and confirm:
- ✅ `DATABASE_URL` contains valid PostgreSQL connection string
- ✅ `SESSION_SECRET` is at least 16 characters (32+ recommended)
- ✅ `AUTH_PROVIDER` is set to `replit` (not `local`)
- ✅ `NODE_ENV` is set to `production`
- ✅ `PUBLIC_APP_URL` is `https://www.printershero.com`

### 4. Save and Redeploy

After setting all variables:
1. Click "Deploy" or trigger a new deployment
2. Watch deployment logs for environment validation
3. Server should log environment status at startup

---

## Startup Validation

After deploying with correct environment variables, the server will:

1. **Log environment status:**
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
```

2. **Refuse to start if misconfigured:**
```
✗ Environment Validation Failed
═══════════════════════════════════════════════════════════
✗ AUTH_PROVIDER
  AUTH_PROVIDER must NOT be "local" in production. Set AUTH_PROVIDER=replit for Railway/Replit deployments.

✗ PUBLIC_APP_URL
  PUBLIC_APP_URL must be set in production (e.g., https://www.printershero.com)
═══════════════════════════════════════════════════════════
Server cannot start with invalid environment configuration.
Fix the errors above and restart the server.
```

---

## Getting Replit/Railway OIDC Values

### Option 1: Use Railway's Built-in Auth
If Railway provides OAuth/OIDC, check Railway docs for:
- Application ID (for `REPL_ID`)
- OIDC issuer URL (for `REPLIT_OIDC_ISSUER`)

### Option 2: Contact Railway Support
Ask Railway support for:
- Your application's OAuth configuration
- OIDC issuer endpoint
- Client ID (if different from REPL_ID)

### Option 3: Check Existing Replit Deployment
If you have a working Replit deployment:
1. Navigate to Replit project settings
2. Copy `REPL_ID` and `REPLIT_OIDC_ISSUER` values
3. Use same values in Railway

---

## Troubleshooting

### Server exits immediately with "Environment Validation Failed"
**Cause:** Required environment variables are missing or incorrect

**Fix:**
1. Check Railway logs for specific error messages
2. Compare Railway variables against checklist above
3. Fix the highlighted variables
4. Redeploy

### "AUTH_PROVIDER must NOT be local in production"
**Cause:** Railway has `AUTH_PROVIDER=local`

**Fix:**
1. Change `AUTH_PROVIDER` to `replit` in Railway dashboard
2. Redeploy

### "REPL_ID must be set when AUTH_PROVIDER=replit"
**Cause:** Missing Replit configuration

**Fix:**
1. Get `REPL_ID` from Replit dashboard or Railway support
2. Set `REPL_ID` in Railway environment variables
3. Set `REPLIT_OIDC_ISSUER=https://replit.com`
4. Redeploy

### Email test still times out after fixing AUTH_PROVIDER
**Possible causes:**
1. Email settings in database are incomplete
2. Gmail OAuth refresh token is invalid
3. Network connectivity issues

**Fix:**
1. Run diagnostic: `npm run email:check` (locally with Railway env vars)
2. Check Railway logs for `email_test_start` entries
3. Verify Gmail OAuth configuration in Admin Settings
4. Check requestId in error response and search Railway logs

---

## Verification Steps

After deployment with correct variables:

### 1. Check Server Starts Successfully
```bash
# In Railway logs, look for:
✓ Environment validation passed
[Server] Server listening on http://0.0.0.0:5000
```

### 2. Verify Auth Works
Navigate to `https://www.printershero.com` and attempt login

### 3. Test Email (if configured)
1. Log into admin account
2. Navigate to Admin Settings → Email tab
3. Click "Test Email"
4. Check for success or structured error message

### 4. Monitor Logs
Watch Railway logs for:
- No "Environment Validation Failed" errors
- No "AUTH_PROVIDER must NOT be local" errors
- Successful auth flows
- Structured error messages with requestIds (if email test fails)

---

## Production Environment Variables Summary

Copy this to Railway (replace placeholder values):

```bash
# ===== CRITICAL (server refuses to start without these) =====
DATABASE_URL=<railway-auto-provided>
SESSION_SECRET=<generate-32-plus-character-random-string>
NODE_ENV=production
AUTH_PROVIDER=replit
PUBLIC_APP_URL=https://www.printershero.com
REPL_ID=<get-from-replit-or-railway>
REPLIT_OIDC_ISSUER=https://replit.com

# ===== OPTIONAL (already set per screenshot) =====
SUPABASE_URL=<already-set>
SUPABASE_SERVICE_ROLE_KEY=<already-set>
SUPABASE_BUCKET=<already-set>

# ===== OPTIONAL (email configuration) =====
GMAIL_OAUTH_REDIRECT_URI=https://developers.google.com/oauthplayground
```

---

## Additional Notes

### Trust Proxy
Already configured correctly in code:
```typescript
app.set("trust proxy", 1); // Handles Railway's HTTPS proxy
```

### Session Cookies
Already configured correctly for production:
```typescript
cookie: {
  httpOnly: true,
  secure: true,      // HTTPS only
  sameSite: "lax",   // CSRF protection
}
```

### Request Protocol
With `trust proxy: 1`, Railway HTTPS proxy is handled correctly:
- `req.protocol` returns "https"
- `req.get('host')` returns "www.printershero.com"
- Absolute URLs are constructed correctly

---

## Support

If you encounter issues:
1. Check Railway deployment logs for validation errors
2. Run `npm run email:check` locally with Railway env vars
3. Search Railway logs by requestId for email errors
4. Verify Google Cloud Console OAuth configuration
5. Contact Railway support for OIDC/OAuth setup assistance
