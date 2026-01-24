# Railway Environment Variables Checklist for Gmail Email

## Purpose
This checklist helps you configure Railway environment variables correctly for Gmail OAuth email sending.

## Required Environment Variables

### Core Application
```bash
# Database connection (should already be set by Railway)
DATABASE_URL=postgresql://user:password@host/database?sslmode=require

# Session secret (generate a strong random string)
SESSION_SECRET=your-32-plus-character-random-string

# Node environment (must be "production" for Railway)
NODE_ENV=production
```

### Email Configuration (NEW)
```bash
# Public application URL - REQUIRED for production
# This should match your Railway domain or custom domain
PUBLIC_APP_URL=https://www.printershero.com

# Gmail OAuth Redirect URI - OPTIONAL
# Only set this if you created custom OAuth credentials for your production app
# If you used OAuth Playground to generate your refresh token, leave this unset
# Default: https://developers.google.com/oauthplayground
GMAIL_OAUTH_REDIRECT_URI=https://developers.google.com/oauthplayground
```

## Google Cloud Console Configuration

### Important: OAuth Authorized Redirect URIs

Your Google Cloud Console OAuth credentials must have the following redirect URI configured:

**If using OAuth Playground (recommended for simple setup):**
- Add this redirect URI: `https://developers.google.com/oauthplayground`
- Leave `GMAIL_OAUTH_REDIRECT_URI` unset in Railway (or set it to the playground URL)

**If using custom production OAuth flow:**
- Add your production callback URL (e.g., `https://www.printershero.com/api/oauth/gmail/callback`)
- Set `GMAIL_OAUTH_REDIRECT_URI` in Railway to match exactly

### How to Update Google Cloud Console

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to your project
3. Go to "APIs & Services" → "Credentials"
4. Click on your OAuth 2.0 Client ID
5. Under "Authorized redirect URIs", ensure you have:
   - `https://developers.google.com/oauthplayground` (if using OAuth Playground tokens)
   - Your production domain callback URL (if using custom OAuth flow)
6. Click "Save"

## Common Errors and Fixes

### Error: "redirect_uri_mismatch"
**Cause:** The redirect URI in your code doesn't match Google Cloud Console

**Fix:**
1. Check Railway environment variable `GMAIL_OAUTH_REDIRECT_URI`
2. Check Google Cloud Console → OAuth Client → Authorized Redirect URIs
3. Make sure they match exactly (including protocol, domain, path)

### Error: "invalid_grant"
**Cause:** Refresh token is invalid, expired, or revoked

**Fix:**
1. Go to OAuth Playground and generate a new refresh token
2. Update the refresh token in Admin Settings → Email tab
3. Ensure the Client ID/Secret match the credentials used to generate the token

### Error: "unauthorized_client"
**Cause:** Client ID/Secret mismatch or OAuth credentials not configured

**Fix:**
1. Verify Client ID and Client Secret in Admin Settings match Google Cloud Console
2. Ensure Gmail API is enabled in Google Cloud Console

### Error: 502 Bad Gateway or Timeout
**Cause:** Network issues or configuration mismatch preventing OAuth refresh

**Fix:**
1. Run the diagnostic tool: `npx tsx server/diagnostics/emailConfigCheck.ts`
2. Check Railway logs for detailed error messages (look for requestId)
3. Verify all environment variables are set correctly

## Verification Steps

### 1. Run Diagnostic Tool Locally
```bash
# In your local development environment with Railway env vars
npx tsx server/diagnostics/emailConfigCheck.ts
```

### 2. Check Railway Logs
After deploying, send a test email and check Railway logs:
```
Look for these log entries:
- email_test_start (shows config being used)
- email_oauth_refresh_start (shows redirect URI)
- email_test_success (confirms it worked)
```

### 3. Test Email in Production
1. Log into your Railway deployment
2. Go to Admin Settings → Email tab
3. Click "Test Email"
4. Check the email arrives
5. If it fails, note the Request ID and check Railway logs

## Migration from Localhost to Railway

If you previously configured email for localhost, you need to:

1. ✅ Update Railway environment variables (see above)
2. ✅ Verify Google Cloud OAuth Redirect URIs include production domain (if needed)
3. ✅ Re-generate refresh token if your OAuth credentials changed
4. ✅ Test email sending in production
5. ✅ Monitor Railway logs for any errors

## Additional Resources

- [Google OAuth Playground](https://developers.google.com/oauthplayground)
- [Google Cloud Console](https://console.cloud.google.com/)
- [Railway Environment Variables](https://docs.railway.app/develop/variables)
- [Diagnostic Tool](./server/diagnostics/emailConfigCheck.ts)
