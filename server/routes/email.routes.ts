/**
 * email.routes.ts
 *
 * Email sending and platform-managed Gmail OAuth connection routes.
 *
 * Send routes:
 *   POST   /api/email/test              — send test email via connected Gmail account
 *   POST   /api/quotes/:id/email        — send quote email to recipient
 *   POST   /api/orders/:id/email        — send order email to recipient
 *
 * Platform OAuth routes:
 *   GET    /api/email/google/start      — generate OAuth URL, redirect user to Google
 *   GET    /api/email/google/callback   — receive code, exchange tokens, store connection
 *   GET    /api/email/connection        — current connection status for the org
 *   POST   /api/email/disconnect        — revoke org Gmail connection
 *   PATCH  /api/email/from-name         — update display name without re-doing OAuth
 *
 * Placement: server/routes/email.routes.ts
 * Registered by: server/routes.ts via registerEmailRoutes
 */

import crypto from "crypto";
import type { Express } from "express";
import { google } from "googleapis";
import { auditLogs, organizations } from "@shared/schema";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { storage } from "../storage";
import { getRequestOrganizationId } from "../tenantContext";
import { normalizeRole } from "@shared/roleAccess";
import { emailService } from "../emailService";
import {
  QuoteEmailRecipientError,
  sendQuoteEmailWithRecipientFallback,
} from "../lib/quoteEmailRecipientFallback";
import {
  OrderEmailRecipientError,
  sendOrderEmailWithRecipientFallback,
} from "../lib/orderEmailRecipientFallback";

// ---------------------------------------------------------------------------
// OAuth state helpers — same pattern as quickbooksService.ts
// State format: "gmail:{orgId}:{timestamp}:{hmac32}"
// ---------------------------------------------------------------------------

function buildGmailOAuthState(organizationId: string): string {
  const secret = String(process.env.SESSION_SECRET || '').trim();
  if (!secret) throw new Error('SESSION_SECRET is not configured');
  const ts = Date.now();
  const data = `${organizationId}:${ts}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('hex').slice(0, 32);
  return `gmail:${organizationId}:${ts}:${sig}`;
}

function parseGmailOAuthState(state: string | undefined | null): { organizationId: string } | null {
  if (!state || typeof state !== 'string') return null;
  const parts = state.split(':');
  if (parts.length !== 4) return null;
  const [prefix, organizationId, tsRaw, sig] = parts;
  if (prefix !== 'gmail' || !organizationId) return null;

  const ts = Number(tsRaw);
  if (!Number.isFinite(ts) || ts <= 0) return null;

  // 30-minute window for the OAuth round-trip
  const ageMs = Date.now() - ts;
  if (ageMs < 0 || ageMs > 30 * 60 * 1000) {
    console.warn('[Gmail OAuth] State token expired', { ageSeconds: Math.round(ageMs / 1000) });
    return null;
  }

  const secret = String(process.env.SESSION_SECRET || '').trim();
  if (!secret) return null;

  const data = `${organizationId}:${ts}`;
  const expected = crypto.createHmac('sha256', secret).update(data).digest('hex').slice(0, 32);
  if (expected !== sig) {
    console.warn('[Gmail OAuth] State token signature mismatch');
    return null;
  }

  return { organizationId };
}

function getGmailRedirectUri(req: any): string {
  if (process.env.GOOGLE_OAUTH_REDIRECT_URI) return process.env.GOOGLE_OAUTH_REDIRECT_URI;
  const base = (process.env.APP_URL ?? `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  return `${base}/api/email/google/callback`;
}

