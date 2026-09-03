/**
 * quickbooks.routes.ts
 *
 * QuickBooks / accounting sync routes extracted from server/routes.ts.
 *
 * Routes:
 *   GET  /api/integrations/quickbooks/status
 *   GET  /api/integrations/quickbooks/queue
 *   POST /api/integrations/quickbooks/flush
 *   GET  /api/integrations/quickbooks/auth-url
 *   GET  /api/integrations/quickbooks/callback       (unauthenticated — QB OAuth redirect)
 *   POST /api/integrations/quickbooks/disconnect
 *   POST /api/integrations/quickbooks/sync/pull
 *   POST /api/integrations/quickbooks/sync/push
 *   GET  /api/integrations/quickbooks/jobs
 *   GET  /api/integrations/quickbooks/jobs/:id
 *   POST /api/integrations/quickbooks/jobs/trigger
 *   GET  /api/integrations/quickbooks/worker/status
 *   GET  /api/integrations/quickbooks/debug/invoice/:invoiceNumber
 *   GET  /api/integrations/quickbooks/debug/customer-search
 *   GET  /api/integrations/quickbooks/debug/customer/:customerId
 *
 * Placement: server/routes/quickbooks.routes.ts
 * Registered by: server/routes.ts via registerQuickBooksRoutes
 */

import type { Express } from "express";
import { and, desc, eq } from "drizzle-orm";
import { accountingSyncJobs, organizations } from "@shared/schema";
import { db } from "../db";
import { getRequestOrganizationId } from "../tenantContext";
import * as quickbooksService from "../quickbooksService";
import * as syncWorker from "../workers/syncProcessor";
import {
  getQuickBooksSyncStabilityWindowMs,
  enqueueSelectedQuickBooksSyncForOrg,
  getQuickBooksSyncQueueCountsForOrg,
  type QuickBooksSyncQueueView,
  runQuickBooksSyncWorkerForOrg,
} from "../services/quickbooksSyncQueueWorker";
import { resolveQuickBooksPreferencesFromOrgPreferences } from "@shared/quickBooksPreferences";
import { requireDeveloperAccess } from "../middleware/requireDeveloperAccess";
import { z } from 'zod';

