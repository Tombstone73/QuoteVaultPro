# Production Auth Crash Fix - Complete Implementation

## Problem Summary

Server crashed on boot in production due to failed Replit OIDC discovery:
```
Using auth: replitAuth
Fatal error: ClientError: unexpected HTTP response status code
code: 'OAUTH_RESPONSE_IS_NOT_CONFORM'
cause.status: 404
url: 'https://replit.com/.well-known/openid-configuration'
```

## Root Cause

1. Auth provider selection was tied to `NODE_ENV` - production always selected replitAuth
2. Replit OIDC discovery endpoint returned 404 in non-Replit environments
3. No fallback mechanism - discovery failure crashed entire server

## Solution Implemented

### 1. Decoupled Auth Selection from NODE_ENV

**File: [server/routes.ts](server/routes.ts#L48-L70)**

- Added `AUTH_PROVIDER` environment variable
- Simple logic: `replit` → replitAuth, anything else → localAuth (default)
- No longer depends on NODE_ENV for auth selection

```typescript
// Auth provider selection (decoupled from NODE_ENV)
const authProviderRaw = (process.env.AUTH_PROVIDER || '').trim().toLowerCase();

if (authProviderRaw === 'replit') {
  auth = replitAuth;
  authProvider = 'replitAuth';
} else {
  if (authProviderRaw && authProviderRaw !== 'local') {
    console.warn(`[Auth] Unknown AUTH_PROVIDER="${authProviderRaw}", defaulting to localAuth`);
  }
  auth = localAuth;
  authProvider = 'localAuth';
}

console.log('Using auth:', authProvider);
```

### 2. Added Crash Protection to replitAuth

**File: [server/replitAuth.ts](server/replitAuth.ts#L11-L106)**

**Enhanced OIDC Discovery:**
- Added `REPLIT_OIDC_ISSUER` env var (no hardcoded URLs)
- Validates required env vars before attempting discovery
- Improved error logging with structured details
- Try/catch prevents any exceptions from propagating

**Safe setupAuth Fallback:**
- If OIDC fails, logs clear error with visual separators
- Sets up minimal passport serialization (prevents crashes)
- Registers stub routes that return 503 errors
- **Server continues booting** - no fatal crash

```typescript
export async function setupAuth(app: Express) {
  // ... session setup ...
  
  let config;
  try {
    config = await getOidcConfig();
  } catch (error: any) {
    console.error('[replitAuth] ═══════════════════════════════════════');
    console.error('[replitAuth] OIDC initialization failed');
    console.error('[replitAuth] Server continuing with stub auth routes.');
    console.error('[replitAuth] To fix: Set AUTH_PROVIDER=local or configure Replit vars.');
    console.error('[replitAuth] ═══════════════════════════════════════');
    
    // Setup minimal passport + stub routes
    // Server keeps running!
    return;
  }
  // ... normal OIDC setup ...
}
```

### 3. Updated Environment Variables

**File: [.env](.env)**

Removed hardcoded Replit values and added clear documentation:

```bash
# Authentication Provider
# Set to "local" (default) or "replit"
# AUTH_PROVIDER=local

# Replit OIDC (only required if AUTH_PROVIDER=replit)
# REPL_ID=your-replit-deployment-id
# REPLIT_OIDC_ISSUER=https://replit.com/oidc
```

## Environment Variable Reference

### Required for All Deployments
- `DATABASE_URL` - PostgreSQL connection string
- `SESSION_SECRET` - Random secret for session signing

### Authentication (Optional)
- `AUTH_PROVIDER` - `"local"` (default) or `"replit"`

### Replit Auth (Only if AUTH_PROVIDER=replit)
- `REPL_ID` - Replit deployment ID
- `REPLIT_OIDC_ISSUER` - OIDC discovery endpoint (e.g., `https://replit.com/oidc`)

## Behavior Matrix

| Environment | AUTH_PROVIDER | REPL_ID | Result |
|-------------|---------------|---------|--------|
| Production | *(not set)* | *(any)* | ✅ localAuth, no OIDC calls |
| Production | `local` | *(any)* | ✅ localAuth, no OIDC calls |
| Production | `replit` | Missing | ✅ replitAuth stub (503 errors), server stays up |
| Production | `replit` | Present | ✅ replitAuth with OIDC (if issuer valid) |
| Any | `replit` | Present | ❌ OIDC discovery fails | ✅ Logs error, stub routes, server stays up |
| Any | `unknown` | *(any)* | ⚠️  Warns, defaults to localAuth |

## Startup Logs

### Success (Default Local Auth)
```
Using auth: localAuth
[Server] Ready to accept connections
serving on port 5000
```

### Success (Replit Auth)
```
Using auth: replitAuth
[replitAuth] Attempting OIDC discovery at https://replit.com/oidc
[replitAuth] OIDC discovery successful
[Server] Ready to accept connections
```

### Fallback (Replit OIDC Failed)
```
Using auth: replitAuth
[replitAuth] Attempting OIDC discovery at https://replit.com/oidc
[replitAuth] OIDC discovery failed: { message: '...', code: '...', status: 404 }
[replitAuth] ═══════════════════════════════════════
[replitAuth] OIDC initialization failed
[replitAuth] Server continuing with stub auth routes.
[replitAuth] To fix: Set AUTH_PROVIDER=local or configure Replit vars.
[replitAuth] ═══════════════════════════════════════
[Server] Ready to accept connections
```

## Testing

### Unit Tests
```bash
node test-auth-selection.js
# All 7 tests pass ✅
```

### TypeScript Compilation
```bash
npm run check
# Compiles successfully ✅
```

### Manual Testing Scenarios

**Test 1: Railway Production (No Auth Config)**
```bash
# .env on Railway
NODE_ENV=production
DATABASE_URL=postgresql://...
SESSION_SECRET=...
# AUTH_PROVIDER not set

# Expected: Uses localAuth, server boots
```

**Test 2: Replit Environment**
```bash
# .env on Replit
NODE_ENV=production
AUTH_PROVIDER=replit
REPL_ID=abc123
REPLIT_OIDC_ISSUER=https://replit.com/oidc

# Expected: Uses replitAuth with OIDC
```

**Test 3: Invalid Replit Config**
```bash
# .env with bad config
NODE_ENV=production
AUTH_PROVIDER=replit
# REPL_ID missing

# Expected: Logs error, uses stub routes, server stays up
```

## Files Changed

1. **server/routes.ts** (lines 48-70)
   - Replaced NODE_ENV-based auth selection with AUTH_PROVIDER
   - Added unknown value warning

2. **server/replitAuth.ts** (lines 11-106)
   - Added REPLIT_OIDC_ISSUER env var support
   - Enhanced validation and error logging
   - Improved setupAuth fallback with clear messaging

3. **.env** (lines 9-13)
   - Removed hardcoded Replit values
   - Added AUTH_PROVIDER documentation
   - Made Replit vars optional and commented out

4. **test-auth-selection.js** (updated test suite)
   - 7 test cases covering all scenarios
   - All passing ✅

## Migration Guide

### For Railway Deployments
No action required! Default behavior is now safe.

Optional: Add `AUTH_PROVIDER=local` to be explicit.

### For Replit Deployments
Add to Replit Secrets:
```
AUTH_PROVIDER=replit
REPL_ID=<your-repl-id>
REPLIT_OIDC_ISSUER=https://replit.com/oidc
```

### For Local Development
No action required! Uses localAuth by default.

## Rollback Plan

If issues arise:
```bash
git revert HEAD
```

Original behavior:
- NODE_ENV=production → uses replitAuth (may crash)
- NODE_ENV=development → uses localAuth

## Acceptance Criteria

✅ **Production boot succeeds** even if REPLIT_OIDC_ISSUER is missing or discovery 404s  
✅ **When AUTH_PROVIDER is unset**, app uses local auth and does not call openid-client discovery  
✅ **When AUTH_PROVIDER="replit"** and issuer is valid, it uses Replit auth successfully  
✅ **Logs clearly show** what happened (provider selection and fallback)  
✅ **No database migrations** required  
✅ **Existing sessions/cookies** behavior unchanged  
✅ **TypeScript compiles** successfully  
✅ **All tests pass**  

## Next Steps

1. **Test on Railway** - Deploy and verify boot success
2. **Monitor logs** - Confirm "Using auth: localAuth" appears
3. **Test login** - Use `/api/auto-login?email=test@local.dev`
4. **Configure production auth** as needed (local or Replit)

## Commit Message

```
Fix: prevent auth discovery crash in prod; add AUTH_PROVIDER and safe fallback

- Decouple auth selection from NODE_ENV
- Add AUTH_PROVIDER env var (local/replit)
- Add REPLIT_OIDC_ISSUER env var (no hardcoded URLs)
- Wrap OIDC discovery in try/catch with graceful fallback
- Server continues booting even if auth init fails
- Improve error logging with structured details
- Update .env documentation

Fixes Railway crash where replitAuth OIDC discovery returned 404.
Production now defaults to localAuth when AUTH_PROVIDER not set.
```

---

**Status: ✅ Complete and Production-Ready**

The server will no longer crash due to auth initialization failures.
