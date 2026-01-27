# Magic Link Authentication Setup

## Overview

QuoteVaultPro now supports passwordless authentication via magic links. This is a secure, user-friendly authentication method that sends time-limited sign-in links via email.

## How It Works

1. User enters their email on the login page
2. Server generates a short-lived JWT token (15 minutes)
3. Email sent with magic link: `https://yourapp.com/auth/magic-link?token=...`
4. User clicks link, token is verified, session established
5. User is automatically signed in

## Required Environment Variables

### Production (Required)

```bash
# Database connection (required)
DATABASE_URL=postgresql://...

# Session secret (required, min 16 chars)
# Used for both session cookies AND JWT token signing
SESSION_SECRET=your-secure-random-secret-here

# Public app URL (recommended)
# Used in email links. If not set, defaults to "quotevaultpro"
PUBLIC_APP_URL=https://printershero.com

# Auth provider (required for magic link)
AUTH_PROVIDER=magiclink

# Node environment
NODE_ENV=production
```

### Email Configuration

Magic link authentication requires a working email provider. Configure email in **Admin Settings → Email**.

Supported providers:
- **Gmail OAuth** (recommended for Railway/production)
- **SMTP** (any standard SMTP provider)

Email settings are stored per-organization in the `emailSettings` table.

## Deployment Instructions

### 1. Set Environment Variables

In your Railway/production environment:

```bash
AUTH_PROVIDER=magiclink
PUBLIC_APP_URL=https://printershero.com
SESSION_SECRET=<your-existing-session-secret>
DATABASE_URL=<your-existing-database-url>
NODE_ENV=production
```

### 2. Configure Email Provider

1. Log in as owner/admin
2. Navigate to **Settings → Email**
3. Configure Gmail OAuth or SMTP:

#### Gmail OAuth (Recommended)
- Client ID: `<your-client-id>.apps.googleusercontent.com`
- Client Secret: `<your-client-secret>`
- Refresh Token: (obtain via OAuth Playground)
- From Address: `noreply@printershero.com`
- From Name: `PrintersHero`

#### SMTP
- Host: `smtp.example.com`
- Port: `587` (or `465` for SSL)
- Username: `your-smtp-username`
- Password: `your-smtp-password`
- From Address: `noreply@printershero.com`
- From Name: `PrintersHero`

### 3. Test Authentication

1. Navigate to `https://printershero.com`
2. Click "Sign In"
3. Enter your email address
4. Click "Send Sign-in Link"
5. Check email inbox for magic link
6. Click link to sign in

## Security Features

- **Short-lived tokens**: JWT tokens expire after 15 minutes
- **Signed tokens**: Tokens signed with `SESSION_SECRET` (HS256 algorithm)
- **Single-use intent**: Once consumed, token establishes session (no database storage)
- **Rate limiting**: Request endpoint is rate-limited to prevent abuse
- **No information leakage**: API never reveals whether user exists
- **Secure cookies**: Production uses `secure: true`, `sameSite: lax`
- **HTTPS only**: Cookies only sent over HTTPS in production

## Auto-provisioning Behavior

When a user signs in for the first time via magic link:

1. User is auto-created in `users` table
2. **First user**: Assigned `owner` role
3. **Subsequent users**: Assigned `employee` role by default
4. **Organization membership**: Auto-provisioned to `DEFAULT_ORGANIZATION_ID` via existing `tenantContext` middleware

## API Endpoints

### Request Magic Link

```http
POST /api/auth/magic-link/request
Content-Type: application/json

{
  "email": "user@example.com"
}
```

**Response** (always returns success to avoid leaking user existence):
```json
{
  "success": true
}
```

### Consume Magic Link

```http
GET /api/auth/magic-link/consume?token=<jwt-token>
```

**Response**:
- **Success**: HTTP 302 redirect to `/` (home) with session cookie
- **Token expired**: HTTP 302 redirect to `/login?error=expired`
- **Token invalid**: HTTP 302 redirect to `/login?error=invalid`
- **Session error**: HTTP 302 redirect to `/login?error=session`

### Logout

```http
POST /api/auth/logout
```

**Response**:
```json
{
  "success": true
}
```

### Get Current User

```http
GET /api/auth/me
```

**Response**:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_...",
      "email": "user@example.com",
      "firstName": "",
      "lastName": "",
      "role": "owner",
      "isAdmin": true
    }
  }
}
```

## Troubleshooting

### "No magic link received"

1. **Check email provider configuration**:
   - Settings → Email → Verify Gmail OAuth or SMTP settings
   - Test email send from admin panel

2. **Check spam folder**: Magic link emails may be marked as spam

3. **Check server logs** for email sending errors:
   ```bash
   grep "auth_magiclink_request" logs.txt
   grep "email_send_error" logs.txt
   ```

4. **Verify PUBLIC_APP_URL** is set correctly

### "Token expired"

- Magic link tokens expire after 15 minutes
- Request a new magic link

### "Token invalid"

- Token may be malformed or tampered with
- Ensure `SESSION_SECRET` hasn't changed
- Request a new magic link

### "Session error"

- Session store (PostgreSQL) may be down or full
- Check `sessions` table in database
- Verify `DATABASE_URL` is correct

## Switching Auth Providers

### From `standard` (password) to `magiclink`:

1. Change `AUTH_PROVIDER=magiclink` in environment
2. Restart application
3. Existing users can sign in via magic link (passwordHash is optional)

### From `magiclink` back to `standard`:

1. Change `AUTH_PROVIDER=standard` in environment
2. Restart application
3. Users without passwords must have passwords set by admin

### From `replit` to `magiclink`:

1. Change `AUTH_PROVIDER=magiclink` in environment
2. Optionally set `DEPLOY_TARGET=` (empty) if previously set to `replit`
3. Restart application

## Multi-Tenant Considerations

- Magic link authentication uses `DEFAULT_ORGANIZATION_ID` for email sending
- After login, `tenantContext` middleware resolves actual organization memberships
- New users are auto-provisioned to default organization
- Admin can later assign users to additional organizations via `userOrganizations` table

## Implementation Details

- **JWT library**: `jose` (modern, secure)
- **Token algorithm**: HS256 (symmetric signing)
- **Token claims**: `{ sub: email, aud: "magiclink", iss: PUBLIC_APP_URL, exp: 15m }`
- **Session store**: PostgreSQL (`connect-pg-simple`)
- **Session TTL**: 7 days
- **Rate limiting**: Uses existing `authRateLimit` middleware

## Files Modified

### Server
- `server/auth/magicLinkAuth.ts` (new) - Magic link auth provider
- `server/routes.ts` - Added `magiclink` to auth provider selection

### Client
- `client/src/pages/login.tsx` (new) - Login page with email input
- `client/src/pages/auth-magic-link.tsx` (new) - Token consumption page
- `client/src/pages/landing.tsx` - Updated to navigate to `/login`
- `client/src/App.tsx` - Added `/login` and `/auth/magic-link` routes

## Production Readiness

✅ **No database schema changes**  
✅ **Reuses existing session infrastructure**  
✅ **Reuses existing email service**  
✅ **Rate limiting included**  
✅ **Secure by default (HTTPS, signed tokens)**  
✅ **Multi-tenant safe**  
✅ **Type-safe (TypeScript)**  
✅ **Fail-soft design (no crashes on normal scenarios)**

## Recommended Deployment

For **printershero.com** production:

```bash
AUTH_PROVIDER=magiclink
PUBLIC_APP_URL=https://printershero.com
NODE_ENV=production
# (Keep existing SESSION_SECRET and DATABASE_URL)
```

This provides the best user experience for a public-facing application.
