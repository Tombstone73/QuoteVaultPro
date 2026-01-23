# QuoteVaultPro Operations Runbook

**Audience**: DevOps, on-call engineers  
**Last Updated**: January 23, 2026  
**Platform**: Railway (backend), Vercel (frontend)

---

## 1. Rate Limiting Triage

### Symptoms
- Customers reporting 429 "Too Many Requests" errors
- Legitimate API calls being blocked
- Logs showing `[RateLimit]` warnings

### Immediate Disable (Emergency Only)
```bash
# Set in Railway environment variables
RATE_LIMITING_ENABLED=false
```
**Effect**: Disables ALL rate limiting. Restart required.  
**Risk**: Exposes backend to volumetric attacks. Use only for critical incidents.

### Tuning (Preferred)
Adjust rate limits instead of disabling:
```bash
# Global IP-based limits (default: 100 req/min)
MAX_REQUESTS_PER_MINUTE_IP=200

# Authenticated user limits (default: 200 req/min)
MAX_REQUESTS_PER_MINUTE_USER=400

# Endpoint-specific overrides
CALCULATE_RATE_LIMIT=50           # Pricing calculator (default: 20/min)
EMAIL_RATE_LIMIT=20                # Email sending (default: 10/min)
PREPRESS_RATE_LIMIT=30             # PDF preflight (default: 20/min)
```
**Effect**: Takes effect on next request (no restart needed).

### Verification
```bash
# Check logs for rate limit hits
railway logs | grep "\[RateLimit\]"

# Identify top offenders by IP
railway logs | grep "Rate limit exceeded" | cut -d' ' -f4 | sort | uniq -c | sort -nr | head -10
```

---

## 2. Upload Failures

### Symptoms
- File uploads failing with 400 "File type not allowed"
- 413 "Payload Too Large" errors
- Upload timeout errors

### Immediate Disable (Emergency Only)
```bash
# Disable MIME type validation and concurrent upload limits
UPLOAD_VALIDATION_ENABLED=false
```
**Effect**: Accepts any file type, removes concurrent upload throttle. Restart required.  
**Risk**: Malicious file uploads, resource exhaustion. Use only temporarily.

### Tuning (Preferred)
```bash
# Body size limit (default: 10mb)
MAX_REQUEST_SIZE=20mb
MAX_JSON_BODY_SIZE=100kb

# Concurrent upload throttle (default: 10)
MAX_CONCURRENT_UPLOADS=20

# Upload safety - TTL for abandoned uploads (default: 5 min)
UPLOAD_LIMITER_TTL_MS=600000      # 10 minutes
```
**Effect**: Immediate (no restart).

### Verification
```bash
# Check upload middleware logs
railway logs | grep "\[Upload\]"

# Check for MIME type rejections
railway logs | grep "File type not allowed"
```

---

## 3. Graceful Shutdown / Deploy Hangs

### Symptoms
- Railway restarts taking >30 seconds
- "Deployment timed out" errors
- In-flight requests dropped during deploy

### Tuning Shutdown Timeout
```bash
# Graceful shutdown timeout (default: 30000ms = 30s)
GRACEFUL_SHUTDOWN_TIMEOUT_MS=60000   # 60 seconds
```
**Effect**: Allows more time for in-flight requests to complete before force-kill. Restart required.

**Platform Timeout**: Railway force-kills after 60s total regardless of app timeout.

### Verification
```bash
# Check shutdown logs
railway logs | grep "\[Shutdown\]"

# Check for requests interrupted during shutdown
railway logs | grep "SIGTERM"
```

### If Deploy Hangs Completely
1. Check Railway dashboard for stuck deployment
2. Manually cancel deployment: `railway down`
3. Redeploy: `railway up`
4. Check logs for database connection pool exhaustion

---

## 4. Health Check Failures

### Symptoms
- `/ready` endpoint returning 503 "Service Unavailable"
- Railway showing "Unhealthy" status
- Restart loop (failing readiness probe)

### Triage Steps
1. **Check /ready endpoint**:
   ```bash
   curl https://quotevaultpro.railway.app/ready
   # Should return: {"status":"ok","database":"connected"}
   ```

