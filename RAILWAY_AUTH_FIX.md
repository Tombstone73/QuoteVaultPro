# 🚨 RAILWAY AUTH PRODUCTION CONFIGURATION

## Problem
QuoteVaultPro needs production-ready authentication for Railway deployments.

## Root Cause Analysis

### AUTH_PROVIDER System (3 Modes)

QuoteVaultPro has **exactly 3 auth providers**:

1. **`local`** (Development Only) - `server/auth/localAuth.ts`
   - Auto-login with test users
   - Cookie `secure: false` (HTTP allowed)
   - No real authentication
   - **NEVER use in production** (blocked by envValidation.ts)

2. **`standard`** (Production - Email/Password) - `server/auth/standardAuth.ts`
   - Email/password authentication with bcrypt
   - Cookie `secure: true` (HTTPS only)
   - Passport.js LocalStrategy
   - PostgreSQL session store
   - **RECOMMENDED for Railway production**

3. **`replit`** (Replit Platform Only) - `server/auth/replitAuth.ts`
   - Replit OIDC authentication
   - Requires Replit OAuth app configuration
   - **Only works on Replit platform** (requires DEPLOY_TARGET=replit)
   - **Will NOT work on Railway** (different OAuth provider)

---

## ✅ SOLUTION: Railway Environment Variables

### CRITICAL Variables (Set These First)

```bash
# Core platform (TIER 1 - FATAL if missing)
DATABASE_URL=postgresql://neondb_owner:YOUR_PASSWORD@ep-YOUR-ENDPOINT.us-east-2.aws.neon.tech/neondb?sslmode=require
SESSION_SECRET=YOUR_SUPER_SECRET_32_PLUS_CHARACTER_STRING_HERE_CHANGE_THIS
NODE_ENV=production

# Auth provider selection - USE STANDARD FOR RAILWAY
AUTH_PROVIDER=standard
```

**DO NOT SET** `REPL_ID` or `REPLIT_OIDC_ISSUER` - these are only required for Replit platform deployments.

---

## 🚀 First-Time Deployment Checklist

### 1. Apply Database Migration

Run migration 0033 in Neon SQL Editor:
```sql
-- File: server/db/migrations/0033_add_password_hash.sql
-- This adds password_hash column and email index to users table
```

### 2. Create First Owner User

After deploying your app to Railway, create the first owner account:

```bash
npx tsx scripts/create-owner.ts \
  --email=admin@printershero.com \
  --password=YourSecurePassword123 \
  --org=org_titan_001 \
  --first=Admin \
  --last=User
```

**Script features**:
- Validates email format and password strength (min 8 chars)
- Checks if user already exists (idempotent - safe to re-run)
- Hashes password with bcrypt (cost factor 10)
- Creates userOrganizations entry with role='owner'
- Refuses to add existing users to different organizations (safety)

### 3. Test Login

Navigate to your Railway deployment:
```
https://your-app.railway.app
```

Login with the credentials you just created.

---

## 🎯 AUTH_PROVIDER Decision Tree

