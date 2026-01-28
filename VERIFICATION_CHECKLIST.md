# Quick Verification Checklist

## Before Deploying to Vercel

### 1. Set Environment Variable
In Vercel dashboard:
```
VITE_API_BASE_URL = https://quotevaultpro-production.up.railway.app
```

**Important**: No trailing slash!

### 2. Verify Railway Backend CORS
Ensure Railway backend has CORS configured for Vercel origin.

Check `server/routes.ts` or CORS middleware for:
```javascript
origin: 'https://www.printershero.com'
```

### 3. Test in Development First
```bash
# Should work with relative URLs (no VITE_API_BASE_URL needed)
npm run dev
```

## After Deploying to Vercel

### Quick Test Script
Open browser console on `https://www.printershero.com/login` and run:

```javascript
// Test 1: Verify API URL construction
import { getApiUrl } from '@/lib/apiConfig';
console.log('Login URL:', getApiUrl('/api/auth/login'));
// Expected: https://quotevaultpro-production.up.railway.app/api/auth/login

// Test 2: Check for runtime warnings
// Should NOT see any "[API CONFIG] Potential misconfiguration" warnings
```

### Manual Login Test
1. Go to `https://www.printershero.com/login`
2. Open DevTools → Network tab
3. Enter credentials and submit
4. **Verify Request URL**: `https://quotevaultpro-production.up.railway.app/api/auth/login`
5. **Verify Response**: Should be 200 OK with session cookie
6. Check Application → Cookies → `quotevaultpro-production.up.railway.app`
   - Should have `connect.sid` or session cookie
7. Navigate to dashboard
8. **Verify**: Dashboard loads successfully and shows user data

### Session Verification
Visit directly:
```
https://quotevaultpro-production.up.railway.app/api/auth/session
```

Should return:
```json
{
  "authenticated": true,
  "user": { ... }
}
```

## Troubleshooting

### If login still fails:

1. **Check Network tab** - Is request going to Railway or Vercel?
   - If going to Vercel → `VITE_API_BASE_URL` not set or incorrect
   - If going to Railway but failing → Check CORS settings

2. **Check console warnings**
   - "[API CONFIG] Potential misconfiguration" → URL construction issue
   - CORS errors → Railway backend CORS not configured

3. **Check cookies**
   - No cookie under Railway domain → Session not being set
   - Cookie under Vercel domain → Auth requests going to wrong place

## Success Indicators ✅

- [ ] Login POST request goes to `*.railway.app` domain
- [ ] Session cookie stored under Railway domain
- [ ] No new cookies created for `printershero.com` 
- [ ] Dashboard loads successfully after login
- [ ] No console warnings about API misconfiguration
- [ ] Direct session check returns authenticated
