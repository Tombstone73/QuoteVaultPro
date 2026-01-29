# Session Authentication Fix for Vercel + Railway

## Problem
Login succeeded (200 OK) but subsequent `/api/auth/user` returned 401 Unauthorized. Session cookies were not being persisted across requests in production (Vercel frontend + Railway backend).

## Solution Strategy
**Use Vercel proxy for same-origin requests** - all API requests go through `/api/*` on printershero.com, which Vercel rewrites to Railway backend. This makes cookies same-origin and reliable.

### Architecture
```
User Browser (www.printershero.com)
    ↓ /api/auth/login (same-origin request)
Vercel Proxy (rewrites /api/* → Railway via vercel.json)
    ↓ https://quotevaultpro-production.up.railway.app/api/auth/login
Railway Backend
    ↓ Set-Cookie: connect.sid (secure, httpOnly, sameSite=lax)
User Browser receives cookie for printershero.com domain
    ↓ Subsequent requests include Cookie: connect.sid
Vercel Proxy → Railway Backend
    ↓ Recognizes session from cookie
Railway Backend returns user data ✓
```

## Changes Made

### 1. Session Cookie Configuration
**Files**: [server/localAuth.ts](server/localAuth.ts), [server/replitAuth.ts](server/replitAuth.ts)

```typescript
// Changed from cross-site to same-origin cookie config
cookie: {
  httpOnly: true,
  secure: isProduction,     // HTTPS required in production
  maxAge: sessionTtl,       // 7 days
  sameSite: 'lax',          // Safe for same-origin requests
}
```

**Why this matters:**
- `sameSite: 'lax'` is secure for same-origin requests (prevents CSRF)
- Vercel proxy makes all `/api/*` requests same-origin (no cross-site issues)
- No need for `sameSite: 'none'` since requests aren't actually cross-site
- More browser-compatible and privacy-friendly

### 2. Frontend API Configuration
**File**: [client/src/lib/apiConfig.ts](client/src/lib/apiConfig.ts)

```typescript
// Default to same-origin /api/* paths (proxied by Vercel)
function getApiBaseUrl(): string {
  const baseUrl = import.meta.env.VITE_API_BASE_URL || "";
  
  if (baseUrl) {
    console.log("[API CONFIG] Using explicit VITE_API_BASE_URL:", baseUrl);
    return baseUrl.replace(/\/$/, "");
  }
  
  // Default: empty string = same-origin /api/* paths (recommended)
  return "";
}
```

**Why this matters:**
- Frontend calls `/api/auth/login` (relative URL)
- Vercel serves frontend AND proxies `/api/*` to Railway
- Browser sees all requests as same-origin to printershero.com
- VITE_API_BASE_URL is now **optional** (not required in production)

