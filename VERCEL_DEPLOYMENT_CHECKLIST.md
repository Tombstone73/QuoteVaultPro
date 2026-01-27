# Vercel Deployment Checklist - QuoteVaultPro

## ✅ Changes Made

### 1. Fixed Landing Page Login Button
**File:** [client/src/pages/home.tsx](client/src/pages/home.tsx)
- **Before:** `window.location.href = "/api/login"`
- **After:** `navigate("/login")`
- **Impact:** Unauthorized users now redirect to the React Router `/login` page instead of hitting the non-existent API endpoint

### 2. Vercel API Proxy Configuration
**File:** [vercel.json](vercel.json)
- **Rewrite Rule:** `/api/:path*` → `https://quotevaultpro-production.up.railway.app/api/:path*`
- **Note:** Vercel rewrites do not support environment variable interpolation. Railway URL is hardcoded.
- **TODO:** If Railway URL changes, update this file and redeploy.

## 🔧 Vercel Environment Variables

These environment variables should be set in the Vercel dashboard:

### Required
None required for basic functionality (API proxy uses vercel.json rewrite)

### Optional (for future use)
```
VITE_API_BASE_URL=https://quotevaultpro-production.up.railway.app
```
Only needed if you want to bypass the Vercel rewrite and call Railway directly from frontend.

### Backend-Related (if server-side rendering added later)
```
BACKEND_URL=https://quotevaultpro-production.up.railway.app
PUBLIC_APP_URL=https://www.printershero.com
```

## 🚀 Deployment Steps

1. **Commit Changes**
   ```bash
   git add client/src/pages/home.tsx vercel.json
   git commit -m "Fix: Redirect to /login instead of /api/login, add API proxy"
   ```

2. **Push to Vercel**
   ```bash
   git push origin main
   ```
   Vercel auto-deploys on push.

3. **Verify Deployment**
   - Check Vercel dashboard shows successful deployment
   - Verify `vercel.json` is included in deployment files

## ✅ Verification Tests

### Test 1: Landing Page Login Button
```
1. Visit: https://www.printershero.com
2. Click "Sign In" button in header
3. Expected: Browser navigates to https://www.printershero.com/login
4. Expected: Login form loads (not 404)
```

### Test 2: Unauthorized Redirect
```
1. While logged out, try accessing: https://www.printershero.com/home
2. Expected: Toast shows "Unauthorized"
3. Expected: Redirects to /login after 500ms
4. Expected: No 404 error
```

### Test 3: API Proxy (Auth Config)
```bash
curl -i https://www.printershero.com/api/auth/config
```
**Expected Response:**
```
HTTP/2 200
content-type: application/json
...

{"provider":"standard"}
```

**Failure Signs:**
- `HTTP/2 404` = Vercel rewrite not working
- `content-type: text/html` = SPA fallback served (proxy failed)

### Test 4: API Proxy (Forgot Password)
```bash
curl -i -X POST https://www.printershero.com/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```
**Expected Response:**
```
HTTP/2 200
content-type: application/json
...

{"success":true}
```

### Test 5: Cookie Authentication
```
1. Login at https://www.printershero.com/login
2. Open DevTools → Application → Cookies
3. Expected: Session cookie set on .printershero.com domain
4. Navigate to dashboard
5. Expected: Authenticated (cookie sent with /api/* requests)
```

## 🔍 Troubleshooting

### Still Getting 404 on /api/login?
**This is correct!** There is no `/api/login` endpoint. The frontend should navigate to `/login` (React Router). If you're still seeing `/api/login` in the URL bar:
1. Clear browser cache
2. Force refresh (Ctrl+Shift+R)
3. Check that you deployed the latest code

### API Requests Return 404?
If `/api/auth/config` or other API endpoints return 404:
1. Verify `vercel.json` is in repo root
2. Check Vercel deployment logs for rewrite activity
3. Verify Railway backend is up:
   ```bash
   curl https://quotevaultpro-production.up.railway.app/api/auth/config
   ```
4. Check Railway URL hasn't changed

### CORS Errors?
If you see CORS errors:
1. Railway backend should already have CORS configured for `www.printershero.com`
2. Check backend `server/index.ts` CORS configuration
3. Verify `credentials: "include"` in frontend fetch calls

### Session Cookies Not Working?
1. Verify cookies are set with `SameSite=None; Secure` (for cross-origin)
2. Or ensure cookies use `SameSite=Lax` with first-party domain
3. Since Vercel proxy makes requests appear first-party, `SameSite=Lax` should work

## 📋 Routes Overview

| URL Path | Handled By | Purpose |
|----------|-----------|---------|
| `/` | Vercel (React) | Landing page |
| `/login` | Vercel (React) | Login form (React Router) |
| `/forgot-password` | Vercel (React) | Password reset request |
| `/reset-password` | Vercel (React) | Password reset form |
| `/home` | Vercel (React) | Dashboard (requires auth) |
| `/api/*` | Railway (proxied) | Backend API endpoints |

## 🎯 Summary

✅ **Fixed:** Home page unauthorized redirect now goes to `/login` (React Router)  
✅ **Fixed:** Landing page already correctly navigates to `/login`  
✅ **Added:** Vercel API proxy for `/api/*` → Railway backend  
✅ **Verified:** Build passes  
✅ **Verified:** No more `/api/login` references in frontend  

**Next Steps:**
1. Deploy to Vercel (auto-deploy on push)
2. Test landing page login button
3. Test API proxy with curl commands
4. Verify cookies work across login flow
