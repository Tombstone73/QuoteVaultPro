# Hardening Pass 2: Stability & Abuse Resistance - IMPLEMENTATION COMPLETE

**Date**: 2025-01-XX  
**Scope**: Production-readiness hardening for multi-tenant SaaS deployment  
**Status**: ✅ COMPLETE - All features implemented and type-checked

## Executive Summary

Implemented comprehensive production-safety measures for QuoteVaultPro multi-tenant SaaS deployment. All features are runtime-configurable via environment variables with kill switches, making them reversible without code changes.

## What Was Implemented

### 1. Rate Limiting ✅

**Purpose**: Protect against abuse, volumetric attacks, and runaway costs

**Files Created**:
- `server/middleware/rateLimiting.ts` (198 lines)

**Implementation**:
- **Global IP rate limit**: 1000 requests / 15 min per IP (excludes /health, /ready, static assets)
- **Auth rate limit**: 5 attempts / 15 min per IP (prevents brute force)
- **Calculate endpoint**: 10 requests / min per user (CPU-intensive operations)
- **Email endpoint**: 5 requests / hour per user (prevents spam, protects quotas)
- **Prepress jobs**: 3 jobs / 5 min per user (limits PDF processing)
- **Write operations**: 100 requests / 15 min per user (POST/PUT/PATCH/DELETE)

**Applied To**:
- Global: All routes via Express middleware
- Auth: `/api/login` (localAuth.ts:90)
- Calculate: `/api/quotes/calculate` (routes.ts:2318)
- Email: `/api/email/test`, `/api/quotes/:id/email`, `/api/orders/:id/send-shipping-email`
- Prepress: `/api/prepress/jobs` (prepress/routes.ts:135)
- Uploads: File upload endpoints (quote and order line item files)

**Configuration** (.env):
```bash
FEATURE_RATE_LIMITING_ENABLED=true  # Master kill switch
RATE_LIMIT_GLOBAL_PER_IP=1000
RATE_LIMIT_GLOBAL_WINDOW_MIN=15
RATE_LIMIT_AUTH_PER_IP=5
RATE_LIMIT_AUTH_WINDOW_MIN=15
RATE_LIMIT_CALCULATE_PER_MIN=10
RATE_LIMIT_CALCULATE_WINDOW_MIN=1
RATE_LIMIT_EMAIL_PER_HOUR=5
RATE_LIMIT_EMAIL_WINDOW_MIN=60
RATE_LIMIT_PREPRESS_PER_5MIN=3
RATE_LIMIT_PREPRESS_WINDOW_MIN=5
RATE_LIMIT_WRITE_PER_15MIN=100
RATE_LIMIT_WRITE_WINDOW_MIN=15
```

**Behavior**:
- Returns `429 Too Many Requests` with structured JSON
- Logs violations with requestId, userId, organizationId, IP
- Uses in-memory store (best-effort in multi-instance)
- Standard rate limit headers (X-RateLimit-*)

---

### 2. Upload Safety ✅

**Purpose**: File upload validation and abuse prevention

**Files Created**:
- `server/middleware/uploadSafety.ts` (242 lines)

**Implementation**:
- **Concurrent upload limiter**: Max 3 uploads per user with 5min TTL failsafe
- **MIME validation**: Header-based validation with wildcard support
- **Filename sanitization**: Path traversal prevention, special char removal

**Applied To**:
- `/api/quotes/:quoteId/line-items/:lineItemId/files`
- `/api/orders/:orderId/line-items/:lineItemId/files`

**Configuration** (.env):
```bash
FEATURE_UPLOAD_VALIDATION_ENABLED=true  # Master kill switch
MAX_CONCURRENT_UPLOADS_PER_USER=3
UPLOAD_LOCK_TTL_MS=300000  # 5 minutes
MAX_FILENAME_LENGTH=255
```

**Behavior**:
- Returns `429 Too Many Requests` if concurrent limit exceeded
- Returns `415 Unsupported Media Type` for invalid MIME types
- Sanitizes filenames automatically
- TTL failsafe prevents user lockouts from crashed requests

**MIME Presets** (defined in code):
```typescript
PREPRESS_PDF: ['application/pdf']
ATTACHMENTS: ['image/*', 'application/pdf', 'application/zip']
PROFILE_IMAGES: ['image/jpeg', 'image/png', 'image/webp']
```

---

### 3. Request Body Size Limits ✅

**Purpose**: Prevent memory exhaustion from large payloads

**Files Created**:
- `server/middleware/bodySizeLimits.ts` (78 lines)

