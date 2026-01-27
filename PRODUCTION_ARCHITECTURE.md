# Production Deployment Architecture

## Overview
QuoteVaultPro uses a split deployment architecture:
- **Frontend**: Vercel (https://www.printershero.com)
- **Backend**: Railway (https://quotevaultpro-production.up.railway.app)

## How It Works

### Request Routing
Vercel acts as a reverse proxy for API requests:

```
Browser Request                 Vercel Edge                Railway Backend
     |                               |                           |
     |--- GET /login --------------->|                           |
     |                               |                           |
     |<-- index.html (React SPA) ----|                           |
     |                               |                           |
     |--- POST /api/auth/login ----->|                           |
     |                               |                           |
     |                    [Proxy via vercel.json]                |
     |                               |                           |
     |                               |--- POST /api/auth/login ->|
     |                               |                           |
     |                               |<--- 200 JSON + cookie ----|
     |                               |                           |
     |<-- 200 JSON + cookie ---------|                           |
```

**Key Points:**
- Frontend code uses **relative URLs** (`/api/auth/login`, not full Railway URLs)
- Vercel rewrites `/api/*` to Railway backend transparently
- All other routes serve `index.html` for React Router (SPA)
- Cookies are **first-party** (set by www.printershero.com domain)

### vercel.json Configuration
Order matters! API rewrite must come before SPA fallback:

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

## Environment Variables

### Vercel (Frontend)
**Optional:**
- `VITE_API_BASE_URL` - Leave **empty** or omit entirely (defaults to same-origin `/api`)

**Do NOT set:**
- ❌ Don't hardcode Railway URL in `VITE_API_BASE_URL`
- ❌ Don't set `BACKEND_URL` or similar

The Vercel rewrite handles routing transparently.

### Railway (Backend)
**Required:**
```bash
PUBLIC_APP_URL=https://www.printershero.com
NODE_ENV=production
SESSION_SECRET=<your-secret>
DATABASE_URL=<your-postgres-url>
```

**CORS Configuration:**
Backend must allow `https://www.printershero.com` origin (already configured in `server/index.ts`).

## Authentication Flow

### Session Cookies
- **Domain**: Not set explicitly → defaults to request domain (www.printershero.com)
- **SameSite**: `lax` (CSRF protection)
- **Secure**: `true` in production (HTTPS only)
- **HttpOnly**: `true` (prevents XSS)

Because the Vercel proxy makes API requests appear same-origin, cookies work as first-party:
1. User logs in at `/api/auth/login`
2. Railway backend sets session cookie
3. Browser receives cookie for www.printershero.com domain
4. Subsequent `/api/*` requests include cookie automatically
5. Backend validates session from PostgreSQL session store

### Why This Works
- **No CORS issues**: Vercel proxy makes requests appear same-origin
- **First-party cookies**: No need for `SameSite=None` or cross-domain configuration
- **Simple frontend code**: Use relative URLs everywhere

## Deployment Process

### 1. Deploy Backend (Railway)
```bash
# Already deployed - no changes needed
# Verify it's running:
curl https://quotevaultpro-production.up.railway.app/api/auth/config
```

### 2. Deploy Frontend (Vercel)
```bash
git push origin main  # Auto-deploys to Vercel
```

Vercel automatically:
- Builds the React app
- Applies `vercel.json` rewrites
- Serves static files + proxies API requests

## Verification Tests

### Test 1: Frontend Routes (SPA)
```bash
curl -I https://www.printershero.com/login
curl -I https://www.printershero.com/forgot-password
curl -I https://www.printershero.com/dashboard
```
**Expected**: All return `200 OK` with `content-type: text/html`

### Test 2: API Proxy
```bash
curl -i https://www.printershero.com/api/auth/config
```
**Expected**: 
```
HTTP/2 200
content-type: application/json

{"provider":"standard"}
```

### Test 3: Login Flow
```bash
# 1. Login
curl -i -X POST https://www.printershero.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"password"}' \
  -c cookies.txt

# 2. Check session (with cookie)
curl -i https://www.printershero.com/api/auth/me \
  -b cookies.txt
```
**Expected**: Both return JSON, second request shows authenticated user.

### Test 4: Browser Test
1. Visit https://www.printershero.com
2. Click "Sign In" → Should load `/login` page
3. Enter credentials and submit
4. DevTools → Application → Cookies → Should see session cookie
5. Navigate to dashboard → Should stay authenticated

## Troubleshooting

### 404 on /api/* endpoints
**Cause**: Vercel rewrite not working
**Fix**:
1. Verify `vercel.json` is in repo root
2. Check Vercel deployment logs
3. Ensure Railway backend is running:
   ```bash
   curl https://quotevaultpro-production.up.railway.app/api/auth/config
   ```

### CORS errors
**Should not happen** with Vercel proxy. If you see CORS errors:
1. Check if `VITE_API_BASE_URL` is set (it shouldn't be)
2. Verify frontend uses relative `/api/*` URLs
3. Check Railway backend CORS config in `server/index.ts`

### Cookies not working
1. Check DevTools → Application → Cookies
2. Verify cookie is set for `www.printershero.com` (not Railway domain)
3. Ensure `secure: true` in production (HTTPS only)
4. Check `SameSite=Lax` (not `None`)

### SPA routes return 404
**Cause**: SPA fallback rewrite missing or in wrong order
**Fix**: Ensure `vercel.json` has SPA rewrite **after** API rewrite

## Architecture Benefits

✅ **Simple frontend code**: No environment-specific URLs  
✅ **First-party cookies**: No cross-domain complexity  
✅ **No CORS issues**: Vercel proxy handles everything  
✅ **Secure by default**: HttpOnly, Secure, SameSite cookies  
✅ **Easy local dev**: Vite proxy mimics Vercel proxy  
✅ **Flexible scaling**: Backend can move without frontend changes  

## Related Files
- `vercel.json` - Vercel routing configuration
- `server/auth/standardAuth.ts` - Session cookie configuration
- `client/src/lib/apiConfig.ts` - Frontend API URL helper (uses relative paths)
- `server/index.ts` - CORS and trust proxy configuration