### 3. Vercel Proxy Configuration
**File**: [vercel.json](vercel.json)

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://quotevaultpro-production.up.railway.app/api/:path*"
    },
    {
      "source": "/:path*",
      "destination": "/index.html"
    }
  ]
}
```

**Already configured correctly** - Vercel transparently forwards `/api/*` requests to Railway.

### 4. Backend Proxy Configuration
**File**: [server/index.ts](server/index.ts)

```typescript
// Trust proxy for secure cookies behind Railway/Vercel proxy
if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}
```

**Already configured correctly** - Railway is behind a proxy, so Express needs to trust the X-Forwarded-* headers.

### 5. CORS Configuration
**File**: [server/index.ts](server/index.ts)

```typescript
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (same-origin requests from Vercel proxy)
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  credentials: true,
  exposedHeaders: ["Set-Cookie"],
};
```

**Why this works:**
- Same-origin requests from Vercel proxy have no `Origin` header
- Direct browser requests (if any) are checked against allowedOrigins
- `credentials: true` allows cookies to be sent with requests

### 6. Diagnostic Logging
Added lightweight logging to help troubleshoot session issues:

**Login handler** ([server/localAuth.ts](server/localAuth.ts)):
```typescript
// Logs when session is created and cookie is sent
console.log('[Login] Session created, sending Set-Cookie header');
console.log('[Login] Session ID exists:', !!req.sessionID);
```

**User endpoint** ([server/routes.ts](server/routes.ts)):
```typescript
// Logs when /api/auth/user is called to verify session
console.log('[Auth /api/auth/user] Session ID exists:', !!req.sessionID);
console.log('[Auth /api/auth/user] User authenticated:', !!req.user);
console.log('[Auth /api/auth/user] Cookie header present:', !!req.headers.cookie);
```

Enabled via `DEBUG_AUTH=true` in production or automatically in development.

### 7. Removed Temporary Admin Endpoint
Removed the `/api/admin/users/set-password` endpoint that was added for testing. Password management now uses the standard password reset flow.

## Deployment Configuration

### Vercel Environment Variables
**No required changes!** The app now works without VITE_API_BASE_URL.

**Optional override** (for non-Vercel deployments):
- `VITE_API_BASE_URL`: Can be set to direct Railway URL if not using Vercel proxy

### Railway Environment Variables
**Existing variables** (no changes needed):
- `SESSION_SECRET`: Required (existing)
- `NODE_ENV`: `production`
- `DATABASE_URL`: Required (existing)

**Optional for debugging**:
- `DEBUG_AUTH`: Set to `true` to enable diagnostic logging

## Testing Checklist

### A) Production (Vercel + Railway)
1. Navigate to https://www.printershero.com/login
2. Enter credentials and submit
3. **Expected**: Login succeeds, user is redirected to authenticated area
4. **Verify**: Browser stores `connect.sid` cookie for `.printershero.com` domain
5. **Verify**: GET /api/auth/user returns 200 with user object (not 401)
6. **Verify**: Network tab shows requests to `/api/*` (same-origin, not direct Railway URL)
7. Hard refresh page (F5)
8. **Expected**: User stays logged in

### B) Development (localhost)
1. Run `npm run dev`
2. Navigate to http://localhost:5173/login
3. Login should work with same-origin requests to local backend
4. **Expected**: Cookies work without any special configuration

### C) Cookie Inspection
Open browser DevTools → Application → Cookies:
- **Name**: `connect.sid`
- **Domain**: `.printershero.com` or `www.printershero.com`
- **Secure**: ✓ (production only)
- **HttpOnly**: ✓
- **SameSite**: `Lax`

## Migration Steps

1. **Deploy backend to Railway**
   ```bash
   git push origin main  # Railway auto-deploys
   ```

2. **Deploy frontend to Vercel**
   ```bash
   # Vercel auto-deploys from main branch
   # No environment variable changes needed
   ```

3. **Test login flow**
   - Clear all cookies for printershero.com
   - Go to https://www.printershero.com/login
   - Login should work immediately

4. **If issues occur**
   - Check browser DevTools Network tab for `/api/auth/login` request
   - Check response headers for `Set-Cookie` header
   - Check Railway logs for session creation messages
   - Enable `DEBUG_AUTH=true` on Railway for verbose logging

## Rollback Plan
If critical issues occur:
1. Revert backend changes: `git revert HEAD`
2. Redeploy to Railway
3. Frontend will continue to work with old backend

## Technical Details

### Why sameSite='lax' is correct
- **Same-origin requests**: Vercel proxy makes all `/api/*` requests appear same-origin
- **CSRF protection**: `sameSite='lax'` prevents cross-site request forgery
- **Browser compatibility**: Better support than `sameSite='none'`
- **Privacy**: More privacy-friendly than cross-site cookies

### Why VITE_API_BASE_URL is optional
- **Default behavior**: Frontend uses relative `/api/*` paths
- **Vercel rewrite**: Transparently forwards to Railway backend
- **Browser perspective**: All requests are same-origin to printershero.com
- **Override available**: Can still set VITE_API_BASE_URL for non-Vercel deployments

### Why this is more reliable
- No cross-site cookie issues
- No browser privacy features blocking cookies
- No complex CORS configuration needed
- Works consistently across all browsers
- Better security (same-origin policy enforced)

## Files Changed
- [server/localAuth.ts](server/localAuth.ts) - Session cookie config (sameSite='lax'), diagnostic logging
- [server/replitAuth.ts](server/replitAuth.ts) - Session cookie config (sameSite='lax')
- [server/routes.ts](server/routes.ts) - Added diagnostic logging to /api/auth/user, removed admin password endpoint
- [client/src/lib/apiConfig.ts](client/src/lib/apiConfig.ts) - Default to same-origin /api/* paths
- [vercel.json](vercel.json) - Already correct (no changes)
- [server/index.ts](server/index.ts) - Already correct (trust proxy, CORS)

## Summary
The fix changes the architecture from cross-site requests (frontend → Railway) to same-origin requests (frontend → Vercel proxy → Railway). This makes session cookies work reliably without complex cross-site configuration. The key insight is that Vercel's rewrite functionality makes the backend appear to be on the same origin as the frontend, eliminating all cookie-related issues.