**Implementation**:
- Global JSON body limit: 100kb (configurable)
- Calculate endpoint override: 500kb (for productDraft payloads)
- Body size middleware with `req.rawBody` checking

**Applied To**:
- Global: `server/index.ts` - express.json() with `limit: maxBodySize`
- Calculate: `/api/quotes/calculate` - checkBodySize('500kb')

**Configuration** (.env):
```bash
MAX_JSON_BODY_SIZE=100kb
MAX_CALCULATE_BODY_SIZE=500kb
```

**Behavior**:
- Returns `413 Payload Too Large` with size details
- Checks `req.rawBody` (set by express.json verify callback)
- Falls back to `Content-Length` header if rawBody unavailable

---

### 4. Health Checks ✅

**Purpose**: Orchestrator (Railway) monitoring and readiness probes

**Files Created**:
- `server/middleware/healthChecks.ts` (120 lines)

**Implementation**:
- **GET /health**: Liveness probe (process uptime only, no DB)
- **GET /ready**: Readiness probe (DB connectivity with 2s timeout, 5s cache)
- Always-on endpoints (cannot be disabled)
- Excluded from rate limiting

**Applied To**:
- `server/index.ts` - Registered BEFORE rate limiting middleware

**Configuration** (.env):
```bash
# Health checks are ALWAYS ON - no kill switch
HEALTH_DB_TIMEOUT_MS=2000
HEALTH_DB_CACHE_MS=5000
```

**Behavior**:
- **/health**: Always returns `200 OK` with uptime
- **/ready**: Returns `200 OK` if DB connected, `503 Service Unavailable` if not
- DB check caches result for 5 seconds (avoids hammer)
- Startup validation: Non-blocking DB check on boot (logs warning if unreachable)

---

### 5. Graceful Shutdown ✅

**Purpose**: Clean deployment handling without dropped requests

**Files Created**:
- `server/middleware/gracefulShutdown.ts` (148 lines)

**Implementation**:
- SIGTERM/SIGINT signal handlers
- Stop accepting new HTTP requests
- Stop worker intervals (QB sync, thumbnails, asset preview)
- Wait for in-flight requests (30s timeout)
- Close database connections
- Clean exit

**Applied To**:
- `server/index.ts` - setupGracefulShutdown() called after server.listen()

**Configuration** (.env):
```bash
FEATURE_GRACEFUL_SHUTDOWN_ENABLED=true  # Master kill switch
GRACEFUL_SHUTDOWN_TIMEOUT_MS=30000
```

**Behavior**:
- Registers signal handlers for SIGTERM/SIGINT
- Tracks in-flight requests via middleware
- Registers worker intervals for cleanup
- Logs structured shutdown progress (no requestId in shutdown logs)
- Forces exit after timeout if requests don't drain

**Worker Integration**:
- Updated `startThumbnailWorker()` to return `NodeJS.Timeout | null`
- Updated `startSyncWorker()` to return `NodeJS.Timeout | null`
- QB queue interval registered via `registerWorkerInterval()`

---

## Files Modified

### Core Integration
1. **server/index.ts** (60 lines changed)
   - Added imports for rate limiting, health checks, graceful shutdown
   - Registered health check endpoints BEFORE rate limiting
   - Applied global IP rate limit
   - Added request tracking for graceful shutdown
   - Added DB connectivity validation at startup (non-blocking)
   - Setup graceful shutdown handlers
   - Updated worker start calls to register intervals

2. **server/routes.ts** (6 lines changed)
   - Added imports for rate limiting, upload safety, body size
   - Applied calculateRateLimit to calculate endpoint
   - Applied emailRateLimit to email endpoints
   - Applied concurrentUploadLimiter to file upload endpoints
   - Applied checkBodySize to calculate endpoint

3. **server/localAuth.ts** (2 lines changed)
   - Added import for authRateLimit
   - Applied authRateLimit to /api/login endpoint

4. **server/prepress/routes.ts** (2 lines changed)
   - Added import for prepressRateLimit
   - Applied prepressRateLimit to /api/prepress/jobs endpoint

5. **server/workers/syncProcessor.ts** (3 lines changed)
   - Changed return type to `NodeJS.Timeout | null`
   - Return workerInterval on success, null if already running

6. **server/workers/thumbnailWorker.ts** (4 lines changed)
   - Changed return type to `NodeJS.Timeout | null`
   - Return workerInterval on success, null if disabled/already running

