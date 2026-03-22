# Plan: Phased routes.ts Extraction (Proof-First)

## Context
- server/routes.ts: ~19,768 lines
- 8 route modules already extracted (attachments, orders, mvpInvoicing, bugReports, invites, me, platform, prepress/routes)
- Upcoming customer proof approval integration requires clean proofing/portal route boundaries
- No schema changes, no endpoint drift, no behavior changes

---

## Already Extracted (Baseline)
| File | Route Prefix | Registration Pattern |
|------|-------------|---------------------|
| server/routes/attachments.routes.ts | /api/objects, /api/assets, /api/quotes/:id/files, /api/uploads | registerAttachmentRoutes(app, {isAuthenticated, tenantContext, isAdmin}) |
| server/routes/orders.routes.ts | /api/orders, /api/workflow/order | registerOrderRoutes(app, {isAuthenticated, tenantContext, isAdmin, isAdminOrOwner}) |
| server/routes/mvpInvoicing.routes.ts | /api/invoices | registerMvpInvoicingRoutes(app, {isAuthenticated, tenantContext}) |
| server/routes/bugReports.ts | /api/bug-reports | registerBugReportRoutes(app, {isAuthenticated, tenantContext}) |
| server/routes/invites.ts | /api/invites | registerInviteRoutes(app) - public |
| server/routes/me.ts | /api/me | registerMeRoutes(app) - no tenantContext |
| server/routes/platform.ts | /api/platform | registerPlatformRoutes(app) - step-up auth |
| server/prepress/routes.ts | /api/prepress/jobs | registerPrepressRoutes(app) - preflight service |

---

## Route Groups Remaining in routes.ts

### GROUP A: Quote CRUD & Workflow (~lines 682–5660, ~4,900 lines)
- Inline helpers: getQuoteWorkflowState, isQuoteLockedFn, assertQuoteEditable, assertValidTransition, cloneQuoteToDraft
- HIGH COMPLEXITY - do NOT extract early

### GROUP B: User Management & Admin Invite (~lines 730–1310, ~580 lines)
- Routes: GET/POST/PATCH/DELETE /api/users, /api/admin/users, /api/auth/set-password
- Clean middleware: isAuthenticated, tenantContext, requireOrgOwnerAdmin/isAdminOrOwner
- No inline helpers
- MEDIUM complexity, LOW risk

### GROUP C: Organization Management (~lines 1310–1745, ~435 lines)
- Routes: GET/PUT/PATCH /api/organizations, /api/organization/preferences, /api/organization/current, /api/admin/storage-settings
- Helpers: resolveInventoryPolicyFromOrgPreferences, resolveQuickBooksPreferencesFromOrgPreferences, normalizeInventoryPolicyPatch, mergeInventoryPolicyIntoPreferences
- MEDIUM complexity

### GROUP D: Products + PBV2 (~lines 1800–3800, ~2,000 lines)
- Routes: /api/products, /api/product-types, /api/admin/products/import|export, /api/products/:id/pbv2/...
- Very complex (PBV2 tree lifecycle, import/export mappers)
- Do NOT extract early

### GROUP E: Customers/CRM (~lines 3800–6500, ~2,700 lines)
- Routes: /api/customers, /api/contacts, /api/notes, /api/credit-transactions

### GROUP F: Materials/Inventory/Vendors (~lines 6500–10000, ~3,500 lines)
- Routes: /api/materials, /api/inventory, /api/vendors, /api/purchase-orders

### GROUP G: Production Config & Stations (~lines 10354–10940, ~590 lines)
- Routes: GET /api/production/config, /api/production/stations, /api/production/steps
- Inline helpers: getProductionConfigForOrganization, loadProductionLineItemStatusRulesForOrganization, getProductionStationStepsForOrganization, getActiveProductionStationsForOrganization, ensureActiveStationExists, getProductionStationStepKeysForStation, getProductionStationStepState, createProductionStationStep
- HIGH coupling via shared production config helpers (must move with GROUP H)

### GROUP H: Production Jobs (~lines 10941–12995, ~2,050 lines)
- Routes: GET/POST /api/production/jobs, /api/production/jobs/:jobId/start|stop|complete|reopen|reprint|routing|note
- Inline helpers: getTimerStateForJob, appendEvent, toSeconds
- assertInternalUser called 15+ times
- TIGHTLY COUPLED to GROUP G config helpers - must extract together

