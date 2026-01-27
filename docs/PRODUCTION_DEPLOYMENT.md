# Production Deployment Guide

## Overview

QuoteVaultPro uses a split deployment architecture:

- **Frontend**: Vercel (https://www.printershero.com)
- **Backend**: Railway (https://quotevaultpro-production.up.railway.app)
- **Proxy**: Vercel rewrites all `/api/*` to Railway

## Architecture Benefits

✅ **Same-origin cookies** - No CORS issues  
✅ **Simple client code** - Uses relative paths like `/api/login`  
✅ **Separate scaling** - Frontend and backend scale independently  
✅ **CDN delivery** - Static assets served from Vercel Edge Network  
✅ **Dedicated backend** - Railway provides persistent connections and background workers

## Request Flow

```
Browser: www.printershero.com/api/login
         ↓
    Vercel Edge Network
         ↓
    vercel.json rewrite
         ↓
    quotevaultpro-production.up.railway.app/api/login
         ↓
    Railway Backend
         ↓
    Set-Cookie: connect.sid (domain: www.printershero.com)
```

## Configuration Files

### vercel.json (Repository Root)

```json
{
  "rewrites": [
    {
      "source": "/api/:path*",
      "destination": "https://quotevaultpro-production.up.railway.app/api/:path*"
    },
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ],
  "headers": [
    {
      "source": "/api/:path*",
      "headers": [
        {
          "key": "X-Forwarded-Host",
          "value": "www.printershero.com"
        }
      ]
    }
  ]
}
```

**Order matters**: API rewrite must come before SPA fallback.

### Railway Environment Variables

```bash
# Required
PUBLIC_APP_URL=https://www.printershero.com
DATABASE_URL=postgresql://...
SESSION_SECRET=your-secret-here
NODE_ENV=production

# Optional - Supabase Storage
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-key
```

### Vercel Environment Variables

**None required!** The client code uses:
- `VITE_API_BASE_URL` defaults to `""` (same-origin)
- Vercel proxy handles routing

## Client Code Configuration

### client/src/lib/apiConfig.ts

```typescript
export function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL || "";
}

export function getApiUrl(path: string): string {
  const base = getApiBaseUrl();
  
  if (!base) {
    // Same-origin: return path as-is (uses Vercel proxy)
    return path;
  }
  
  // Cross-origin: combine base + path
  const cleanBase = base.replace(/\/$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
}
```

**Default behavior**: Returns relative paths like `/api/login` which Vercel proxies to Railway.

### Session Cookies

From `server/auth/standardAuth.ts`:

```typescript
cookie: {
  httpOnly: true,
  secure: isProduction,  // HTTPS only in production
  sameSite: "lax",       // CSRF protection
  maxAge: sessionTtl,
  // NO domain property = scoped to requesting domain (www.printershero.com)
}
```

## Deployment Steps

### Initial Setup

1. **Deploy Backend to Railway**

```bash
# Link to Railway project
railway link

# Set environment variables
railway variables set PUBLIC_APP_URL=https://www.printershero.com
railway variables set DATABASE_URL=postgresql://...
railway variables set SESSION_SECRET=...
railway variables set NODE_ENV=production

# Deploy
railway up
```

2. **Deploy Frontend to Vercel**

```bash
# Link to Vercel project
vercel link

# Deploy to production
vercel --prod
```

3. **Configure DNS**
- Add `www.printershero.com` to Vercel project
- Update DNS A/CNAME records to point to Vercel
- Wait for SSL certificate provisioning

### Continuous Deployment

Both platforms auto-deploy from the `main` branch:

```bash
git push origin main
```

- Railway deploys backend automatically
- Vercel deploys frontend automatically

## Troubleshooting

### Login Returns 404

**Symptom**: `POST /api/login` returns Vercel 404 page

**Causes**:
1. `vercel.json` missing from repository
2. Vercel deployment cached old config
3. Railway backend not running

**Fix**:
```bash
# Verify vercel.json exists
cat vercel.json

# Force redeploy
vercel --prod --force

# Check Railway backend
curl https://quotevaultpro-production.up.railway.app/api/health
```

### Session Not Persisting

**Symptom**: Login succeeds but user logged out on refresh

**Causes**:
1. Cookie not being set properly
2. Cookie domain mismatch
3. HTTPS required but not enabled

**Fix**:
1. Open browser DevTools → Application → Cookies
2. Check for `connect.sid` cookie with:
   - Domain: `www.printershero.com`
   - Secure: Yes (✓)
   - HttpOnly: Yes (✓)
   - SameSite: Lax

If cookie missing:
```bash
# Verify Railway env var
railway variables | grep PUBLIC_APP_URL

# Should output: PUBLIC_APP_URL=https://www.printershero.com
```

### CORS Errors

**Symptom**: "blocked by CORS policy" in browser console

**Cause**: Client code bypassing Vercel proxy

**Fix**: Ensure all API calls use relative paths:

```typescript
// ❌ Wrong: Bypasses proxy
fetch("https://quotevaultpro-production.up.railway.app/api/login")

// ✅ Correct: Uses proxy
fetch("/api/login", { credentials: "include" })
```

### SPA Routes 404

**Symptom**: `/quotes`, `/orders` return 404 on refresh

**Cause**: SPA fallback rewrite missing or wrong order

**Fix**: Verify `vercel.json` has SPA fallback AFTER API rewrite:

```json
{
  "rewrites": [
    { "source": "/api/:path*", ... },  // Must be first
    { "source": "/(.*)", "destination": "/index.html" }  // Must be last
  ]
}
```

## Verification Checklist

After deployment:

- [ ] Visit https://www.printershero.com → homepage loads
- [ ] Visit https://www.printershero.com/login → login page loads
- [ ] POST to /api/login → returns 200 (not 404)
- [ ] Check cookies → `connect.sid` exists with domain `www.printershero.com`
- [ ] Refresh after login → user stays logged in
- [ ] Navigate to /quotes → page loads
- [ ] Refresh on /quotes → page loads (SPA fallback working)
- [ ] Create quote → API calls succeed
- [ ] Check Railway logs → see incoming proxied requests

## Testing Commands

```bash
# Test Railway backend directly
curl https://quotevaultpro-production.up.railway.app/api/health

# Test Vercel frontend
curl -I https://www.printershero.com

# Test API proxy (should NOT return 404)
curl -X POST https://www.printershero.com/api/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test"}'

# View Railway logs
railway logs

# View Vercel logs
vercel logs
```

## Security Notes

- All cookies are `secure: true` in production (HTTPS only)
- All cookies are `httpOnly: true` (JavaScript cannot access)
- All cookies are `sameSite: lax` (CSRF protection)
- No explicit `domain` set = scoped to requesting domain
- Railway backend trusts Vercel proxy (`X-Forwarded-Host`)
- Session secret rotated regularly
- Database credentials stored in Railway only

## Rollback Procedure

### Vercel (Frontend)

1. Go to Vercel dashboard → Deployments
2. Find last working deployment
3. Click "..." → "Promote to Production"

### Railway (Backend)

```bash
railway rollback
```

### Database Migration Rollback

If migration was applied:
1. Check `server/db/migrations/` for migration files
2. Manually reverse migration SQL
3. Run reverse migration script

## Monitoring

### Health Endpoints

```bash
# Backend health
curl https://quotevaultpro-production.up.railway.app/api/health

# Should return: {"status":"ok"}
```

### Logs

```bash
# Railway backend logs
railway logs --follow

# Vercel frontend logs
vercel logs --follow
```

## Support

For deployment issues:
1. Check Railway logs: `railway logs`
2. Check Vercel logs: `vercel logs`
3. Review troubleshooting section above
4. Check [README.md](../README.md) for architecture overview