**Are you deploying to Railway?**
- ✅ Use `AUTH_PROVIDER=standard`
- ❌ Do NOT use `AUTH_PROVIDER=replit` (Replit OIDC won't work on Railway)

**Are you deploying to Replit?**
- ✅ Use `AUTH_PROVIDER=replit` with `DEPLOY_TARGET=replit`
- ✅ Set `REPL_ID` and `REPLIT_OIDC_ISSUER`

**Are you in local development?**
- ✅ Use `AUTH_PROVIDER=local` (default)
- ❌ Never use in production (envValidation.ts will block startup)

This is the URL of Replit's OIDC identity provider. Do NOT change this unless Replit changes their OIDC endpoint.

---

## 📋 Step-by-Step Railway Setup

### 1. Set Core Variables
```bash
# In Railway dashboard → Service → Variables:
DATABASE_URL=<your-neon-postgresql-url>
SESSION_SECRET=<generate-a-strong-random-string>
NODE_ENV=production
AUTH_PROVIDER=standard
```

### 2. Apply Database Migration
In Neon SQL Editor, run:
```sql
-- Copy contents from: server/db/migrations/0033_add_password_hash.sql
```

### 3. Deploy Application
Deploy your app to Railway. Wait for build to complete.

### 4. Create First Owner User
After deployment, run bootstrap script:
```bash
npx tsx scripts/create-owner.ts \
  --email=admin@printershero.com \
  --password=YourSecurePassword123 \
  --org=org_titan_001
```

### 5. Test Login
Navigate to `https://your-app.railway.app` and login with your credentials.

### 6. Set Optional Email Variables (if using Gmail)
```bash
PUBLIC_APP_URL=https://your-app.railway.app
GMAIL_OAUTH_REDIRECT_URI=https://your-app.railway.app/oauth2callback
GMAIL_CLIENT_ID=<from-google-console>
GMAIL_CLIENT_SECRET=<from-google-console>
GMAIL_REFRESH_TOKEN=<from-oauth-flow>
```

### 7. Verify Environment Variables
After setting variables, check startup logs:
```
═══════════════════════════════════════════════════════════════
🔐 AUTH PROVIDER INITIALIZATION
═══════════════════════════════════════════════════════════════
NODE_ENV:          production
AUTH_PROVIDER:     standard
✅ Selected:        standardAuth (Email/Password Production Auth)
✅ This is the RECOMMENDED auth provider for Railway production
───────────────────────────────────────────────────────────────
📋 STANDARD AUTH CONFIGURATION:
Session store:     PostgreSQL (connect-pg-simple)
Secure cookies:    true
Trust proxy:       1
DATABASE_URL:      ✅ SET
SESSION_SECRET:    ✅ SET
```

---

## 🚨 Common Pitfalls

### 1. AUTH_PROVIDER=local in Production
**Symptoms**: Insecure cookies, auto-login, no real auth, startup blocked
**Fix**: Set `AUTH_PROVIDER=standard`

### 2. AUTH_PROVIDER=replit on Railway
**Symptoms**: OIDC discovery fails, auth hangs/times out, "Replit OIDC only works on Replit platform" error
**Fix**: Set `AUTH_PROVIDER=standard` (Replit OIDC requires Replit OAuth app and DEPLOY_TARGET=replit)

### 3. Missing Migration
**Symptoms**: Database error "column password_hash does not exist"
**Fix**: Apply migration 0033 in Neon SQL Editor

### 4. No Owner User Created
**Symptoms**: Cannot login, no valid credentials
**Fix**: Run `npx tsx scripts/create-owner.ts` after deployment

### 5. Wrong DATABASE_URL
**Symptoms**: Session store initialization fails, auth doesn't persist
**Fix**: Use correct Neon PostgreSQL connection string with `?sslmode=require`

### 6. Weak SESSION_SECRET
**Symptoms**: Session security warnings, potential session hijacking
**Fix**: Generate strong random string (32+ characters): `openssl rand -base64 32`

---

## 🔍 Diagnostic Checklist

### Startup Logs
Look for these sections in Railway deployment logs:

#### 1. Environment Validation (first)
```
═══════════════════════════════════════
🔍 ENVIRONMENT VALIDATION
═══════════════════════════════════════
✅ TIER 1 (FATAL): All core platform variables valid
✅ TIER 2 (NON-FATAL): All optional feature variables valid
```

#### 2. Auth Provider Selection (second)
```
═══════════════════════════════════════════════════════════════
🔐 AUTH PROVIDER INITIALIZATION
═══════════════════════════════════════════════════════════════
AUTH_PROVIDER:     standard
✅ Selected:        standardAuth (Email/Password Production Auth)
✅ This is the RECOMMENDED auth provider for Railway production
```
REPLIT_OIDC_ISSUER: https://replit.com
```

#### 3. OIDC Discovery (third)
```
[replitAuth] Attempting OIDC discovery at https://replit.com
[replitAuth] OIDC discovery successful
```

### Error Patterns

#### Bad: OIDC Discovery Failure
```
[replitAuth] ═══════════════════════════════════════
[replitAuth] OIDC initialization failed
[replitAuth] Error: REPL_ID environment variable is required
[replitAuth] ═══════════════════════════════════════
```
**Fix**: Set `REPL_ID` variable

#### Bad: Wrong Auth Provider
```
✅ Selected:        localAuth (Development mode)
⚠️  WARNING: localAuth is for DEVELOPMENT ONLY
❌ CRITICAL: localAuth is active in NODE_ENV=production
```
**Fix**: Set `AUTH_PROVIDER=replit`

#### Bad: Missing Tier 1 Variables
```
❌ TIER 1 FATAL ERROR: Core platform configuration invalid
┌─────────────────────────────────────────────────────────
│ ❌ AUTH_PROVIDER: Must be "replit" in production
│ ❌ REPL_ID: Required when AUTH_PROVIDER=replit
└─────────────────────────────────────────────────────────
Server cannot start. Fix these errors and redeploy.
```
**Fix**: Set all required Tier 1 variables

---

## 🎯 Quick Test

After setting variables and redeploying:

1. **Check startup logs** for green checkmarks
2. **Visit** `https://your-app.railway.app/api/login`
3. **Should redirect** to Replit OIDC login (NOT auto-login)
4. **After login**, should redirect back with session cookie

---

## 📚 Reference

### Files to Review
- `server/routes.ts` (lines 52-115): Auth provider selection with diagnostic logging
- `server/replitAuth.ts` (lines 1-120): Replit OIDC implementation
- `server/localAuth.ts` (lines 1-80): Development auth (DO NOT use in production)
- `server/envValidation.ts`: Two-tier startup validation

### Related Documentation
- `RAILWAY_DEPLOYMENT_CHECKLIST.md`: Comprehensive Railway deployment guide
- `RAILWAY_PRODUCTION_CONFIG_FIX.md`: Environment validation implementation
- `.env.example`: All environment variables with descriptions

---

## ❓ FAQ

**Q: Can I use a different OIDC provider?**
A: Not without code changes. Only `local` and `replit` providers are implemented.

**Q: What if I don't have Replit OIDC credentials?**
A: You must register an OAuth2 application with Replit or implement a different OIDC provider.

**Q: Can I skip auth in production for testing?**
A: **NO**. Using `AUTH_PROVIDER=local` in production is a critical security risk. The server will refuse to start if you try this (TIER 1 validation will fail).

**Q: What's the difference between REPL_ID and REPLIT_OIDC_ISSUER?**
A: 
- `REPL_ID`: Your OAuth2 client ID (unique to your app)
- `REPLIT_OIDC_ISSUER`: Replit's OIDC server URL (same for all apps)

**Q: How do I generate SESSION_SECRET?**
A: Use a cryptographically secure random string generator:
```bash
# Option 1: openssl
openssl rand -base64 32

# Option 2: Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Option 3: Online generator
# Visit: https://randomkeygen.com/ (Fort Knox Passwords section)
```

---

## 🎉 Success Indicators

When everything is configured correctly, you should see:

✅ Server starts without TIER 1 validation errors
✅ Auth provider selected: `replitAuth`
✅ OIDC discovery successful
✅ Login redirects to Replit OIDC (not auto-login)
✅ Session persists across requests
✅ No auth timeouts or 502 errors

---

**Last Updated**: December 2024
**Version**: 2.0.0 - Comprehensive Auth Timeout Fix

## Environment Variables

### New/Modified
- `AUTH_PROVIDER` - Set to `"replit"` to explicitly use Replit auth
- `REPL_ID` - Required when `AUTH_PROVIDER=replit`
- `ISSUER_URL` - OIDC issuer (default: `https://replit.com/oidc`)

### Railway Deployment
No environment variables required! Server will safely fall back to `localAuth` if Replit config is missing.

For production with real auth, you can:
1. Set `AUTH_PROVIDER=replit` + `REPL_ID` + `ISSUER_URL` for Replit OIDC
2. Or keep defaults and use `localAuth` (requires session-based login)

## Testing

### Unit Test
Created `test-auth-selection.js` to verify selection logic:
```bash
node test-auth-selection.js
```

All 5 test cases pass:
- ✅ Development environment
- ✅ Production with AUTH_PROVIDER=replit and REPL_ID
- ✅ Production with AUTH_PROVIDER=replit but no REPL_ID
- ✅ Production without any auth config (Railway scenario)
- ✅ Production with REPL_ID but no AUTH_PROVIDER

### TypeScript
```bash
npm run check
```
No type errors.

## Expected Behavior

### Railway (No Config)
```
NODE_ENV in routes.ts: "production"
[Auth] No AUTH_PROVIDER or REPL_ID set, defaulting to localAuth
Using auth: localAuth (default)
```

### Replit Auth Missing Config
```
NODE_ENV in routes.ts: "production"
[Auth] AUTH_PROVIDER=replit but REPL_ID missing, falling back to localAuth
Using auth: localAuth (fallback)
```

### Replit OIDC Failure
```
NODE_ENV in routes.ts: "production"
Using auth: replitAuth
[replitAuth] Attempting OIDC discovery at https://replit.com/oidc
[replitAuth] OIDC discovery failed: unexpected HTTP response status code
[replitAuth] Failed to initialize auth provider: unexpected HTTP response status code
[replitAuth] Replit auth will not be available. Server continuing without OIDC.
```

Server continues booting in all cases.

## Files Changed

1. **server/routes.ts** - Auth provider selection logic with environment guards
2. **server/replitAuth.ts** - Fail-safe OIDC discovery and graceful initialization
3. **README.md** - Environment variables documentation
4. **test-auth-selection.js** - Unit test for selection logic (new)

## Acceptance Criteria

✅ Railway deployment no longer crashes  
✅ Server boots with clear log messages about auth provider  
✅ OIDC discovery failures are caught and logged  
✅ Fallback auth allows server to remain operational  
✅ TypeScript compilation passes  
✅ No breaking changes to existing dev/Replit deployments  
✅ Documentation updated with environment variable reference  

## Next Steps

1. Deploy to Railway and verify boot success
2. Test `/api/login` endpoint (should use localAuth or return 503)
3. Configure production auth provider as needed:
   - For Replit: Set `AUTH_PROVIDER=replit` + `REPL_ID`
   - For local dev auth: Leave defaults (current behavior)
   - For custom auth: Implement new auth module and update selection logic

## Rollback Plan

If issues arise, revert commits to:
- server/routes.ts
- server/replitAuth.ts

Original behavior will be restored (crashes on Railway but works on Replit).
