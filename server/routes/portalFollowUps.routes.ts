import type { Express, Request, Response, NextFunction } from "express";
import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { getRequestOrganizationId } from "../tenantContext";
import { customers } from "@shared/schema";
import {
  listPortalFollowUpItems,
  updatePortalFollowUpStatus,
} from "../services/portalFollowUps";

interface RouteMiddleware {
  isAuthenticated: any;
  tenantContext: any;
}

function getUserId(req: Request): string | null {
  const user = (req as any).user;
  return user?.id || user?.claims?.sub || null;
}

async function requireInternalStaff(req: Request, res: Response, next: NextFunction) {
  try {
    const organizationId = getRequestOrganizationId(req);
    const userId = getUserId(req);
    const user = (req as any).user || {};
    const orgRole = String((req as any).orgRole || "").toLowerCase();
    const globalRole = String(user.role || "").toLowerCase();
    const elevated = Boolean(user.isAdmin) || ["owner", "admin", "manager"].includes(orgRole) || ["owner", "admin", "manager"].includes(globalRole);

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    // tenantContext derives organizationId for portal-only customer users from customers.user_id.
    // Internal queue access requires an actual staff org membership unless the actor is elevated.
    if (!orgRole && !elevated) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const [linkedPortalCustomer] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.organizationId, organizationId), eq(customers.userId, userId)))
      .limit(1);

    if (linkedPortalCustomer && !elevated) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    return next();
  } catch (error) {
    console.error("[PortalFollowUps] internal staff guard failed", error);
    return res.status(403).json({ success: false, message: "Access denied" });
  }
}

export function registerPortalFollowUpRoutes(
  app: Express,
  { isAuthenticated, tenantContext }: RouteMiddleware,
) {
  app.get("/api/internal/portal-follow-ups", isAuthenticated, tenantContext, requireInternalStaff, async (req: Request, res: Response) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const status = String(req.query.status || "open");
      const limit = Number(req.query.limit || 10);
      const normalizedStatus = ["open", "all", "new", "pending", "completed"].includes(status) ? status : "open";

      const data = await listPortalFollowUpItems(organizationId, normalizedStatus as any, limit);
      return res.json({ success: true, data });
    } catch (error) {
      console.error("[PortalFollowUps] failed to list portal follow-ups", error);
      return res.status(500).json({ success: false, message: "Failed to load portal follow-ups" });
    }
  });

  app.patch("/api/internal/portal-follow-ups/:id/status", isAuthenticated, tenantContext, requireInternalStaff, async (req: Request, res: Response) => {
    try {
      const organizationId = getRequestOrganizationId(req);
      const status = String(req.body?.status || "");
      if (!["new", "pending", "completed"].includes(status)) {
        return res.status(400).json({ success: false, message: "Invalid follow-up status" });
      }

      const item = await updatePortalFollowUpStatus(organizationId, req.params.id, status as any, getUserId(req));
      if (!item) {
        return res.status(404).json({ success: false, message: "Not found" });
      }

      return res.json({ success: true, data: item });
    } catch (error) {
      console.error("[PortalFollowUps] failed to update portal follow-up", error);
      return res.status(500).json({ success: false, message: "Failed to update portal follow-up" });
    }
  });
}