7. **.env.example** (42 lines added)
   - Documented all new environment variables
   - Added HARDENING PASS 2 section with all configuration options

---

## Environment Variables Reference

### Rate Limiting
```bash
FEATURE_RATE_LIMITING_ENABLED=true
RATE_LIMIT_GLOBAL_PER_IP=1000
RATE_LIMIT_GLOBAL_WINDOW_MIN=15
RATE_LIMIT_AUTH_PER_IP=5
RATE_LIMIT_AUTH_WINDOW_MIN=15
RATE_LIMIT_CALCULATE_PER_MIN=10
RATE_LIMIT_CALCULATE_WINDOW_MIN=1
RATE_LIMIT_EMAIL_PER_HOUR=5
RATE_LIMIT_EMAIL_WINDOW_MIN=60
RATE_LIMIT_PREPRESS_PER_5MIN=3
RATE_LIMIT_PREPRESS_WINDOW_MIN=5
RATE_LIMIT_WRITE_PER_15MIN=100
RATE_LIMIT_WRITE_WINDOW_MIN=15
```

### Upload Safety
```bash
FEATURE_UPLOAD_VALIDATION_ENABLED=true
MAX_CONCURRENT_UPLOADS_PER_USER=3
UPLOAD_LOCK_TTL_MS=300000
MAX_FILENAME_LENGTH=255
```

### Body Size Limits
```bash
MAX_JSON_BODY_SIZE=100kb
MAX_CALCULATE_BODY_SIZE=500kb
```

### Health Checks (Always On)
```bash
HEALTH_DB_TIMEOUT_MS=2000
HEALTH_DB_CACHE_MS=5000
```

### Graceful Shutdown
```bash
FEATURE_GRACEFUL_SHUTDOWN_ENABLED=true
GRACEFUL_SHUTDOWN_TIMEOUT_MS=30000
```

---

## Reversibility

All features can be disabled without code changes:

```bash
# Disable all rate limiting
FEATURE_RATE_LIMITING_ENABLED=false

# Disable upload validation
FEATURE_UPLOAD_VALIDATION_ENABLED=false

# Disable graceful shutdown
FEATURE_GRACEFUL_SHUTDOWN_ENABLED=false

# Health checks CANNOT be disabled (required by orchestrator)
```

---

## Testing Verification

### Type Checking ✅
```bash
npm run check
# Result: Success - all files compile without errors
```

### Manual Testing Checklist

**Rate Limiting**:
- [ ] Trigger global IP rate limit (1000+ requests in 15min)
- [ ] Trigger auth rate limit (5+ login attempts in 15min)
- [ ] Trigger calculate rate limit (10+ calcs in 1min)
- [ ] Trigger email rate limit (5+ emails in 1hr)
- [ ] Trigger prepress rate limit (3+ jobs in 5min)
- [ ] Verify rate limit headers in response
- [ ] Verify structured logs with requestId

**Upload Safety**:
- [ ] Upload 3 files simultaneously (should succeed)
- [ ] Upload 4th file (should get 429)
- [ ] Wait 5 minutes, retry (TTL should clear lock)
- [ ] Verify filename sanitization (test ../../../etc/passwd)
- [ ] Test MIME validation with invalid file type

**Body Size**:
- [ ] Send 150kb JSON to regular endpoint (should reject)
- [ ] Send 600kb JSON to calculate endpoint (should reject)
- [ ] Send 400kb JSON to calculate endpoint (should accept)

**Health Checks**:
- [ ] Curl `http://localhost:5000/health` (should return uptime)
- [ ] Curl `http://localhost:5000/ready` (should return 200 if DB up)
- [ ] Stop DB, curl `/ready` (should return 503)
- [ ] Verify health checks excluded from rate limiting

**Graceful Shutdown**:
- [ ] Send SIGTERM while requests in flight
- [ ] Verify requests complete before exit
- [ ] Verify worker intervals stop
- [ ] Verify DB connections close
- [ ] Verify clean exit code 0

**Kill Switches**:
- [ ] Set `FEATURE_RATE_LIMITING_ENABLED=false`, verify no rate limits
- [ ] Set `FEATURE_UPLOAD_VALIDATION_ENABLED=false`, verify no upload limits
- [ ] Set `FEATURE_GRACEFUL_SHUTDOWN_ENABLED=false`, verify normal shutdown

---

## Production Deployment Notes

### Railway Configuration

