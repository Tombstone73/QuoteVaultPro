/**
 * email.routes.ts
 *
 * Email Settings and Email Sending routes extracted from server/routes.ts.
 *
 * Routes:
 *   GET    /api/email-settings
 *   GET    /api/email-settings/default
 *   POST   /api/email-settings
 *   PATCH  /api/email-settings/:id
 *   DELETE /api/email-settings/:id
 *
 *   POST   /api/email/test
 *   POST   /api/quotes/:id/email
 *
 * Placement: server/routes/email.routes.ts
 * Registered by: server/routes.ts via registerEmailRoutes
 */

import type { Express } from "express";
import { z } from "zod";
import { fromZodError } from "zod-validation-error";
import { storage } from "../storage";
import { getRequestOrganizationId } from "../tenantContext";
import { emailService } from "../emailService";
import { insertEmailSettingsSchema, updateEmailSettingsSchema } from "@shared/schema";

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
}
