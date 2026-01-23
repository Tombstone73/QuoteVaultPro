# Railway Deployment Guide for QuoteVaultPro

## Quick Start

Railway deployment now works out-of-the-box with no Replit-specific configuration required.

### Minimum Required Environment Variables

```bash
DATABASE_URL=postgresql://...  # Your PostgreSQL connection string
SESSION_SECRET=<random-secret>  # Generate with: openssl rand -base64 32
PORT=5000                       # Railway provides this automatically
```

### Optional Environment Variables

```bash
# Authentication (optional - defaults to localAuth)
AUTH_PROVIDER=replit    # Only if using Replit OIDC
REPL_ID=<your-repl-id>  # Required if AUTH_PROVIDER=replit

# File Storage (recommended for production)
GCS_BUCKET_NAME=<your-bucket>
GCS_PROJECT_ID=<your-project-id>

# Email (optional)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=<username>
SMTP_PASS=<password>

# Integrations (optional)
STRIPE_SECRET_KEY=sk_...
QUICKBOOKS_CLIENT_ID=<client-id>
QUICKBOOKS_CLIENT_SECRET=<client-secret>
```

## Deployment Steps

### 1. Create Railway Project

```bash
# Install Railway CLI (optional)
npm i -g @railway/cli

# Or use Railway dashboard: https://railway.app
```

### 2. Add PostgreSQL Database

In Railway dashboard:
1. Click "New" → "Database" → "PostgreSQL"
2. Copy the `DATABASE_URL` from the database settings

### 3. Configure Environment Variables

In Railway project settings → Variables:

```
DATABASE_URL=<from-step-2>
SESSION_SECRET=<generate-new-secret>
NODE_ENV=production
```

### 4. Deploy from GitHub

1. Connect your GitHub repository
2. Railway will automatically detect the Node.js app
3. Railway will run `npm run build` and `npm start`

### 5. Verify Deployment

Check Railway logs for successful boot:

```
NODE_ENV in routes.ts: "production"
[Auth] No AUTH_PROVIDER or REPL_ID set, defaulting to localAuth
Using auth: localAuth (default)
[Server] DATABASE_URL (redacted): ...
[Server] Ready to accept connections
serving on port 5000
```

## Authentication

### Default (localAuth)

By default, Railway uses `localAuth` which allows session-based login:

- **Login endpoint**: `POST /api/login` with `{ email, password }`
- **Auto-login**: `GET /api/auto-login?email=test@local.dev` (dev convenience)
- **Logout**: `GET /api/logout`

First-time users are auto-created on login. For owner access, use email: `dale@titan-graphics.com`

### Replit OIDC (optional)

To use Replit authentication:

```bash
AUTH_PROVIDER=replit
REPL_ID=<your-repl-id>
ISSUER_URL=https://replit.com/oidc  # Default, can omit
```

If OIDC discovery fails, server will gracefully fall back to stub routes and log errors without crashing.

## Troubleshooting

### Server Crashes on Boot

Check Railway logs for:
- Database connection errors
- Missing `DATABASE_URL`
- Invalid PostgreSQL credentials

### Auth Not Working

Check Railway logs for:
```
[Auth] No AUTH_PROVIDER or REPL_ID set, defaulting to localAuth
Using auth: localAuth (default)
```

This is expected! Use `POST /api/login` or `GET /api/auto-login` to authenticate.

### OIDC Discovery Failed

If you see:
```
[replitAuth] OIDC discovery failed: ...
[replitAuth] Replit auth will not be available. Server continuing without OIDC.
```

This is safe. Server continues running with stub auth routes. To fix:
1. Add `AUTH_PROVIDER=replit` and `REPL_ID=<id>`
2. Or remove Replit auth config to use localAuth

### Database Migrations

Railway does not auto-run migrations. To apply schema:

**Option 1: Drizzle Push (dev only)**
```bash
npm run db:push
```

**Option 2: Manual SQL Migrations (recommended)**
```bash
# Run migration files in order
psql $DATABASE_URL < server/db/migrations/0001_*.sql
psql $DATABASE_URL < server/db/migrations/0002_*.sql
# ... etc
```

**Option 3: Railway Build Command**

In Railway settings → Deploy → Build Command:
```bash
npm run build && npm run db:push
```

⚠️ **Warning**: `db:push` should only be used in development. For production, use manual SQL migrations.

## Health Check

Railway can monitor your deployment health:

**Health Endpoint**: `GET /api/health` (if implemented)

Or check server root:
```bash
curl https://your-app.railway.app/
```

Expected: Static frontend or API response.

## Performance Tuning

### Workers

By default, all background workers are enabled. To disable for cost control:

```bash
WORKERS_ENABLED=false  # Disable all workers
```

Or selectively:
```bash
THUMBNAIL_WORKER_ENABLED=false
ASSET_PREVIEW_WORKER_ENABLED=false
QB_SYNC_WORKER_ENABLED=false
```

### Database Pooling

Connection pooling is handled by Drizzle. For high traffic, consider:

```bash
DATABASE_URL=postgresql://...?connect_timeout=10&pool_timeout=10
```

## Security Checklist

Before going live:

- [ ] Use strong `SESSION_SECRET` (min 32 random bytes)
- [ ] Enable HTTPS (Railway provides this automatically)
- [ ] Set `NODE_ENV=production`
- [ ] Review CORS settings if using separate frontend
- [ ] Disable debug endpoints (`/api/debug/*` if any)
- [ ] Enable rate limiting (not yet implemented)
- [ ] Configure proper auth provider (not demo localAuth)

## Rollback

Railway supports instant rollbacks:

1. Go to Deployments tab
2. Find previous successful deployment
3. Click "Redeploy"

## Support

For issues:
1. Check Railway logs first
2. Review this guide
3. See [RAILWAY_AUTH_FIX.md](RAILWAY_AUTH_FIX.md) for auth troubleshooting
4. Check [README.md](README.md) for full environment variables

## Next Steps

After deployment:
1. Access your Railway URL
2. Use `/api/auto-login?email=test@local.dev` to create test user
3. Navigate to `/quotes`, `/orders`, etc.
4. Configure production auth, email, storage as needed

---

**Deployed Successfully? 🎉**

Your QuoteVaultPro instance is now live on Railway with fail-safe authentication!
