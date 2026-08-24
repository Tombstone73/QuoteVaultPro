/**
 * stripe.routes.ts
 *
 * Stripe Connect integration routes extracted from server/routes.ts.
 *
 * Routes:
 *   GET  /api/integrations/stripe/status
 *   POST /api/integrations/stripe/connect
 *   POST /api/integrations/stripe/disconnect
 *
 * Placement: server/routes/stripe.routes.ts
 * Registered by: server/routes.ts via registerStripeRoutes
 */

import type { Express } from "express";
import { and, eq, sql } from "drizzle-orm";
import { integrationConnections, auditLogs, organizationPaymentSettings } from "@shared/schema";
import { db } from "../db";
import { getRequestOrganizationId } from "../tenantContext";
import { assertStripeServerConfig, getStripeClient } from "../lib/stripe";
import { resolveStripeReadiness } from "../services/stripeReadiness.service";

function getBaseOrigin(req: any): string {
  const origin = req?.headers?.origin;
  if (origin && typeof origin === 'string') return origin;
  const proto = req.protocol || 'http';
  const host = req.get('host');
  return `${proto}://${host}`;
}

export function registerStripeRoutes(
  app: Express,
  middleware: {
    isAuthenticated: any;
    tenantContext: any;
    isAdminOrOwner: any;
  },
): void {
  const { isAuthenticated, tenantContext, isAdminOrOwner } = middleware;

  // ==================== Stripe (Connect) Integration Routes ====================
  // Per-organization Stripe Connect accounts (no tenant secret keys).

  app.get('/api/integrations/stripe/status', isAuthenticated, tenantContext, async (req: any, res) => {
    try {
      const organizationId = getRequestOrganizationId(req);

      const readiness = await resolveStripeReadiness(organizationId);
      return res.json({
        success: true,
        data: {
          ...readiness,
          mode: readiness.serverMode,
        },
      });
    } catch (error: any) {
      console.error('[Stripe Status] Error:', { message: String(error?.message || error) });
      res.status(500).json({ success: false, error: 'Failed to check Stripe status' });
    }
  });

  app.post('/api/integrations/stripe/connect', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    const organizationId = getRequestOrganizationId(req);
    const userId = req.user?.claims?.sub || req.user?.id;
    const userName = `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || req.user?.email;
    const now = new Date();

    try {
      const stripeCfg = assertStripeServerConfig();
      if (!stripeCfg.ok) {
        console.error('[Stripe Connect] STRIPE_NOT_CONFIGURED', { organizationId });
        return res.status(400).json({
          success: false,
          code: 'STRIPE_NOT_CONFIGURED',
          message: 'Stripe is not configured. Set STRIPE_SECRET_KEY (sk_...) in server env and restart the server.',
        });
      }

      const stripe = getStripeClient();

      const [existing] = await db
        .select()
        .from(integrationConnections)
        .where(and(eq(integrationConnections.organizationId, organizationId), eq(integrationConnections.provider, 'stripe')))
        .limit(1);

      const mode = stripeCfg.mode;
      if (mode === 'unknown') {
        return res.status(409).json({ success: false, code: 'STRIPE_MODE_UNKNOWN', message: 'Stripe server mode is unknown. Use an sk_test_ or sk_live_ key.' });
      }
      let stripeAccountId = existing?.externalAccountId ? String(existing.externalAccountId) : null;

      if (stripeAccountId && String(existing?.mode || "").toLowerCase() !== mode) {
        return res.status(409).json({
          success: false,
          code: 'STRIPE_MODE_MISMATCH',
          message: `Stored Stripe connection is ${existing?.mode || 'unknown'}; server is ${mode}. Disconnect the obsolete connection before reconnecting.`,
        });
      }

      if (!stripeAccountId) {
        const account = await stripe.accounts.create({
          type: 'express',
          capabilities: {
            card_payments: { requested: true },
            transfers: { requested: true },
          },
          metadata: {
            organizationId,
          },
        });

        stripeAccountId = String(account.id);

        await db
          .insert(integrationConnections)
          .values({
            organizationId,
            provider: 'stripe',
            externalAccountId: stripeAccountId,
            status: 'connected',
            mode,
            lastError: null,
            connectedAt: now,
            createdAt: now,
            updatedAt: now,
          } as any)
          .onConflictDoUpdate({
            target: [integrationConnections.organizationId, integrationConnections.provider],
            set: {
              externalAccountId: stripeAccountId,
              status: 'connected',
              mode,
              lastError: null,
              connectedAt: now,
              disconnectedAt: null,
              updatedAt: now,
            } as any,
          });
      }

      const origin = getBaseOrigin(req);
      const returnUrl = `${origin}/settings/integrations?stripe_connected=true`;
      const refreshUrl = `${origin}/settings/integrations?stripe_refresh=true`;

      const link = await stripe.accountLinks.create({
        account: stripeAccountId,
        type: 'account_onboarding',
        return_url: returnUrl,
        refresh_url: refreshUrl,
      });

      try {
        await db.insert(auditLogs).values({
          organizationId,
          userId: userId || null,
          userName,
          actionType: 'stripe.connect.started',
          entityType: 'organization',
          entityId: organizationId,
          entityName: String(organizationId),
          description: 'Stripe Connect onboarding started',
          newValues: { stripeAccountId, mode } as any,
          createdAt: now,
        } as any);
      } catch (logErr: any) {
        console.error('[Stripe Connect] audit log failed:', { organizationId, message: String(logErr?.message || logErr) });
      }

      return res.json({ success: true, data: { onboardingUrl: link.url, stripeAccountId, mode } });
    } catch (error: any) {
      const message = String(error?.message || error);
      console.error('[Stripe Connect] Error:', { organizationId, message });

      try {
        await db
          .insert(integrationConnections)
          .values({
            organizationId,
            provider: 'stripe',
            status: 'error',
            mode: assertStripeServerConfig().mode === 'live' ? 'live' : 'test',
            lastError: message.slice(0, 800),
            updatedAt: now,
            createdAt: now,
          } as any)
          .onConflictDoUpdate({
            target: [integrationConnections.organizationId, integrationConnections.provider],
            set: { status: 'error', lastError: message.slice(0, 800), updatedAt: now } as any,
          });
      } catch {}

      try {
        await db.insert(auditLogs).values({
          organizationId,
          userId: userId || null,
          userName,
          actionType: 'stripe.connect.failed',
          entityType: 'organization',
          entityId: organizationId,
          entityName: String(organizationId),
          description: 'Stripe Connect onboarding failed',
          newValues: { error: message.slice(0, 800) } as any,
          createdAt: now,
        } as any);
      } catch {}

      return res.status(500).json({ success: false, error: 'Failed to start Stripe Connect onboarding' });
    }
  });

  app.post('/api/integrations/stripe/disconnect', isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
    const organizationId = getRequestOrganizationId(req);
    const userId = req.user?.claims?.sub || req.user?.id;
    const userName = `${req.user?.firstName || ''} ${req.user?.lastName || ''}`.trim() || req.user?.email;
    const now = new Date();

    try {
      await db.transaction(async (tx) => {
        await tx
          .insert(integrationConnections)
          .values({
            organizationId,
            provider: 'stripe',
            status: 'disconnected',
            mode: assertStripeServerConfig().mode === 'live' ? 'live' : 'test',
            lastError: null,
            disconnectedAt: now,
            updatedAt: now,
            createdAt: now,
          } as any)
          .onConflictDoUpdate({
            target: [integrationConnections.organizationId, integrationConnections.provider],
            set: {
              externalAccountId: null,
              status: 'disconnected',
              lastError: null,
              disconnectedAt: now,
              updatedAt: now,
            } as any,
          });

        await tx.update(organizationPaymentSettings).set({
          stripeEnabled: false,
          provider: sql`CASE WHEN ${organizationPaymentSettings.provider} = 'stripe' THEN 'none' ELSE ${organizationPaymentSettings.provider} END`,
          updatedAt: now,
        } as any).where(eq(organizationPaymentSettings.organizationId, organizationId));
      });

      try {
        await db.insert(auditLogs).values({
          organizationId,
          userId: userId || null,
          userName,
          actionType: 'stripe.disconnect',
          entityType: 'organization',
          entityId: organizationId,
          entityName: String(organizationId),
          description: 'Stripe disconnected for organization',
          createdAt: now,
        } as any);
      } catch (logErr: any) {
        console.error('[Stripe Disconnect] audit log failed:', { organizationId, message: String(logErr?.message || logErr) });
      }

      return res.json({ success: true });
    } catch (error: any) {
      console.error('[Stripe Disconnect] Error:', { organizationId, message: String(error?.message || error) });
      return res.status(500).json({ success: false, error: 'Failed to disconnect Stripe' });
    }
  });
}