function getSettingsRedirectUrl(req: any, query?: string): string {
  const base = (process.env.APP_URL ?? `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  return `${base}/settings/email${query ? `?${query}` : ''}`;
}

function getUserId(user: any): string | undefined {
  return user?.claims?.sub || user?.id;
}

export function registerEmailRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    isAdmin: any;
  },
): void {
  const { isAuthenticated, tenantContext, isAdmin } = middleware;

  // ==================== Email Sending Routes ====================

  app.post("/api/email/test", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const { recipientEmail } = req.body;
      if (!recipientEmail) {
        return res.status(400).json({ message: "Recipient email is required" });
      }

      await emailService.sendTestEmail(organizationId, recipientEmail);
      res.json({ success: true, message: "Test email sent successfully" });
    } catch (error) {
      console.error("[API] Error sending test email:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to send test email";

      // Return more specific status codes for timeouts
      const statusCode = errorMessage.includes('timed out') ? 504 : 500;

      res.status(statusCode).json({
        success: false,
        message: errorMessage
      });
    }
  });

  app.post("/api/quotes/:id/email", isAuthenticated, tenantContext, async (req: any, res) => {
    const { id } = req.params;
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      const userRole = normalizeRole(req.actorOrgRole ?? req.orgRole);
      const isInternalUser = ['owner', 'admin', 'manager', 'employee'].includes(userRole);

      const result = await sendQuoteEmailWithRecipientFallback(
        {
          getQuoteById: storage.getQuoteById.bind(storage),
          getCustomerContacts: storage.getCustomerContacts.bind(storage),
          updateCustomerContactForOrganization: storage.updateCustomerContactForOrganization.bind(storage),
          createCustomerContactForOrganization: async (orgId, customerId, data) =>
            storage.createCustomerContactForOrganization(orgId, customerId, data as any),
          getOrganizationById: async (orgId) => {
            const [organization] = await db
              .select()
              .from(organizations)
              .where(eq(organizations.id, orgId))
              .limit(1);
            return organization as any;
          },
          getCompanySettings: storage.getCompanySettings.bind(storage),
          sendQuoteEmail: emailService.sendQuoteEmail.bind(emailService),
          createAuditLog: async (entry) => {
            await db.insert(auditLogs).values(entry as any);
          },
        },
        {
          organizationId,
          quoteId: id,
          userId,
          userName: req.user?.email || req.user?.username || req.user?.name || null,
          isInternalUser,
          payload: req.body,
          ipAddress: req.ip,
          userAgent: req.get?.("user-agent") ?? null,
        },
      );

      res.json(result);
    } catch (error) {
      console.error(`[QUOTE_EMAIL] Error in email endpoint for quote ${id}:`, error);
      if (error instanceof QuoteEmailRecipientError) {
        return res.status(error.statusCode).json(error.result ?? {
          success: false,
          message: error.message,
        });
      }
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to process email request"
      });
    }
  });

  app.post("/api/orders/:id/email", isAuthenticated, tenantContext, async (req: any, res) => {
    const { id } = req.params;
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const userId = getUserId(req.user);
      const userRole = normalizeRole(req.actorOrgRole ?? req.orgRole);
      const isInternalUser = ['owner', 'admin', 'manager', 'employee'].includes(userRole);

      const result = await sendOrderEmailWithRecipientFallback(
        {
          getOrderById: storage.getOrderById.bind(storage),
          getCustomerContacts: storage.getCustomerContacts.bind(storage),
          updateCustomerContactForOrganization: storage.updateCustomerContactForOrganization.bind(storage),
          createCustomerContactForOrganization: async (orgId, customerId, data) =>
            storage.createCustomerContactForOrganization(orgId, customerId, data as any),
          getOrganizationById: async (orgId) => {
            const [organization] = await db
              .select()
              .from(organizations)
              .where(eq(organizations.id, orgId))
              .limit(1);
            return organization as any;
          },
          sendOrderEmail: emailService.sendOrderEmail.bind(emailService),
          createAuditLog: async (entry) => {
            await db.insert(auditLogs).values(entry as any);
          },
        },
        {
          organizationId,
          orderId: id,
          userId,
          userName: req.user?.email || req.user?.username || req.user?.name || null,
          isInternalUser,
          payload: req.body,
          ipAddress: req.ip,
          userAgent: req.get?.("user-agent") ?? null,
        },
      );

      res.json(result);
    } catch (error) {
      console.error(`[ORDER_EMAIL] Error in email endpoint for order ${id}:`, error);
      if (error instanceof OrderEmailRecipientError) {
        return res.status(error.statusCode).json(error.result ?? {
          success: false,
          message: error.message,
        });
      }
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to send order email",
      });
    }
  });

  // ==================== Platform Gmail OAuth Routes (migration 0061) ====================

  /**
   * GET /api/email/google/start
   * Generates a signed state token, builds the Google OAuth consent URL,
   * and returns it as JSON so the frontend can redirect the user.
   */
  app.get("/api/email/google/start", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        return res.status(503).json({
          message: "Gmail OAuth is not configured on this platform. Contact your administrator to set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
        });
      }

      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const state = buildGmailOAuthState(organizationId);
      const redirectUri = getGmailRedirectUri(req);

      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent', // always return a refresh token
        scope: [
          'https://www.googleapis.com/auth/gmail.send',
          'https://www.googleapis.com/auth/userinfo.email',
          'https://www.googleapis.com/auth/userinfo.profile',
        ],
        state,
      });

      console.log(`[Gmail OAuth] /start → generated consent URL for org ${organizationId}`);
      res.json({ url: authUrl });
    } catch (error) {
      console.error('[Gmail OAuth] /start error:', error);
      res.status(500).json({ message: error instanceof Error ? error.message : 'Failed to start Gmail OAuth flow' });
    }
  });

  /**
   * GET /api/email/google/callback
   * Receives the authorization code from Google, exchanges it for tokens,
   * retrieves the connected Gmail address, and stores the connection.
   *
   * No isAuthenticated middleware — the request comes from a Google redirect.
   * Security is enforced via the signed state token (contains orgId + HMAC).
   *
   * On success: redirects to /settings/email?connected=true
   * On failure: redirects to /settings/email?error=<reason>
   */
  app.get("/api/email/google/callback", async (req: any, res) => {
    const { code, state, error: oauthError } = req.query as Record<string, string>;

    // --- User cancelled or Google returned an error ---
    if (oauthError) {
      console.warn('[Gmail OAuth] /callback — Google returned error:', oauthError);
      return res.redirect(getSettingsRedirectUrl(req, `error=${encodeURIComponent(oauthError === 'access_denied' ? 'cancelled' : oauthError)}`));
    }

    // --- Validate state token ---
    const parsed = parseGmailOAuthState(state);
    if (!parsed) {
      console.warn('[Gmail OAuth] /callback — invalid or expired state token');
      return res.redirect(getSettingsRedirectUrl(req, 'error=invalid_state'));
    }
    const { organizationId } = parsed;

    if (!code) {
      return res.redirect(getSettingsRedirectUrl(req, 'error=missing_code'));
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      return res.redirect(getSettingsRedirectUrl(req, 'error=platform_not_configured'));
    }

    const redirectUri = getGmailRedirectUri(req);
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    // --- Exchange code for tokens ---
    let refreshToken: string;
    try {
      const { tokens } = await oauth2Client.getToken(code);
      if (!tokens.refresh_token) {
        // This happens if the user already authorized and Google didn't re-issue the refresh token.
        // prompt=consent in /start should prevent this, but catch it defensively.
        console.error('[Gmail OAuth] /callback — no refresh_token in token response');
        return res.redirect(getSettingsRedirectUrl(req, 'error=no_refresh_token'));
      }
      refreshToken = tokens.refresh_token;
      oauth2Client.setCredentials(tokens);
    } catch (err) {
      console.error('[Gmail OAuth] /callback — token exchange failed:', err);
      // Mark the connection as failed if a prior record exists
      try { await storage.markEmailConnectionStatus(organizationId, 'token_exchange_failed'); } catch (_) {}
      return res.redirect(getSettingsRedirectUrl(req, 'error=token_exchange_failed'));
    }

    // --- Retrieve connected Gmail address (TEMP → PERMANENT boundary) ---
    // We only write the permanent connection record AFTER we have a valid email address.
    let connectedEmail: string;
    try {
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const { data } = await oauth2.userinfo.get();
      if (!data.email) throw new Error('Google did not return an email address');
      connectedEmail = data.email;
    } catch (err) {
      console.error('[Gmail OAuth] /callback — Gmail profile lookup failed:', err);
      try { await storage.markEmailConnectionStatus(organizationId, 'token_exchange_failed'); } catch (_) {}
      return res.redirect(getSettingsRedirectUrl(req, 'error=profile_lookup_failed'));
    }

    // --- Persist the permanent connection record ---
    try {
      await storage.upsertGmailConnection(organizationId, {
        connectedEmail,
        refreshToken,
      });
      console.log(`[Gmail OAuth] /callback — connection stored for org ${organizationId}, email ${connectedEmail}`);
    } catch (err) {
      console.error('[Gmail OAuth] /callback — failed to store connection:', err);
      return res.redirect(getSettingsRedirectUrl(req, 'error=storage_failed'));
    }

    return res.redirect(getSettingsRedirectUrl(req, 'connected=true'));
  });

  /**
   * GET /api/email/connection
   * Returns the current Gmail connection state for the org.
   * Never exposes tokens or client secrets.
   * Must never return 500 — the UI depends on this for initial page render.
   */
  app.get("/api/email/connection", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    const platformConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

    // Temporary diagnostics — logs boolean presence only, never values.
    console.log('[Gmail OAuth] /connection — platform env check:', {
      hasClientId: !!process.env.GOOGLE_CLIENT_ID,
      hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
      hasAppUrl: !!process.env.APP_URL,
      appUrl: process.env.APP_URL || '(not set)',
      nodeEnv: process.env.NODE_ENV || '(not set)',
    });

    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) {
        console.error('[Gmail OAuth] /connection — missing organization context');
        return res.json({
          status: 'not_connected',
          connected: false,
          connectedEmail: null,
          fromName: null,
          settingsId: null,
          connectedAt: null,
          platformConfigured,
        });
      }

      const settings = await storage.getDefaultEmailSettings(organizationId);

      if (!settings) {
        return res.json({
          status: 'not_connected',
          connected: false,
          connectedEmail: null,
          fromName: null,
          settingsId: null,
          connectedAt: null,
          platformConfigured,
        });
      }

      return res.json({
        status: settings.connectionStatus,
        connected: settings.connectionStatus === 'connected',
        connectedEmail: settings.fromAddress || null,
        fromName: settings.fromName || null,
        settingsId: settings.id,
        connectedAt: settings.connectedAt || null,
        platformConfigured,
      });
    } catch (error) {
      // Log for Railway diagnostics but never crash the UI with a 500.
      console.error('[Gmail OAuth] /connection — unexpected error:', error);
      return res.json({
        status: 'not_connected',
        connected: false,
        connectedEmail: null,
        fromName: null,
        settingsId: null,
        connectedAt: null,
        platformConfigured,
      });
    }
  });

  /**
   * POST /api/email/disconnect
   * Clears the refresh token and marks the connection disconnected.
   * Does not delete the record so fromName is preserved for reconnection.
   */
  app.post("/api/email/disconnect", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      await storage.disconnectGmailConnection(organizationId);
      console.log(`[Gmail OAuth] /disconnect — org ${organizationId} disconnected`);
      res.json({ success: true, message: 'Gmail account disconnected' });
    } catch (error) {
      console.error('[Gmail OAuth] /disconnect error:', error);
      res.status(500).json({ message: 'Failed to disconnect Gmail account' });
    }
  });

  /**
   * PATCH /api/email/from-name
   * Updates the display name on the connected account without re-doing OAuth.
   */
  app.patch("/api/email/from-name", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const { fromName } = req.body;
      if (!fromName || typeof fromName !== 'string' || !fromName.trim()) {
        return res.status(400).json({ message: 'fromName is required' });
      }

      const settings = await storage.getDefaultEmailSettings(organizationId);
      if (!settings) {
        return res.status(404).json({ message: 'No email settings found' });
      }

      const updated = await storage.updateEmailSettings(organizationId, settings.id, {
        fromName: fromName.trim(),
      });

      res.json({ success: true, fromName: updated.fromName });
    } catch (error) {
      console.error('[Gmail OAuth] /from-name error:', error);
      res.status(500).json({ message: 'Failed to update display name' });
    }
  });
}