### GROUP I: Prepress Queue & Line Item Operations (~lines 13000–15267, ~2,267 lines)
- Routes: GET /api/prepress/queue, /api/prepress/line-item/:id/*, POST /api/prepress/session/start|complete, /api/prepress/line-items/:id/materials-*
- Includes: line item workflow transitions, design job routes (needs_design → in_design → ready_for_prepress)
- assertInternalUser called throughout
- Contains GET /api/orders/:orderId/production/schedule (coupled to order context)
- HIGH complexity

### GROUP J: Internal Proofing Routes (~lines 15268–15583, ~315 lines) ← PRIORITY
- Routes:
  - GET  /api/proofing/queue
  - GET  /api/proofing/line-item/:lineItemId
  - POST /api/proofing/line-item/:lineItemId/versions
  - POST /api/proofing/versions/:proofVersionId/send
  - POST /api/proofing/versions/:proofVersionId/respond
  - (possible 1-2 more between respond and portal boundary)
- Middleware: isAuthenticated, tenantContext + assertInternalUser check inside handlers
- Services: proofingService (listProofingQueue, resolveLineItemProofingTruth, createLineItemProofVersion, recordProofResponse), lineItemWorkflowService (transitionLineItemWorkflowState)
- Workflow states: awaiting_proof_approval, proof_approved
- assertInternalUser dep can be passed as a function dep (established pattern)
- SMALL, SELF-CONTAINED, LOW RISK

### GROUP K: Portal Proof Routes (~lines 15584–15740, ~156 lines) ← PRIORITY
- Routes:
  - GET  /api/portal/proof/:token  (NO auth - public token-based)
  - POST /api/portal/proof/:token/action  (NO auth - public token-based)
- No isAuthenticated, no tenantContext, no portalContext
- Token validation: validateProofToken (from proofAccessTokenService)
- Org resolution: embedded in proof token (not from middleware)
- Services: validateProofToken, recordProofResponse, db.transaction
- DIFFERENT security model from internal routes - MUST be in separate file
- SMALL, ISOLATED, ZERO MIDDLEWARE COUPLING

### GROUP L: Miscellaneous (~lines 15740–19768, ~4,028 lines)
- QuickBooks sync routes, design links, global variables, tax rates, audit logs, fulfillment
- Mixed coupling - defer

---

## Key Inline Helpers (Coupling Map)

| Helper | Defined At | Used By Groups | Extraction Impact |
|--------|-----------|---------------|-------------------|
| assertInternalUser | L10297 | G, H, I, J | Pass as dep to extracted modules |
| getQuoteWorkflowState / assertQuoteEditable / assertValidTransition | L682-727 | A (quotes only) | Must stay in routes.ts until Group A extracted |
| cloneQuoteToDraft | L5660-5740 | A (quotes only) | Same |
| getProductionConfigForOrganization + 7 production config helpers | L9873-10173 | G, H, I | Must move together with G+H bundle |
| getTimerStateForJob, appendEvent, toSeconds | L10310-10354 | H (production jobs) | Move with Group H |
| getActorName | L9324 | H, I | Move with G+H bundle |

---

## Critical Finding: portalContext Is Unused
- portalContext is IMPORTED at line 24 but NEVER USED in routes.ts
- Portal proof routes use token-based auth (validateProofToken) instead
- This is NOT a bug - it's deliberate design for the current proof-only portal surface
- When portal expands (e.g., /api/portal/orders), portalContext will be needed

---

## Phased Extraction Plan

### Phase 1: Planning/Inventory (CURRENT - DONE)
No code changes.

### Phase 2: Extract Proofing Routes (NEXT)
Target: GROUP J (~315 lines internal) + GROUP K (~156 lines portal)
Files to create:
- server/routes/proofing.routes.ts  ← internal staff proof management
- server/routes/portalProof.routes.ts  ← public token-based customer proof
Registration pattern in routes.ts:
  registerProofingRoutes(app, { isAuthenticated, tenantContext, assertInternalUser })
  registerPortalProofRoutes(app)
Stays in routes.ts: everything else
Validation: smoke test all 7 routes, verify assertInternalUser blocks customer role

### Phase 3: Extract Production Config + Jobs (BUNDLE)
Target: GROUP G + GROUP H (~2,640 lines) - must be bundled together
Files to create:
- server/routes/productionConfig.routes.ts
- server/routes/productionJobs.routes.ts
Shared helpers to move: all production config helpers, getTimerStateForJob, appendEvent, toSeconds
Shared between them: assertInternalUser (passed as dep)
Validation: smoke test full production board, verify station/step/job lifecycle

### Phase 4: Extract Prepress Queue & Line Item Operations
Target: GROUP I (~2,267 lines)
File to create: server/routes/prepressQueue.routes.ts (distinct from existing prepress/routes.ts for preflight)
Helpers to move: none new (borrows assertInternalUser dep)
Validation: smoke test prepress queue, session start/complete, material overrides, workflow transitions

### Phase 5: Later (defer)
Groups A, B, C, D, E, F, L - lower priority, higher complexity or smaller payoff relative to risk

---

## Success Criteria Per Phase

### Phase 2 (Proofing)
Routes moved:
  GET  /api/proofing/queue
  GET  /api/proofing/line-item/:lineItemId
  POST /api/proofing/line-item/:lineItemId/versions
  POST /api/proofing/versions/:proofVersionId/send
  POST /api/proofing/versions/:proofVersionId/respond
  GET  /api/portal/proof/:token
  POST /api/portal/proof/:token/action
Files created: proofing.routes.ts, portalProof.routes.ts
Stays in routes.ts: all other groups
Regression risks:
  - assertInternalUser blocks customer role (must test with customer session)
  - Portal proof token validation must reject invalid/expired tokens (403/404)
  - recordProofResponse must still transition workflow state correctly
  - Audit log writes must still include correct organizational context

### Phase 3 (Production Config + Jobs)
Routes moved: ~25 routes across production config, stations, steps, and production jobs
Files created: productionConfig.routes.ts, productionJobs.routes.ts
Regression risks:
  - Production board must render with correct station data
  - Job start/stop/complete must update line item status correctly
  - Timer state must persist correctly
  - All getProductionConfigForOrganization helper calls must resolve from new location

### Phase 4 (Prepress Queue)
Routes moved: ~15+ routes for prepress queue, sessions, line item material operations
Files created: prepressQueue.routes.ts
Regression risks:
  - Prepress queue must filter correctly (ready_for_prepress, in_prepress)
  - Session start must enforce ready_for_prepress state gate
  - Material overrides must persist correctly

---

## Blockers & Coupling Risks

1. **assertInternalUser (L10297):** Defined inline before production routes but used in Groups G-K.
   Mitigation: Pass as dep to all extracted modules (established pattern). Do NOT move to shared middleware file yet (risk of behavior drift).

2. **Production config helpers (L9873-10173):** 8 interdependent functions that form a config caching layer.
   Mitigation: GROUP G and GROUP H must be extracted in the same PR. Cannot separate them safely.

3. **Quote group (Group A)** has 5 inline helpers AND cloneQuoteToDraft that span thousands of lines.
   Mitigation: Defer Group A indefinitely. Too risky without comprehensive integration tests.

4. **prepress/routes.ts namespace collision:** The existing file is for PDF preflight (standalone service). New prepressQueue.routes.ts is for the order/line-item prepress workflow. Must NOT overwrite or import from the existing prepress module.

5. **Missing proofing routes audit:** Lines 15443–15583 (~140 lines) may contain additional internal proofing routes (e.g., manual override, version history). Must read this range before Phase 2 implementation.

---

## Recommended First Implementation Phase

**Phase 2: Extract proofing routes (proofing.routes.ts + portalProof.routes.ts)**

Reasons:
1. SMALLEST extractable cluster (5 internal routes + 2 portal = 7 routes, ~471 lines total)
2. ZERO dependency on production config helpers - only uses external service imports
3. assertInternalUser is the only inline dep - pass as function dep (established pattern)
4. DIRECTLY relevant to upcoming customer proof approval integration
5. Creates clean boundary between internal staff proof management and public customer portal surface
6. Portal proof routes have completely different security model (no auth, token-based) - separating them NOW prevents future accidental regression if auth middleware is added
7. Both files would be small enough to review completely in one PR

---

## Validation Plan Per Phase

### Phase 2 Validation Steps
Manual:
1. curl GET /api/proofing/queue with internal user session → 200 with queue data
2. curl GET /api/proofing/queue with customer session → 403 (assertInternalUser enforces)
3. curl GET /api/portal/proof/:validToken → 200 with proof attachment data
4. curl GET /api/portal/proof/:expiredToken → 403/404
5. curl POST /api/portal/proof/:token/action with approve body → 200, verify workflow state transitions
6. curl POST /api/portal/proof/:token/action on already-resolved proof → 409
7. Confirm audit log rows written with correct organizationId from token context

TypeCheck:
  npm run check (zero new errors)

### Phase 3 Validation Steps
Manual:
1. Verify production board loads (GET /api/production/config)
2. Start and complete a production job, verify line item status updates
3. Add note to job, verify timeline
4. Verify timer state persists across start/stop

TypeCheck:
  npm run check (zero new errors)

### Phase 4 Validation Steps
Manual:
1. Verify prepress queue populates with ready_for_prepress items
2. Start prepress session on a valid item
3. Attempt session start on non-ready item → 400/409
4. Apply material override, verify effective materials endpoint reflects change

TypeCheck:
  npm run check (zero new errors)