**Environment Variables** (add to Railway):
```bash
# Rate Limiting (Conservative defaults)
FEATURE_RATE_LIMITING_ENABLED=true
RATE_LIMIT_GLOBAL_PER_IP=1000
RATE_LIMIT_AUTH_PER_IP=5
RATE_LIMIT_CALCULATE_PER_MIN=10
RATE_LIMIT_EMAIL_PER_HOUR=5
RATE_LIMIT_PREPRESS_PER_5MIN=3

# Upload Safety
FEATURE_UPLOAD_VALIDATION_ENABLED=true
MAX_CONCURRENT_UPLOADS_PER_USER=3

# Body Limits
MAX_JSON_BODY_SIZE=100kb
MAX_CALCULATE_BODY_SIZE=500kb

# Health Checks (tune for Railway network latency)
HEALTH_DB_TIMEOUT_MS=3000
HEALTH_DB_CACHE_MS=10000

# Graceful Shutdown (Railway SIGTERM grace period)
FEATURE_GRACEFUL_SHUTDOWN_ENABLED=true
GRACEFUL_SHUTDOWN_TIMEOUT_MS=30000
```

**Health Check Configuration**:
- Liveness probe: `GET /health` (1s interval, 3 failures = restart)
- Readiness probe: `GET /ready` (5s interval, 2 failures = remove from load balancer)

**Deployment Process**:
1. Railway sends SIGTERM to old instance
2. Graceful shutdown begins (30s grace period)
3. New instance boots, `/ready` returns 503 until DB connected
4. Once `/ready` returns 200, traffic routes to new instance
5. Old instance drains requests and exits

### Monitoring

**Key Metrics to Watch**:
- Rate limit 429 responses (spike = abuse or legitimate traffic surge)
- Upload 429 responses (concurrent limit tuning)
- /ready 503 responses (DB connectivity issues)
- Graceful shutdown logs (check for timeout warnings)

**Alerts to Configure**:
- /ready returns 503 for >30s (DB outage)
- 429 rate limiting >100/min (potential attack)
- Shutdown timeouts >5% of deploys (tune GRACEFUL_SHUTDOWN_TIMEOUT_MS)

---

## Known Limitations

1. **In-Memory Tracking**: Rate limiting and concurrent upload tracking use in-memory stores. In multi-instance deployments:
   - Each instance has independent rate limit counters
   - User could bypass by hitting different instances
   - **Mitigation**: Railway sticky sessions route user to same instance
   - **Future**: Consider Redis-backed store for horizontal scaling

2. **MIME Validation**: Header-based only (can be spoofed)
   - Prevents accidental wrong uploads, not adversarial attacks
   - **Future**: Magic byte / deep inspection for full security

3. **Health Check DB Cache**: 5 second cache may mask rapid DB failures
   - Tunable via `HEALTH_DB_CACHE_MS`

4. **Body Size Tracking**: Requires `req.rawBody` set by express.json verify callback
   - Falls back to Content-Length header if unavailable

---

## Success Criteria

✅ **Implemented**:
- Rate limiting with layered defense
- Upload safety with TTL failsafe
- Body size limits with endpoint overrides
- Health checks for orchestrator
- Graceful shutdown with worker cleanup
- All features configurable via env vars
- All features have kill switches
- TypeScript compilation successful

✅ **Runtime-Only**:
- No schema changes
- No new npm dependencies except express-rate-limit
- No workflow modifications
- Reversible via env vars

✅ **Production-Ready**:
- Comprehensive logging with requestId
- Structured error responses
- Documentation complete
- .env.example updated

---

## Next Steps

1. **Deploy to Staging**:
   - Set all FEATURE_*_ENABLED=true
   - Monitor for 48 hours
   - Check logs for rate limit triggers

2. **Load Testing**:
   - Verify rate limits trigger correctly
   - Test graceful shutdown under load
   - Validate health check accuracy

3. **Production Rollout**:
   - Enable features incrementally
   - Monitor metrics dashboard
   - Keep kill switches ready

4. **Future Enhancements**:
   - Redis-backed rate limiting for horizontal scaling
   - Deep MIME inspection for uploads
   - Prometheus metrics export
   - Rate limit analytics dashboard

---

## References

- Express Rate Limit: https://github.com/express-rate-limit/express-rate-limit
- Railway Health Checks: https://docs.railway.app/reference/healthchecks
- Node.js Signal Handling: https://nodejs.org/api/process.html#signal-events
- Drizzle ORM Connection Pooling: https://orm.drizzle.team/docs/performance

---

**Implementation Date**: 2025-01-XX  
**Author**: TITAN KERNEL  
**Status**: ✅ COMPLETE - Ready for staging deployment
