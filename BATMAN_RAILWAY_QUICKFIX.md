# 🎯 RAILWAY PRODUCTION FIX — QUICK REFERENCE

## 🚨 COPY-PASTE THIS INTO RAILWAY

### Core Variables (Required)
```bash
NODE_ENV=production
AUTH_PROVIDER=standard
DATABASE_URL=postgresql://neondb_owner:YOUR_PASSWORD@ep-YOUR-ENDPOINT.us-east-2.aws.neon.tech/neondb?sslmode=require
SESSION_SECRET=YOUR_SUPER_SECRET_32_PLUS_CHARACTER_STRING
```

**IMPORTANT**: Use `AUTH_PROVIDER=standard` for Railway production. This enables email/password authentication.

**Legacy AUTH_PROVIDER=replit is Replit-platform-only** and will NOT work on Railway (requires Replit OIDC OAuth app).

### Email (Optional but Recommended)
```bash
PUBLIC_APP_URL=https://your-app.railway.app
GMAIL_OAUTH_REDIRECT_URI=https://your-app.railway.app/oauth2callback
GMAIL_CLIENT_ID=your-gmail-client-id
GMAIL_CLIENT_SECRET=your-gmail-client-secret
GMAIL_REFRESH_TOKEN=your-refresh-token
```

---

## 🔍 How to Find Values

### DATABASE_URL
- Copy from Neon dashboard → Connection String
- Must include `?sslmode=require`

### SESSION_SECRET
Generate new random string:
```bash
# PowerShell
[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))

# Or online: https://randomkeygen.com/
```

---

## 🚀 First-Time Setup

### 1. Apply Database Migration
Before first deployment, apply migration 0033 in Neon SQL Editor:
```sql
-- Copy contents from: server/db/migrations/0033_add_password_hash.sql
-- Paste and run in Neon SQL Editor
```

### 2. Create First Owner User
After deployment, run bootstrap script:
```bash
npx tsx scripts/create-owner.ts \
  --email=admin@printershero.com \
  --password=YourSecurePassword123 \
  --org=org_titan_001
```

This creates the first owner user account with email/password authentication.

---

## ✅ Success Check

After deploying, logs should show:
```
✅ Selected: standardAuth (Email/Password Production Auth)
✅ This is the RECOMMENDED auth provider for Railway production
Session store: PostgreSQL (connect-pg-simple)
Secure cookies: true
Trust proxy: 1
```

**NOT THIS** ❌:
```
✅ Selected: localAuth (Development mode)
❌ CRITICAL: localAuth is active in NODE_ENV=production
```

---

## 🆘 If Auth Still Times Out

1. Check DATABASE_URL connects successfully
2. Check SESSION_SECRET is long (32+ chars)
3. Verify startup logs show "standardAuth" selected
4. Check migration 0033 was applied (password_hash column exists)
5. Verify owner user was created successfully

---

**Full Documentation**: See `RAILWAY_AUTH_FIX.md`