export function registerQuickBooksRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    isAdminOrOwner: any;
  },
): void {
  const { isAuthenticated, tenantContext, isAdminOrOwner } = middleware;

  // ==================== QuickBooks Integration Routes ====================
  // Note: QuickBooks connection is currently per-organization (stored with organizationId).
  // These routes use tenantContext to ensure the user has access to view/manage the connection.

  /**
   * GET /api/integrations/quickbooks/status
   * Check QuickBooks connection status for current organization
   */
  app.get('/api/integrations/quickbooks/status', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const status = await quickbooksService.getQuickBooksCustomerMigrationSourceStatus(organizationId);
      res.json({
        connected: status.connected,
        state: status.state,
        authState: status.authState,
        healthState: status.healthState,
        healthMessage: status.healthMessage,
        lastErrorAt: status.lastErrorAt,
        lastErrorCode: status.lastErrorCode,
        lastErrorMessage: status.lastErrorMessage,
        lastErrorStage: status.lastErrorStage,
        lastErrorHttpStatus: status.lastErrorHttpStatus,
        lastOAuthError: status.lastOAuthError,
        lastOAuthErrorDescription: status.lastOAuthErrorDescription,
        lastSuccessfulRefreshAt: status.lastSuccessfulRefreshAt,
        lastSuccessfulRequestAt: status.lastSuccessfulRequestAt,
        consecutiveTransientFailureCount: status.consecutiveTransientFailureCount,
        requiresUserAction: status.requiresUserAction,
        message: status.state === 'degraded'
          ? 'QuickBooks is temporarily unavailable. Printers Hero will retry automatically.'
          : status.state === 'needs_reauth'
            ? status.lastErrorMessage || 'QuickBooks connection needs reauthorization'
            : status.connected
              ? 'QuickBooks connected'
              : 'QuickBooks not connected',
        companyId: status.quickBooksCompanyId,
        connectedCompanyName: status.connectedCompanyName,
        connectedAt: status.connectedAt,
        expiresAt: status.expiresAt,
      });
    } catch (error: any) {
      console.error('[QB Status] Error:', error);
      res.status(500).json({ error: 'Failed to check QuickBooks status' });
    }
  });

  /**
   * GET /api/integrations/quickbooks/queue
   * Derived outbox-like queue (no QuickBooks API calls)
   */
  app.get('/api/integrations/quickbooks/queue', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: 'Missing organization context' });

      const stabilityWindowMs = getQuickBooksSyncStabilityWindowMs();
      const data = await getQuickBooksSyncQueueCountsForOrg({ organizationId, stabilityWindowMs });
      return res.json({ success: true, data });
    } catch (error: any) {
      console.error('[QB Queue] Error:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch QuickBooks sync queue' });
    }
  });

  app.get('/api/integrations/quickbooks/queue/items', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: 'Missing organization context' });
      const page = Math.max(1, Number(req.query.page || 1));
      const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize || 25)));
      const view = String(req.query.view || 'all') as QuickBooksSyncQueueView;
      const data = await syncWorker.listQuickBooksSyncQueueItemsForOrg({ organizationId, page, pageSize, search: String(req.query.search || ''), view });
      return res.json({ success: true, data });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message || 'Failed to list QuickBooks sync queue items' });
    }
  });

  app.post('/api/integrations/quickbooks/queue/enqueue-selected', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    const parsed = z.object({
      items: z.array(z.object({ id: z.string().min(1), resourceType: z.enum(['invoice', 'payment']) })).min(1).max(100),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: 'Select between 1 and 100 local accounting records.' });
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: 'Missing organization context' });
      const data = await enqueueSelectedQuickBooksSyncForOrg({ organizationId, items: parsed.data.items });
      return res.json({ success: true, data });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message || 'Failed to queue selected accounting records' });
    }
  });

  app.post('/api/integrations/quickbooks/queue/sync-selected', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    const parsed = z.object({
      items: z.array(z.object({ id: z.string().min(1), resourceType: z.enum(['invoice', 'payment']) })).min(1).max(100),
    }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, error: 'Select between 1 and 100 QuickBooks queue records.' });
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: 'Missing organization context' });
      const data = await syncWorker.runSelectedQuickBooksSyncForOrg({ organizationId, items: parsed.data.items });
      return res.json({ success: true, data });
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error.message || 'Selected QuickBooks sync failed' });
    }
  });

  /**
   * POST /api/integrations/quickbooks/flush
   * Manual run: bypasses the timer but still respects the stability window.
   * Pass { force: true } only for explicit test/operator override.
   */
  app.post('/api/integrations/quickbooks/flush', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ success: false, error: 'Missing organization context' });

      const stabilityWindowMs = getQuickBooksSyncStabilityWindowMs();
      const limitPerRun = Math.max(1, Math.min(100, Number(process.env.QB_SYNC_LIMIT_PER_RUN || '25')));
      const force = req.body?.force === true;

      const result = await runQuickBooksSyncWorkerForOrg({
        organizationId,
        stabilityWindowMs,
        limitPerRun,
        ignoreStabilityWindow: force,
        includeFailed: true,
        log: true,
      });

      return res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('[QB Flush] Error:', error);
      // Fail-soft: never crash; return envelope.
      return res.status(500).json({ success: false, error: error.message || 'Failed to flush QuickBooks sync queue' });
    }
  });

  /**
   * GET /api/integrations/quickbooks/auth-url
   * Get OAuth authorization URL to redirect user to QuickBooks
   */
  app.get('/api/integrations/quickbooks/auth-url', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);

      const authUrl = await quickbooksService.getAuthorizationUrlForOrganization(organizationId);

      // Always-on safe diagnostic — logs host/path only, never client secret or tokens.
      {
        const cfgUri = process.env.QUICKBOOKS_REDIRECT_URI || process.env.QB_REDIRECT_URI || '';
        const env = process.env.QUICKBOOKS_ENVIRONMENT || process.env.QB_ENV || 'sandbox (default)';
        let cfgHost = '(not set)'; let cfgPath = '(not set)';
        try { if (cfgUri) { const u = new URL(cfgUri); cfgHost = u.host; cfgPath = u.pathname; } } catch {}
        // Parse what the library actually embedded in the authorization URL.
        let embeddedHost = '(parse error)'; let embeddedPath = '(parse error)';
        let redirectUriPresent = false; let configuredMatchesEmbedded = false;
        try {
          const au = new URL(authUrl);
          const embedded = au.searchParams.get('redirect_uri');
          redirectUriPresent = !!embedded;
          if (embedded) {
            const eu = new URL(embedded);
            embeddedHost = eu.host;
            embeddedPath = eu.pathname;
            configuredMatchesEmbedded = cfgHost === embeddedHost && cfgPath === embeddedPath;
          }
        } catch {}
        console.log('[QB Auth URL] Authorization URL generated', {
          environment: env,
          hasClientId: !!(process.env.QUICKBOOKS_CLIENT_ID || process.env.QB_CLIENT_ID),
          hasSessionSecret: !!process.env.SESSION_SECRET,
          configuredRedirectUriHost: cfgHost,
          configuredRedirectUriPath: cfgPath,
          authUrlContainsRedirectUri: redirectUriPresent,
          embeddedRedirectUriHost: embeddedHost,
          embeddedRedirectUriPath: embeddedPath,
          configuredMatchesEmbedded,
          organizationId,
        });
      }

      res.json({ authUrl });
    } catch (error: any) {
      console.error('[QB Auth URL] Error:', error);
      res.status(500).json({ error: error.message || 'Failed to generate auth URL' });
    }
  });

  /**
   * GET /api/integrations/quickbooks/callback
   * OAuth callback endpoint - QuickBooks redirects here after user authorizes
   * Note: This is an unauthenticated redirect from QuickBooks.
   * The organizationId should be passed via the OAuth state parameter in production.
   */
  app.get('/api/integrations/quickbooks/callback', async (req: any, res) => {
    // Hoisted so the catch block can emit safe diagnostics regardless of where the throw occurred.
    let parsedState: { organizationId: string } | null = null;
    let callbackRealmId: string | undefined;
    let fullCallbackUrl: string | undefined;

    try {
      const { code, realmId, state, error: authError } = req.query;
      callbackRealmId = typeof realmId === 'string' ? realmId : undefined;

      // Debug logging for OAuth callback (gated by DEBUG_QB_OAUTH)
      if (process.env.DEBUG_QB_OAUTH === 'true') {
        const realmIdStr = typeof realmId === 'string' ? realmId : '';
        console.log('[QB Callback] Received callback', {
          path: req.path,
          queryKeys: Object.keys(req.query),
          hasCode: typeof code === 'string' && code.length > 0,
          codeLength: typeof code === 'string' ? code.length : 0,
          hasRealmId: typeof realmId === 'string' && realmId.length > 0,
          realmIdPreview: realmIdStr.length > 4 ? realmIdStr.substring(0, 4) + '...' : '',
          realmIdLength: realmIdStr.length,
          hasState: typeof state === 'string' && state.length > 0,
          hasError: !!authError,
        });
      }

      if (authError) {
        console.error('[QB Callback] OAuth error:', authError);
        return res.redirect('/settings/integrations?qb_error=' + encodeURIComponent(authError));
      }

      if (!code) {
        console.error('[QB Callback] Missing authorization code');
        return res.redirect('/settings/integrations?qb_error=' + encodeURIComponent('missing_code'));
      }

      if (!realmId) {
        console.error('[QB Callback] Missing realmId');
        return res.redirect('/settings/integrations?qb_error=' + encodeURIComponent('missing_realmId'));
      }

      parsedState = quickbooksService.parseOAuthState(state as any);
      if (!parsedState?.organizationId) {
        console.error('[QB Callback] State parse failed', {
          hasState: typeof state === 'string' && (state as string).length > 0,
          hasSessionSecret: !!process.env.SESSION_SECRET,
        });
        return res.redirect('/settings/integrations?qb_error=' + encodeURIComponent('Invalid OAuth state'));
      }

      // Build full callback URL with query params for token exchange
      const proto = req.headers['x-forwarded-proto'] ?? req.protocol;
      const host = req.headers['x-forwarded-host'] ?? req.get('host');
      fullCallbackUrl = `${proto}://${host}${req.originalUrl}`;

      if (process.env.DEBUG_QB_OAUTH === 'true') {
        console.log('[QB Callback] Constructed full callback URL', {
          hasFullUrl: !!fullCallbackUrl,
          protocol: proto,
          host,
          pathOnly: req.path,
        });
      }

      await quickbooksService.exchangeCodeForTokens(fullCallbackUrl, realmId as string, parsedState.organizationId);

      // Redirect to integrations tab with success — component reads qb_connected param on mount
      res.redirect('/settings/integrations?qb_connected=true');
    } catch (error: any) {
      const configuredRedirectUri = process.env.QUICKBOOKS_REDIRECT_URI || process.env.QB_REDIRECT_URI || '';
      let configuredHost = '(not set)';
      let configuredPath = '(not set)';
      let constructedHost = '(not built)';
      let redirectUriHostMatch: boolean | '(error)' = false;
      try {
        if (configuredRedirectUri) {
          const u = new URL(configuredRedirectUri);
          configuredHost = u.host;
          configuredPath = u.pathname;
        }
      } catch { configuredHost = '(parse error)'; }
      try {
        if (fullCallbackUrl) {
          constructedHost = new URL(fullCallbackUrl).host;
          redirectUriHostMatch = constructedHost === configuredHost;
        }
      } catch { constructedHost = '(parse error)'; redirectUriHostMatch = '(error)'; }

      const intuitError = error?.response?.data?.error
        || error?.error_description
        || error?.intuit_error_code
        || undefined;
      const intuitTid = error?.intuit_tid
        || error?.response?.headers?.['intuit_tid']
        || undefined;

      console.error('[QB Callback] Token exchange failed', {
        errorName: error?.name,
        errorMessage: String(error?.message || '').slice(0, 300),
        errorStatus: error?.status ?? error?.statusCode ?? error?.response?.status,
        intuitError,
        intuitTid,
        environment: process.env.QUICKBOOKS_ENVIRONMENT || process.env.QB_ENV || 'sandbox (default)',
        hasClientId: !!(process.env.QUICKBOOKS_CLIENT_ID || process.env.QB_CLIENT_ID),
        hasClientSecret: !!(process.env.QUICKBOOKS_CLIENT_SECRET || process.env.QB_CLIENT_SECRET),
        hasRedirectUri: !!configuredRedirectUri,
        configuredRedirectUriHost: configuredHost,
        configuredRedirectUriPath: configuredPath,
        constructedCallbackHost: constructedHost,
        redirectUriHostMatch,
        orgIdPresent: !!parsedState?.organizationId,
        realmIdPresent: !!callbackRealmId,
        callbackUrlBuilt: !!fullCallbackUrl,
      });
      res.redirect('/settings/integrations?qb_error=' + encodeURIComponent('connection_failed'));
    }
  });

  /**
   * POST /api/integrations/quickbooks/disconnect
   * Disconnect QuickBooks integration for current organization
   */
  app.post('/api/integrations/quickbooks/disconnect', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      await quickbooksService.disconnectConnectionForOrganization(organizationId);
      res.json({ success: true, message: 'QuickBooks disconnected' });
    } catch (error: any) {
      console.error('[QB Disconnect] Error:', error);
      res.status(500).json({ error: 'Failed to disconnect QuickBooks' });
    }
  });

  /**
   * POST /api/integrations/quickbooks/sync/pull
   * Queue pull sync jobs to fetch data FROM QuickBooks
   * Body: { resources: ['customers', 'invoices', 'orders'] }
   */
  app.post('/api/integrations/quickbooks/sync/pull', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const { resources } = req.body;

      if (!Array.isArray(resources) || resources.length === 0) {
        return res.status(400).json({ error: 'Resources array required' });
      }

      const validResources = ['customers', 'invoices', 'orders'];
      const invalidResources = resources.filter((r: string) => !validResources.includes(r));

      if (invalidResources.length > 0) {
        return res.status(400).json({
          error: `Invalid resources: ${invalidResources.join(', ')}`,
          validResources
        });
      }

      await quickbooksService.queueSyncJobsForOrganization(organizationId, 'pull', resources);

      res.json({
        success: true,
        message: `Queued ${resources.length} pull sync job(s)`,
        resources
      });
    } catch (error: any) {
      console.error('[QB Pull Sync] Error:', error);
      res.status(500).json({ error: error.message || 'Failed to queue pull sync' });
    }
  });

  /**
   * POST /api/integrations/quickbooks/sync/push
   * Queue push sync jobs to send data TO QuickBooks
   * Body: { resources: ['customers', 'invoices', 'orders'] }
   */
  app.post('/api/integrations/quickbooks/sync/push', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const { resources } = req.body;

      // Enforce queue-only policy by default: disable legacy "push" job queuing.
      const [org] = await db
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      const rawPreferences = (org?.settings as any)?.preferences;
      const preferences = rawPreferences && typeof rawPreferences === 'object' ? rawPreferences : {};
      const qbSyncPolicy = resolveQuickBooksPreferencesFromOrgPreferences(preferences).syncPolicy;
      if (qbSyncPolicy === 'queue_only') {
        return res.status(409).json({
          success: false,
          error: 'QuickBooks push is disabled by syncPolicy=queue_only. Use the QuickBooks Sync Queue (scheduled worker / Sync now) or per-item Sync buttons.',
          syncPolicy: qbSyncPolicy,
        });
      }

      if (!Array.isArray(resources) || resources.length === 0) {
        return res.status(400).json({ error: 'Resources array required' });
      }

      const validResources = ['customers', 'invoices', 'orders'];
      const invalidResources = resources.filter((r: string) => !validResources.includes(r));

      if (invalidResources.length > 0) {
        return res.status(400).json({
          error: `Invalid resources: ${invalidResources.join(', ')}`,
          validResources
        });
      }

      await quickbooksService.queueSyncJobsForOrganization(organizationId, 'push', resources);

      res.json({
        success: true,
        message: `Queued ${resources.length} push sync job(s)`,
        resources
      });
    } catch (error: any) {
      console.error('[QB Push Sync] Error:', error);
      res.status(500).json({ error: error.message || 'Failed to queue push sync' });
    }
  });

  /**
   * GET /api/integrations/quickbooks/jobs
   * Get list of sync jobs with status for current organization
   */
  app.get('/api/integrations/quickbooks/jobs', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const { status, limit = 50 } = req.query;

      // Filter jobs by organizationId
      const conditions = [eq(accountingSyncJobs.organizationId, organizationId)];
      if (status) {
        conditions.push(eq(accountingSyncJobs.status, status));
      }

      const jobs = await db
        .select()
        .from(accountingSyncJobs)
        .where(and(...conditions))
        .orderBy(desc(accountingSyncJobs.createdAt))
        .limit(parseInt(limit as string, 10));

      res.json({ jobs });
    } catch (error: any) {
      console.error('[QB Jobs] Error:', error);
      res.status(500).json({ error: 'Failed to fetch sync jobs' });
    }
  });

  /**
   * GET /api/integrations/quickbooks/jobs/:id
   * Get specific sync job details (verifies organization ownership)
   */
  app.get('/api/integrations/quickbooks/jobs/:id', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const [job] = await db
        .select()
        .from(accountingSyncJobs)
        .where(and(
          eq(accountingSyncJobs.id, req.params.id),
          eq(accountingSyncJobs.organizationId, organizationId)
        ))
        .limit(1);

      if (!job) {
        return res.status(404).json({ error: 'Job not found' });
      }

      res.json({ job });
    } catch (error: any) {
      console.error('[QB Job Detail] Error:', error);
      res.status(500).json({ error: 'Failed to fetch job' });
    }
  });

  /**
   * POST /api/integrations/quickbooks/jobs/trigger
   * Manually trigger sync worker to process pending jobs
   */
  app.post('/api/integrations/quickbooks/jobs/trigger', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const [org] = await db
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      const rawPreferences = (org?.settings as any)?.preferences;
      const preferences = rawPreferences && typeof rawPreferences === 'object' ? rawPreferences : {};
      const qbSyncPolicy = resolveQuickBooksPreferencesFromOrgPreferences(preferences).syncPolicy;

      // Under queue-only, treat the legacy trigger as a flush of the derived queue.
      if (qbSyncPolicy === 'queue_only') {
        const stabilityWindowMs = getQuickBooksSyncStabilityWindowMs();
        const limitPerRun = Math.max(1, Math.min(100, Number(process.env.QB_SYNC_LIMIT_PER_RUN || '25')));
        const force = req.body?.force === true;

        const result = await runQuickBooksSyncWorkerForOrg({
          organizationId,
          stabilityWindowMs,
          limitPerRun,
          ignoreStabilityWindow: force,
          includeFailed: true,
          log: true,
        });

        return res.json({
          success: true,
          message: 'QuickBooks queue flush completed',
          data: result,
          syncPolicy: qbSyncPolicy,
        });
      }

      // Otherwise, trigger the legacy job processor (non-blocking)
      syncWorker.triggerJobProcessing().catch((error) => {
        console.error('[QB Manual Trigger] Error:', error);
      });

      return res.json({
        success: true,
        message: 'Sync job processing triggered',
        syncPolicy: qbSyncPolicy,
      });
    } catch (error: any) {
      console.error('[QB Manual Trigger] Error:', error);
      res.status(500).json({ error: 'Failed to trigger sync' });
    }
  });

  /**
   * GET /api/integrations/quickbooks/worker/status
   * Get sync worker status
   */
  app.get('/api/integrations/quickbooks/worker/status', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const status = syncWorker.getWorkerStatus();
      res.json(status);
    } catch (error: any) {
      console.error('[QB Worker Status] Error:', error);
      res.status(500).json({ error: 'Failed to get worker status' });
    }
  });

  /**
   * GET /api/integrations/quickbooks/import-preview/invoices
   * Read-only, bounded preview of QB invoices with local match status.
   * Returns classification (open_ar vs historical), already-imported flag,
   * and canImport flag. No writes — safe to call repeatedly.
   *
   * Query params:
   *   scope=open_ar|historical|all_unsynced (defaults to open_ar)
   *   page=1..n, pageSize=25|50|100|200 (defaults to 50)
   *   debugReferenceFields=1  (admin/owner only, already enforced by isAdminOrOwner)
   *     When present, each preview row includes a `referenceDebug` object with
   *     custom fields, privateNote, customerMemo, and line descriptions — used
   *     to inspect where PO/reference data lives before finalising extraction rules.
   */
  app.get('/api/integrations/quickbooks/import-preview/invoices', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const includeReferenceDebug = req.query.debugReferenceFields === '1';
      const scope = String(req.query.scope ?? 'open_ar');
      const page = Number(req.query.page ?? 1);
      const pageSize = Number(req.query.pageSize ?? 50);
      if (!['open_ar', 'historical', 'all_unsynced'].includes(scope)) {
        return res.status(400).json({ success: false, error: 'scope must be one of: open_ar, historical, all_unsynced' });
      }
      if (!Number.isInteger(page) || page < 1) {
        return res.status(400).json({ success: false, error: 'page must be a positive integer' });
      }
      if (![25, 50, 100, 200].includes(pageSize)) {
        return res.status(400).json({ success: false, error: 'pageSize must be one of: 25, 50, 100, 200' });
      }
      const preview = await quickbooksService.fetchQBInvoicePreviewPage({
        organizationId,
        scope: scope as quickbooksService.QBInvoicePreviewScope,
        page,
        pageSize,
        includeReferenceDebug,
      });
      return res.json({ success: true, data: preview });
    } catch (error: any) {
      console.error('[QB Invoice Preview] Error:', error);
      return res.status(500).json({ success: false, error: error.message || 'Failed to fetch invoice preview' });
    }
  });

  /**
   * POST /api/integrations/quickbooks/import/invoices
   * Import selected QB invoices into TitanOS.
   * Body: { quickBooksInvoiceIds: string[], mode: 'auto' | 'open_ar' | 'historical' }
   *
   * Safety contract (enforced in quickbooksService.importQBInvoicesByIds):
   *   - No orders, production jobs, or workflow records created.
   *   - No invoice email triggers.
   *   - No QB push sync enqueued for imported invoices.
   *   - Line items stored as JSON snapshot only (not in invoice_line_items).
   */
  app.post('/api/integrations/quickbooks/import/invoices', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const userId: string | undefined = (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Missing user context' });
      }

      const { quickBooksInvoiceIds: rawIds, mode: rawMode, invoiceModes: rawInvoiceModes, invoices: invoicesArray } = req.body;
      const validClassifications = ['open_ar', 'historical', 'skip'] as const;

      let ids: string[];
      let resolvedMode: 'auto' | 'open_ar' | 'historical';
      const perInvoiceModes: Record<string, 'open_ar' | 'historical' | 'skip'> = {};

      if (Array.isArray(invoicesArray)) {
        // New format: { invoices: [{ qbId, classification }], mode: 'suggested'|'open_ar'|'historical' }
        if (invoicesArray.length === 0) {
          return res.status(400).json({ success: false, error: 'invoices array is empty' });
        }
        if (invoicesArray.length > 100) {
          return res.status(400).json({ success: false, error: 'A QuickBooks invoice import batch may contain at most 100 entries.' });
        }
        for (const item of invoicesArray) {
          const qbId = String(item?.qbId ?? '').trim();
          const cls = String(item?.classification ?? '');
          if (!qbId) return res.status(400).json({ success: false, error: 'invoices[].qbId must be a non-empty string' });
          if (!(validClassifications as readonly string[]).includes(cls)) {
            return res.status(400).json({ success: false, error: `invoices[].classification must be one of: ${validClassifications.join(', ')}` });
          }
          perInvoiceModes[qbId] = cls as 'open_ar' | 'historical' | 'skip';
        }
        // Non-skip IDs are passed to the service; perInvoiceModes carries the explicit classification for each
        ids = invoicesArray.filter((i: any) => i.classification !== 'skip').map((i: any) => String(i.qbId));
        resolvedMode = 'auto'; // each invoice's classification is already in perInvoiceModes
      } else if (Array.isArray(rawIds) && rawIds.length > 0) {
        // Legacy format: { quickBooksInvoiceIds, mode, invoiceModes? }
        if (rawIds.length > 100) {
          return res.status(400).json({ success: false, error: 'A QuickBooks invoice import batch may contain at most 100 entries.' });
        }
        ids = rawIds;
        const validModes = ['auto', 'open_ar', 'historical'];
        if (!validModes.includes(rawMode)) {
          return res.status(400).json({ success: false, error: `mode must be one of: ${validModes.join(', ')}` });
        }
        resolvedMode = rawMode as 'auto' | 'open_ar' | 'historical';
        if (rawInvoiceModes != null) {
          if (typeof rawInvoiceModes !== 'object' || Array.isArray(rawInvoiceModes)) {
            return res.status(400).json({ success: false, error: 'invoiceModes must be an object keyed by QuickBooks invoice id' });
          }
          for (const [invoiceId, invoiceMode] of Object.entries(rawInvoiceModes as Record<string, unknown>)) {
            if (!(validClassifications as readonly string[]).includes(String(invoiceMode))) {
              return res.status(400).json({ success: false, error: `invoiceModes.${invoiceId} must be one of: ${validClassifications.join(', ')}` });
            }
            perInvoiceModes[invoiceId] = invoiceMode as 'open_ar' | 'historical' | 'skip';
          }
        }
      } else {
        return res.status(400).json({ success: false, error: 'Provide either invoices[] (new format) or quickBooksInvoiceIds (legacy format)' });
      }

      if (ids.length === 0) {
        // All rows were skip — return empty result rather than error
        return res.json({ success: true, data: { created: 0, updated: 0, skipped: invoicesArray?.length ?? 0, excluded: 0, failed: 0, importedOpenAr: 0, importedHistorical: 0, errors: [] } });
      }

      const uniqueIds = Array.from(new Set(ids.map((id) => String(id).trim()).filter(Boolean)));
      if (uniqueIds.length > 100) {
        return res.status(400).json({ success: false, error: 'A QuickBooks invoice import batch may contain at most 100 unique invoice IDs.' });
      }

      const result = await quickbooksService.importQBInvoicesByIds(organizationId, uniqueIds, resolvedMode, userId, perInvoiceModes);
      return res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('[QB Invoice Import] Error:', error);
      return res.status(500).json({ success: false, error: error.message || 'Failed to import invoices' });
    }
  });

  /**
   * GET /api/integrations/quickbooks/import-preview/customers
   * Read-only preview of all QB customers with local match status and contact safety flags.
   * No writes — safe to call before committing a pull sync.
   */
  app.get('/api/integrations/quickbooks/import-preview/customers', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const rows = await quickbooksService.fetchQBCustomersForPreview(organizationId);
      return res.json({ success: true, data: rows });
    } catch (error: any) {
      console.error('[QB Customer Preview] Error:', error);
      return res.status(500).json({ success: false, error: error.message || 'Failed to fetch customer preview' });
    }
  });

  /**
   * GET /api/integrations/quickbooks/repair/suspicious-contacts
   * Admin report: contacts already imported via QB whose names are known placeholders.
   * Read-only — used by staff to identify records that need manual correction.
   */
  app.get('/api/integrations/quickbooks/repair/suspicious-contacts', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const rows = await quickbooksService.findSuspiciousQBContacts(organizationId);
      return res.json({ success: true, count: rows.length, data: rows });
    } catch (error: any) {
      console.error('[QB Repair] Error:', error);
      return res.status(500).json({ success: false, error: error.message || 'Failed to fetch suspicious contacts' });
    }
  });

  /**
   * GET /api/integrations/quickbooks/debug/invoice/:invoiceNumber
   * Fetch a single QuickBooks invoice by DocNumber (invoice number) and return
   * both the raw QB payload and a transformed summary for field inspection.
   *
   * Read-only — does NOT write to any local table.
   * Restricted to platform developers (users.is_platform_developer = true).
   * Tenant owners and admins are NOT granted access by their org role alone.
   *
   * Query params:
   *   rawOnly=1   — return only the raw QB payload (omit transformed)
   */
  app.get('/api/integrations/quickbooks/debug/invoice/:invoiceNumber', isAuthenticated, requireDeveloperAccess, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const invoiceNumber = String(req.params.invoiceNumber || '').trim();
      if (!invoiceNumber) {
        return res.status(400).json({ success: false, error: 'invoiceNumber param is required' });
      }

      const result = await quickbooksService.fetchQBInvoiceByNumber(organizationId, invoiceNumber);
      if (!result) {
        return res.status(404).json({ success: false, error: `No QuickBooks invoice found with DocNumber "${invoiceNumber}"` });
      }

      if (req.query.rawOnly === '1') {
        return res.json({ success: true, invoiceNumber, data: result.raw });
      }

      return res.json({ success: true, invoiceNumber, data: result.transformed, raw: result.raw });
    } catch (error: any) {
      console.error('[QB Debug Invoice] Error:', { message: error.message, invoiceNumber: req.params.invoiceNumber });
      return res.status(500).json({ success: false, error: error.message || 'Failed to fetch invoice from QuickBooks' });
    }
  });

  /**
   * GET /api/integrations/quickbooks/debug/customer-search?q=...
   * Developer-only read-only lookup by QB Customer Id, DisplayName, CompanyName,
   * or FullyQualifiedName so inspectors do not need to manually locate QB numeric IDs.
   */
  app.get('/api/integrations/quickbooks/debug/customer-search', isAuthenticated, requireDeveloperAccess, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const query = String(req.query.q || '').trim();
      if (!query) {
        return res.status(400).json({ success: false, error: 'q query parameter is required' });
      }

      const matches = await quickbooksService.searchQBCustomersForInspection(organizationId, query);
      return res.json({ success: true, query, count: matches.length, data: matches });
    } catch (error: any) {
      console.error('[QB Debug Customer Search] Error:', { message: error.message, query: req.query.q });
      return res.status(500).json({ success: false, error: error.message || 'Failed to search QuickBooks customers' });
    }
  });

  /**
   * GET /api/integrations/quickbooks/debug/customer/:customerId
   * Fetch a single QuickBooks customer by their QB Id and return both the raw payload
   * and a structured field inspection: mapped TitanOS fields, unmapped QB fields, warnings.
   *
   * Read-only — does NOT write to any local table.
   * Restricted to platform developers (users.is_platform_developer = true).
   */
  app.get('/api/integrations/quickbooks/debug/customer/:customerId', isAuthenticated, requireDeveloperAccess, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const customerId = String(req.params.customerId || '').trim();
      if (!customerId) {
        return res.status(400).json({ success: false, error: 'customerId param is required' });
      }

      const result = await quickbooksService.fetchQBCustomerForInspection(organizationId, customerId);
      if (!result) {
        return res.status(404).json({ success: false, error: `No QuickBooks customer found with Id "${customerId}"` });
      }

      return res.json({ success: true, customerId, data: result.inspection, raw: result.raw });
    } catch (error: any) {
      console.error('[QB Debug Customer] Error:', { message: error.message, customerId: req.params.customerId });
      return res.status(500).json({ success: false, error: error.message || 'Failed to fetch customer from QuickBooks' });
    }
  });

}