2. **Check database connectivity**:
   ```bash
   # From Railway shell
   psql $DATABASE_URL -c "SELECT 1"
   ```

3. **Check connection pool**:
   - Neon free tier: 100 concurrent connections max
   - Check Neon dashboard for connection count
   - If exhausted: restart app to reset pool

4. **Check logs**:
   ```bash
   railway logs | grep "\[Health\]"
   railway logs | grep "database connectivity"
   ```

### Common Causes
- **Neon connection limit hit**: Wait or upgrade tier
- **DATABASE_URL invalid**: Verify env var in Railway
- **Network partition**: Check Neon status page
- **App crash loop**: Check for errors before `/ready` checks start

---

## 5. Cross-Tenant Data Leakage Response

### Symptoms
- Customer reports seeing another organization's data
- Audit log shows unauthorized resource access
- Security incident report filed

### Immediate Actions
1. **Isolate affected customer(s)**:
   - Identify organization IDs from incident report
   - Check audit logs: `railway logs | grep "orgId=<affected_org_id>"`

2. **Verify route has tenant guards**:
   ```bash
   # Check if route uses tenantContext middleware
   grep -n "app.get('/api/affected-route'" server/routes.ts
   # Look for: isAuthenticated, tenantContext middleware
   ```

3. **Check query scoping**:
   ```bash
   # Verify query includes organizationId filter
   grep -A 10 "'/api/affected-route'" server/routes.ts | grep organizationId
   ```

4. **Review audit logs for cross-tenant access**:
   ```sql
   -- Run against Neon database
   SELECT * FROM audit_logs 
   WHERE entity_type = 'affected_resource'
     AND created_at > NOW() - INTERVAL '24 hours'
   ORDER BY created_at DESC;
   ```

### Escalation
- If route is missing `tenantContext`: **CRITICAL** - disable route immediately
- If query missing `organizationId` filter: **HIGH** - patch and deploy ASAP
- Notify affected customers per incident response policy

---

## 6. Emergency Kill Switches

### QuickBooks Sync
```bash
# Disable QuickBooks integration completely
FEATURE_QB_SYNC_ENABLED=false
```
**Effect**: Stops invoice/payment sync worker immediately (next tick). No restart required.

### Email Sending
```bash
# Disable all outbound email
FEATURE_EMAIL_ENABLED=false
```
**Effect**: Blocks quote emails, shipment notifications, etc. Immediate (no restart).

### Asset Processing
```bash
# Disable thumbnail generation and asset preview worker
FEATURE_ASSET_PROCESSING_ENABLED=false
```
**Effect**: Stops background workers (next tick). Uploads still accepted but not processed.

### Workers
```bash
# Disable all background workers (nuclear option)
FEATURE_WORKERS_ENABLED=false
```
**Effect**: Stops QB sync, thumbnails, asset previews. Use only for critical resource exhaustion.

---

## Emergency Contacts

- **Railway Dashboard**: https://railway.app/project/quotevaultpro
- **Neon Database**: https://console.neon.tech
- **GitHub Repo**: https://github.com/[org]/QuoteVaultPro (private)
- **On-call**: [Configure PagerDuty / Slack channel]

---

## Quick Reference - Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `RATE_LIMITING_ENABLED` | `true` | Global rate limiting toggle |
| `MAX_REQUESTS_PER_MINUTE_IP` | `100` | IP-based rate limit |
| `MAX_REQUESTS_PER_MINUTE_USER` | `200` | User-based rate limit |
| `UPLOAD_VALIDATION_ENABLED` | `true` | MIME validation toggle |
| `MAX_REQUEST_SIZE` | `10mb` | Body size limit |
| `MAX_CONCURRENT_UPLOADS` | `10` | Upload throttle |
| `GRACEFUL_SHUTDOWN_TIMEOUT_MS` | `30000` | Shutdown grace period |
| `FEATURE_QB_SYNC_ENABLED` | `true` | QuickBooks sync toggle |
| `FEATURE_EMAIL_ENABLED` | `true` | Email sending toggle |
| `FEATURE_ASSET_PROCESSING_ENABLED` | `true` | Asset worker toggle |
| `FEATURE_WORKERS_ENABLED` | `true` | All workers toggle |

**Full reference**: See `.env.example` in repo root.
