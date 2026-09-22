import type { Request, Response } from "express";
import { canExecuteStaffPortalPreviewPayment } from "../services/staffPortalPreviewService";

/** Exception only for the portal Stripe payment routes that install it. */
export function createAuthorizeStaffPreviewPayment(
  hasCapability: (req: Request) => Promise<boolean> = canExecuteStaffPortalPreviewPayment,
) {
  return async (req: Request, res: Response, next: () => void) => {
    if (!req.staffPortalPreview) return next();
    try {
      if (await hasCapability(req)) return next();
      return res.status(403).json({
        success: false,
        code: "STAFF_PORTAL_PREVIEW_PAYMENT_FORBIDDEN",
        message: "Staff preview: payment submission disabled.",
      });
    } catch (error) {
      console.error("[Portal] preview payment authority check failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      return res.status(503).json({ success: false, code: "STAFF_PORTAL_PREVIEW_PAYMENT_AUTHORITY_UNAVAILABLE", message: "Payment authority could not be verified." });
    }
  };
}

export const authorizeStaffPreviewPayment = createAuthorizeStaffPreviewPayment();
