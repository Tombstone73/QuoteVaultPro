# Production Authentication Fix - Railway Backend

## Problem
Frontend on `https://www.printershero.com` (Vercel) was calling `/api/auth/login` as a relative path, which Vercel was rewriting to Railway backend. However, Vercel rewrites don't preserve session cookies across domains, causing authentication to fail.

**Observed behavior:**
- Login POST went to `https://www.printershero.com/api/auth/login` (Vercel domain)
- Session cookie was set for `www.printershero.com` 
- Subsequent requests to Railway backend at `https://quotevaultpro-production.up.railway.app` had no session cookie
- `/api/auth/session` returned `authenticated: false`

## Solution
Make frontend explicitly call Railway backend using absolute URLs for ALL API requests, especially auth routes.

## Changes Made

### 1. Updated API Configuration (`client/src/lib/apiConfig.ts`)
- Added `getApiBaseUrl()` function that reads `VITE_API_BASE_URL` env var
- In production, requires `VITE_API_BASE_URL=https://quotevaultpro-production.up.railway.app`
- In development, uses empty string (relative URLs to local backend)
- Added runtime warning if constructed URL accidentally uses `window.location.origin`

### 2. Updated Auth Endpoints
- **Login** (`client/src/pages/login.tsx`): Now uses `getApiUrl("/api/auth/login")`
- **Logout** (`client/src/hooks/useAuth.ts`): Now uses `getApiUrl("/api/auth/logout")`
- **User Session** (`client/src/hooks/useAuth.ts`): Query key uses `getApiUrl("/api/auth/user")`
- **User Management** (`client/src/components/user-management.tsx`): Query key uses `getApiUrl("/api/auth/user")`

### 3. Updated Query Client (`client/src/lib/queryClient.ts`)
- `apiRequest()` now resolves relative paths with `getApiUrl()`
- `getQueryFn()` now applies `getApiUrl()` to query keys that are relative paths
- This ensures ALL API calls (not just auth) use Railway backend in production

### 4. Environment Configuration
- Added `VITE_API_BASE_URL` to `.env.example` with documentation
- This variable MUST be set in Vercel environment variables

## Deployment Checklist

### Vercel Environment Variables
```bash
VITE_API_BASE_URL=https://quotevaultpro-production.up.railway.app
```

⚠️ **CRITICAL**: Set this in Vercel dashboard → Project Settings → Environment Variables

### Railway Backend (No changes needed, but verify)
Backend should already have:
- CORS enabled for `https://www.printershero.com` origin
- Session cookies configured properly
- `credentials: 'include'` is already used in frontend fetch calls

## Testing Acceptance Criteria

### A) Network Tab Verification
1. Open Chrome DevTools → Network tab
2. Navigate to `https://www.printershero.com/login`
3. Enter credentials and click "Sign In"
4. **Verify**: POST request shows:
   ```
   Request URL: https://quotevaultpro-production.up.railway.app/api/auth/login
   ```
   **NOT**: `https://www.printershero.com/api/auth/login`

### B) Cookie Verification
1. Open Chrome DevTools → Application tab → Cookies
2. After successful login, check cookies:
   - ✅ Session cookie appears under `https://quotevaultpro-production.up.railway.app`
   - ✅ No new `connect.sid` cookie for `www.printershero.com`

### C) Session Verification
1. After login, directly visit:
   ```
   https://quotevaultpro-production.up.railway.app/api/auth/session
   ```
2. **Verify**: Response shows `authenticated: true` (or equivalent user data)

### D) Console Warnings
1. Check browser console for API config warnings
2. Should NOT see warnings about URL starting with current origin
3. If warnings appear, verify `VITE_API_BASE_URL` is set in Vercel

## Files Changed
1. `client/src/lib/apiConfig.ts` - Core API URL configuration
2. `client/src/pages/login.tsx` - Login form
3. `client/src/hooks/useAuth.ts` - Auth hooks (useAuth, useLogout)
4. `client/src/lib/queryClient.ts` - TanStack Query client
5. `client/src/components/user-management.tsx` - User management dialog
6. `.env.example` - Environment variable documentation

## Rollback Plan
If issues occur:
1. Remove `VITE_API_BASE_URL` from Vercel env vars
2. Revert changes to `apiConfig.ts` (restore `return path;` in `getApiUrl`)
3. Redeploy from previous commit

## Additional Notes
- Vercel rewrites in `vercel.json` are kept but will only be used for non-auth static asset serving
- No backend changes were required
- No schema changes were made
- Development workflow unchanged (uses local backend via relative URLs)
