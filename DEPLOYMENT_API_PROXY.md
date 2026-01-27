# API Proxy Configuration for Production

## Problem Solved
Frontend (Vercel) was returning HTML instead of JSON when calling `/api/auth/forgot-password` and other API endpoints because Vercel has no API routes and was serving the SPA HTML fallback.

## Solution Implemented

### 1. Vercel Rewrite (Primary Solution)
**File:** `vercel.json`

Rewrites all `/api/*` requests from printershero.com to the Railway backend:

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://quotevaultpro-production.up.railway.app/api/:path*"
    }
  ]
}
```

**How it works:**
- Browser makes request to `https://www.printershero.com/api/auth/forgot-password`
- Vercel intercepts and proxies to `https://quotevaultpro-production.up.railway.app/api/auth/forgot-password`
- Response from Railway backend is returned to browser with proper `Content-Type: application/json`

### 2. Frontend API Config (Fallback/Override)
**Files:** 
- `client/src/lib/apiConfig.ts` - Centralized API configuration
- All auth pages and components updated to use `getApiUrl()` and `parseJsonResponse()`

**Environment Variable (Optional):**
```
VITE_API_BASE_URL=https://quotevaultpro-production.up.railway.app
```

**When to use:**
- If Vercel rewrite alone doesn't work (rare)
- For debugging (bypass Vercel proxy and call Railway directly)
- For staging environments with different backends

**Default behavior:** Empty string → same-origin `/api/*` (uses Vercel rewrite)

### 3. JSON Validation
Added `parseJsonResponse()` helper that validates Content-Type and throws helpful errors:

```typescript
// Before: Silent failure when HTML returned
const data = await response.json(); // Would parse HTML as text, fail silently

// After: Clear error message
const data = await parseJsonResponse(response);
// Throws: "Expected JSON from API, got text/html. Preview: <!DOCTYPE html>..."
```

## Deployment Instructions

### Vercel Setup (Required)
1. Deploy `vercel.json` to production (already in repo root)
2. No environment variables needed if using rewrite
3. Redeploy frontend after vercel.json changes

### Optional: Direct Railway URL (Override)
Only if Vercel rewrite doesn't work or for debugging:

1. Go to Vercel Project Settings → Environment Variables
2. Add:
   - Name: `VITE_API_BASE_URL`
   - Value: `https://quotevaultpro-production.up.railway.app`
   - Environment: Production
3. Redeploy frontend

## Verification

### 1. Check /api/auth/config endpoint
```bash
curl -i https://www.printershero.com/api/auth/config
```

Expected:
```
HTTP/2 200
content-type: application/json
...

{"provider":"standard"}
```

### 2. Check forgot-password endpoint
```bash
curl -i -X POST https://www.printershero.com/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

Expected:
```
HTTP/2 200
content-type: application/json
...

{"success":true}
```

### 3. Browser DevTools Test
1. Open https://www.printershero.com/forgot-password
2. Open DevTools → Network tab
3. Enter any email and submit
4. Check the `/api/auth/forgot-password` request:
   - Response Headers → `Content-Type: application/json` ✓
   - Response Body → `{"success":true}` ✓
   - **NOT** HTML starting with `<!DOCTYPE html>` ✗

## Files Modified

### New Files
- `vercel.json` - Vercel rewrite configuration
- `client/src/lib/apiConfig.ts` - API base URL management
- `DEPLOYMENT_API_PROXY.md` - This file

### Updated Files
- `client/src/lib/queryClient.ts` - Use `getApiUrl()` in query functions
- `client/src/pages/login.tsx` - Use `getApiUrl()` and `parseJsonResponse()`
- `client/src/pages/forgot-password.tsx` - Use `getApiUrl()` and `parseJsonResponse()`
- `client/src/pages/reset-password.tsx` - Use `getApiUrl()` and `parseJsonResponse()`
- `client/src/components/layout/TitanTopBar.tsx` - Use `getApiUrl()` for logout

## Troubleshooting

### Still getting HTML responses?
1. Verify `vercel.json` is deployed: Check Vercel dashboard → Deployments → View source
2. Check Vercel deployment logs for rewrite activity
3. Try setting `VITE_API_BASE_URL` env var as override
4. Clear browser cache and try again

### CORS errors?
Railway backend already has CORS configured. If you see CORS errors:
1. Check Railway backend logs
2. Verify credentials: "include" is set in fetch calls
3. Check Railway backend `cors` configuration in server/index.ts

### 401 Unauthorized?
This is expected if not logged in. The endpoint works if you get JSON `{"error":"Unauthorized"}` instead of HTML.

## Railway Backend Requirements
No changes needed. Backend already:
- ✅ Has CORS configured for www.printershero.com
- ✅ Returns JSON for all /api/* endpoints
- ✅ Accepts credentials (cookies) for session auth
