# Vercel → Railway API Proxy - Verification Guide

## ✅ Configuration Complete

### What's Deployed
1. **vercel.json** - Automatic API proxy at Vercel edge
   - All `/api/*` requests from www.printershero.com are proxied to Railway
   - No frontend code changes needed
   - Preserves cookies/credentials for session auth

2. **HTML Detection** - Safety check in `client/src/lib/apiConfig.ts`
   - `parseJsonResponse()` validates Content-Type before parsing
   - Throws descriptive error if HTML received instead of JSON
   - Helps catch misrouting issues immediately

## Verification Steps

### 1. Test Auth Config Endpoint
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
- ❌ `content-type: text/html` (Vercel rewrite not working)
- ❌ Body starts with `<!DOCTYPE html>` (SPA fallback served)

### 2. Test Forgot Password Endpoint
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

### 3. Browser Test (Full UI Flow)
1. Open https://www.printershero.com/forgot-password
2. Open DevTools → Network tab
3. Enter any email and submit
4. Check the request to `/api/auth/forgot-password`:
   - ✅ Response Headers: `Content-Type: application/json`
   - ✅ Response Body: `{"success":true}`
   - ✅ Status: 200 OK
   - ✅ UI shows success message (no error toast)

5. Check Railway backend logs:
   - ✅ POST request logged
   - ✅ IP should be from Vercel proxy

## How It Works

```
User Browser                     Vercel Edge                   Railway Backend
    |                                 |                              |
    |------ POST /api/auth/forgot --->|                              |
    |       (relative URL)             |                              |
    |                                 |                              |
    |                    [vercel.json rewrite]                       |
    |                                 |                              |
    |                                 |---- POST /api/auth/forgot -->|
    |                                 |    (full Railway URL)        |
    |                                 |                              |
    |                                 |<---- 200 JSON response ------|
    |                                 |                              |
    |<------ 200 JSON response -------|                              |
    |                                 |                              |
```

**Key Points:**
- Frontend code uses relative URLs: `fetch("/api/auth/forgot-password", ...)`
- Vercel edge intercepts and proxies to Railway automatically
- Cookies/credentials flow through transparently
- No CORS issues (Vercel proxy handles it)

## Troubleshooting

### Still Getting HTML Responses?

**Check 1: Verify vercel.json deployed**
- Go to Vercel Dashboard → Project → Deployments
- Click latest deployment → View Source
- Confirm `vercel.json` exists with rewrite configuration

**Check 2: Verify rewrite syntax**
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

**Check 3: Check Railway backend is up**
```bash
curl https://quotevaultpro-production.up.railway.app/api/auth/config
```
Should return JSON. If not, Railway backend is down.

**Check 4: Vercel deployment logs**
- Check Vercel deployment logs for rewrite activity
- Look for "Rewriting route /api/..." messages

### CORS Errors?

If you see CORS errors after implementing the proxy:
1. Verify Railway backend has CORS configured for `www.printershero.com`
2. Check backend `cors` configuration in `server/index.ts`
3. Verify `credentials: "include"` is set in frontend fetch calls

### 401 Unauthorized (Expected)

If you get `{"error":"Unauthorized"}` with `Content-Type: application/json`:
- ✅ This is correct! The proxy is working
- The endpoint requires authentication
- The error is returned as JSON (not HTML), which confirms routing works

## Files Modified

- ✅ `vercel.json` - Added API proxy rewrite
- ✅ `client/src/lib/apiConfig.ts` - Added HTML detection safety check
- ✅ `client/src/lib/queryClient.ts` - Uses apiConfig helpers
- ✅ Auth pages - Use `parseJsonResponse()` for better error messages

## Deployment Checklist

- [ ] Verify `vercel.json` in repo root
- [ ] Deploy to Vercel (frontend)
- [ ] Test `/api/auth/config` returns JSON
- [ ] Test forgot-password flow in browser
- [ ] Check Railway logs show requests from Vercel IPs
- [ ] No CORS errors in browser console
