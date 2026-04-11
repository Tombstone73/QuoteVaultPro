/**
 * email.routes.ts
 *
 * Email Settings, Email Sending, and Gmail OAuth connection routes.
 *
 * Existing routes:
 *   GET    /api/email-settings
 *   GET    /api/email-settings/default
 *   POST   /api/email-settings
 *   PATCH  /api/email-settings/:id
 *   DELETE /api/email-settings/:id
 *   POST   /api/email/test
 *   POST   /api/quotes/:id/email
 *
 * New platform OAuth routes (migration 0061):
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
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { storage } from "../storage";
import { getRequestOrganizationId } from "../tenantContext";
import { emailService } from "../emailService";
import { insertEmailSettingsSchema, updateEmailSettingsSchema } from "@shared/schema";

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

  // ==================== Email Settings Routes ====================

  app.get("/api/email-settings", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const settings = await storage.getAllEmailSettings(organizationId);
      res.json(settings);
    } catch (error) {
      console.error("Error fetching email settings:", error);
      res.status(500).json({ message: "Failed to fetch email settings" });
    }
  });

  app.get("/api/email-settings/default", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const settings = await storage.getDefaultEmailSettings(organizationId);
      if (!settings) {
        return res.status(404).json({ message: "No default email settings found" });
      }
      res.json(settings);
    } catch (error) {
      console.error("Error fetching default email settings:", error);
      res.status(500).json({ message: "Failed to fetch default email settings" });
    }
  });

  app.post("/api/email-settings", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const settingsData = insertEmailSettingsSchema.parse(req.body);
      const { organizationId: _orgId, ...settingsWithoutOrgId } =
        settingsData as typeof settingsData & { organizationId?: string };
      const settings = await storage.createEmailSettings(organizationId, settingsWithoutOrgId);
      res.json(settings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error creating email settings:", error);
      res.status(500).json({ message: "Failed to create email settings" });
    }
  });

  app.patch("/api/email-settings/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      const settingsData = updateEmailSettingsSchema.parse({
        ...req.body,
        id: req.params.id,
      });
      const { id, organizationId: _orgId, ...updateData } =
        settingsData as typeof settingsData & { organizationId?: string };
      const settings = await storage.updateEmailSettings(organizationId, req.params.id, updateData);
      res.json(settings);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ message: fromZodError(error).message });
      }
      console.error("Error updating email settings:", error);
      res.status(500).json({ message: "Failed to update email settings" });
    }
  });

  app.delete("/api/email-settings/:id", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
      await storage.deleteEmailSettings(organizationId, req.params.id);
      res.json({ message: "Email settings deleted successfully" });
    } catch (error) {
      console.error("Error deleting email settings:", error);
      res.status(500).json({ message: "Failed to delete email settings" });
    }
  });

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
      const { recipientEmail } = req.body;

      if (!recipientEmail) {
        return res.status(400).json({ message: "Recipient email is required" });
      }

      // Verify user has access to this quote
      const userId = getUserId(req.user);
      const userRole = req.user.role || 'customer';
      const isInternalUser = ['owner', 'admin', 'manager', 'employee'].includes(userRole);
      const quote = await storage.getQuoteById(organizationId, id, isInternalUser ? undefined : userId);

      if (!quote) {
        return res.status(404).json({ message: "Quote not found" });
      }

      // Wrap email sending in try-catch to prevent quote operations from failing
      try {
        await emailService.sendQuoteEmail(organizationId, id, recipientEmail, isInternalUser ? undefined : userId);
        res.json({ success: true, message: "Quote email sent successfully" });
      } catch (emailError) {
        console.error(`[QUOTE_EMAIL] Failed to send email for quote ${id}:`, {
          quoteId: id,
          organizationId,
          userId,
          recipientEmail,
          error: emailError instanceof Error ? emailError.message : String(emailError),
          stack: emailError instanceof Error ? emailError.stack : undefined
        });
        // Return error indicating email failed
        res.status(500).json({
          success: false,
          message: emailError instanceof Error ? emailError.message : "Failed to send quote email. Please try again or contact support."
        });
      }
    } catch (error) {
      console.error(`[QUOTE_EMAIL] Error in email endpoint for quote ${id}:`, error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Failed to process email request"
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
    let accessToken: string;
    try {
      const { tokens } = await oauth2Client.getToken(code);
      if (!tokens.refresh_token) {
        // This happens if the user already authorized the app and Google didn't re-issue a refresh token.
        // Force prompt=consent in /start handles this, but catch it defensively.
        console.error('[Gmail OAuth] /callback — no refresh_token in token response');
        return res.redirect(getSettingsRedirectUrl(req, 'error=no_refresh_token'));
      }
      refreshToken = tokens.refresh_token;
      accessToken = tokens.access_token || '';
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
   */
  app.get("/api/email/connection", isAuthenticated, tenantContext, isAdmin, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      if (!organizationId) return res.status(500).json({ message: "Missing organization context" });

      const settings = await storage.getDefaultEmailSettings(organizationId);
      const platformConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

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
      console.error('[Gmail OAuth] /connection error:', error);
      res.status(500).json({ message: 'Failed to fetch connection status' });
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
