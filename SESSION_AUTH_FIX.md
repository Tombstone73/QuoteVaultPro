# Session Authentication Fix for Vercel + Railway

## Problem
Login succeeded (200 OK) but subsequent `/api/auth/user` returned 401 Unauthorized. Session cookies were not being persisted across requests in production (Vercel frontend + Railway backend).

## Root Causes
1. **Cross-site cookie issues**: Frontend (www.printershero.com) and backend (quotevaultpro-production.up.railway.app) are different origins
2. **Cookie sameSite='lax'**: Prevented cross-site cookie sending in production
3. **API strategy**: Frontend was configured to call Railway directly, requiring complex cross-site cookie setup

## Solution Strategy
**Use Vercel proxy for same-origin requests** instead of direct cross-site calls to Railway backend.

### Changes Made

#### 1. Session Cookie Configuration (server/localAuth.ts, server/replitAuth.ts)
```typescript
// BEFORE: sameSite: 'lax' (blocks cross-site cookies)
cookie: {
  httpOnly: true,
  secure: isProduction,
  maxAge: sessionTtl,
  sameSite: 'lax',
}

// AFTER: sameSite: 'none' for cross-site, with diagnostic logging
cookie: {
  httpOnly: true,
  secure: isProduction,          // HTTPS required
  maxAge: sessionTtl,
  sameSite: isProduction ? 'none' : 'lax',  // 'none' allows cross-site cookies
}
```

**Why this matters:**
- `sameSite: 'none'` allows cookies to be sent in cross-site contexts
- MUST be paired with `secure: true` (HTTPS only)
- Only used in production where cross-site requests occur
- Development uses `sameSite: 'lax'` (localhost doesn't need cross-site)

#### 2. Frontend API Configuration (client/src/lib/apiConfig.ts)
```typescript
// BEFORE: Direct Railway calls (cross-site)
// Required: VITE_API_BASE_URL=https://quotevaultpro-production.up.railway.app
function getApiBaseUrl(): string {
  const baseUrl = import.meta.env.VITE_API_BASE_URL || "";
  if (import.meta.env.PROD && !baseUrl) {
    console.error("VITE_API_BASE_URL is required in production");
  }
  return baseUrl;
}

// AFTER: Same-origin calls via Vercel proxy (recommended)
function getApiBaseUrl(): string {
  // Default to empty string = same-origin /api/* paths
  // Proxied by Vercel to Railway backend (see vercel.json)
  const baseUrl = import.meta.env.VITE_API_BASE_URL || "";
  return baseUrl ? baseUrl.replace(/\/$/, "") : "";
}
```

**Why this matters:**
- Same-origin requests avoid cross-site cookie issues entirely
- Vercel proxy (`/api/*` → Railway backend) handled in vercel.json
- Simpler, more reliable than cross-site cookie setup
- VITE_API_BASE_URL now optional (can be used for direct Railway calls if needed)

#### 3. Vercel Proxy Configuration (vercel.json)
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

**Already configured correctly** - no changes needed.

#### 4. CORS Configuration (server/index.ts)
```typescript
// Already configured correctly
const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`Origin ${origin} not allowed by CORS`));
    }
  },
  credentials: true,  // Required for cookies
  exposedHeaders: ["Set-Cookie"],
};

app.use(cors(corsOptions));
app.set("trust proxy", 1);  // Required for Railway (behind proxy)
```

**Already correct** - no changes needed.

#### 5. Frontend API Client (client/src/lib/queryClient.ts)
```typescript
// Already configured correctly
const res = await fetch(fullUrl, {
  method,
  credentials: "include",  // Send cookies with requests
  ...init,
  headers,
  body: data !== undefined ? JSON.stringify(data) : undefined,
});
```

**Already correct** - no changes needed.

#### 6. Diagnostic Logging
Added non-sensitive logging for troubleshooting:
- Session cookie configuration on startup
- Successful authentication events
- Login session creation

Enabled via `DEBUG_AUTH=true` in production or automatically in development.

## Testing Checklist

### A) Production (Vercel + Railway)
1. Navigate to https://www.printershero.com/login
2. Enter credentials and submit
3. **Expected**: Login succeeds, user is redirected to authenticated area
4. **Verify**: Browser stores `connect.sid` cookie
5. **Verify**: GET /api/auth/user returns 200 with user object (not 401)
6. Hard refresh page (F5)
7. **Expected**: User stays logged in

### B) Development (localhost)
1. Run `npm run dev`
2. Navigate to http://localhost:5173/login
3. Login should work with `sameSite: 'lax'` (no cross-site needed)

### C) Cookie Inspection
Check browser DevTools → Application → Cookies:
- **Name**: `connect.sid`
- **Domain**: `.printershero.com` (if cross-site) or `www.printershero.com` (if proxied)
- **Secure**: ✓ (production only)
- **HttpOnly**: ✓
- **SameSite**: `None` (production) or `Lax` (development)

## Deployment Notes

### Vercel Environment Variables
- **VITE_API_BASE_URL**: Optional (leave unset to use same-origin proxy)
- If set, must be `https://quotevaultpro-production.up.railway.app`

### Railway Environment Variables
- **SESSION_SECRET**: Required (existing)
- **NODE_ENV**: `production`
- **DATABASE_URL**: Required (existing)
- **DEBUG_AUTH**: Optional, set to `true` for diagnostic logging

### Migration Path
1. Deploy backend changes to Railway (session cookie config)
2. Deploy frontend changes to Vercel (API config)
3. Test login flow
4. If issues, check browser console and Railway logs for diagnostic output

## Rollback Plan
If issues occur:
1. Revert [server/localAuth.ts](server/localAuth.ts) (session cookie config)
2. Revert [server/replitAuth.ts](server/replitAuth.ts) (session cookie config)
3. Revert [client/src/lib/apiConfig.ts](client/src/lib/apiConfig.ts) (API base URL logic)
4. Redeploy both frontend and backend

## Technical Details

### Why sameSite='none' is safe
- Still requires `secure: true` (HTTPS only)
- Still requires `httpOnly: true` (JS cannot access)
- Still requires explicit CORS configuration (not open to all origins)
- Only affects production where cross-site requests are legitimate

### Why same-origin proxy is preferred
- Avoids cross-site cookie issues entirely
- Simpler configuration
- Better browser compatibility
- More reliable across different browsers and privacy settings

### Architecture
```
User Browser (www.printershero.com)
    ↓ /api/auth/login (same-origin)
Vercel Proxy (rewrites /api/* → Railway)
    ↓ https://quotevaultpro-production.up.railway.app/api/auth/login
Railway Backend
    ↓ Set-Cookie: connect.sid (secure, httpOnly, sameSite=none)
User Browser receives cookie
    ↓ Subsequent requests include Cookie: connect.sid
Vercel Proxy → Railway Backend
    ↓ Recognizes session from cookie
Railway Backend returns user data
```

## Files Changed
- [server/localAuth.ts](server/localAuth.ts) - Session cookie config, diagnostic logging
- [server/replitAuth.ts](server/replitAuth.ts) - Session cookie config for Replit auth
- [client/src/lib/apiConfig.ts](client/src/lib/apiConfig.ts) - API base URL strategy
- [vercel.json](vercel.json) - No changes (already correct)
- [server/index.ts](server/index.ts) - No changes (CORS already correct)
