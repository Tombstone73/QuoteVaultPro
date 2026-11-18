import type { Express } from "express";
import { getRequestOrganizationId } from "../tenantContext";

export function registerOrderStatusPillCatalogRoutes(
    app: Express,
    { isAuthenticated, tenantContext, isAdminOrOwner }: {
        isAuthenticated: any;
        tenantContext: any;
        isAdminOrOwner: any;
    },
) {
    app.get(["/api/orders/status-pills", "/api/order-status-pills"], isAuthenticated, tenantContext, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const stateScope = (req.query.stateScope ?? req.query.state) as string | undefined;
            if (stateScope && !["open", "production_complete", "closed", "canceled"].includes(stateScope)) {
                return res.status(400).json({ success: false, message: "Invalid state parameter" });
            }
            const { listStatusPills, seedDefaultPillsForOrg } = await import('../services/orderStatusPillService');
            await seedDefaultPillsForOrg(organizationId);
            const pills = await listStatusPills(organizationId, stateScope as any, true);
            const catalog = pills.map(({ notificationRules, ...pill }) => pill);
            return res.json({ success: true, data: catalog, pills: catalog });
        } catch (error: any) {
            console.error('[StatusPills:GET] Error:', error);
            return res.status(500).json({ success: false, message: "Failed to fetch status pills", error: error?.message });
        }
    });

    app.post("/api/orders/status-pills", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const { createStatusPill } = await import('../services/orderStatusPillService');
            const pill = await createStatusPill(organizationId, req.body);
            res.json({ success: true, data: pill });
        } catch (error: any) {
            res.status(400).json({ success: false, message: error.message });
        }
    });

    app.patch("/api/orders/status-pills/:pillId", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const { updateStatusPill } = await import('../services/orderStatusPillService');
            const pill = await updateStatusPill(organizationId, req.params.pillId, req.body);
            res.json({ success: true, data: pill });
        } catch (error: any) {
            res.status(400).json({ success: false, message: error.message });
        }
    });

    app.delete("/api/orders/status-pills/:pillId", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const { deleteStatusPill } = await import('../services/orderStatusPillService');
            await deleteStatusPill(organizationId, req.params.pillId);
            res.json({ success: true });
        } catch (error: any) {
            res.status(400).json({ success: false, message: error.message });
        }
    });

    app.post("/api/orders/status-pills/:pillId/make-default", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ message: "Missing organization context" });
            const { setDefaultPill } = await import('../services/orderStatusPillService');
            await setDefaultPill(organizationId, req.params.pillId);
            res.json({ success: true });
        } catch (error: any) {
            res.status(400).json({ success: false, message: error.message });
        }
    });

    app.get("/api/settings/order-status-pills", isAuthenticated, tenantContext, isAdminOrOwner, async (req: any, res) => {
        try {
            const organizationId = getRequestOrganizationId(req);
            if (!organizationId) return res.status(500).json({ success: false, message: "Missing organization context" });
            const { listStatusPills, seedDefaultPillsForOrg } = await import('../services/orderStatusPillService');
            await seedDefaultPillsForOrg(organizationId);
            const pills = await listStatusPills(organizationId, undefined, false);
            return res.json({ success: true, data: pills, pills });
        } catch (error: any) {
            console.error('[StatusPills:SETTINGS_GET] Error:', error);
            return res.status(500).json({ success: false, message: "Failed to fetch status-pill settings" });
        }
    });
}
