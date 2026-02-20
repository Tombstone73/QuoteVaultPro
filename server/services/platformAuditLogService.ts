/**
 * platformAuditLogService — writes to platform_audit_logs (org-agnostic).
 *
 * Capture IP safely: prefers req.ip (set by Express trust-proxy) then
 * the first value of X-Forwarded-For as a fallback.
 */
import type { Request } from "express";
import { db } from "../db";
import { platformAuditLogs } from "@shared/schema";

export interface PlatformAuditParams {
  action: string;
  actorUserId?: string | null;
  actorEmail: string;
  req: Request;
  orgId?: string | null;
  metadata?: Record<string, unknown>;
}

function extractIp(req: Request): string {
  // Express sets req.ip correctly when trust proxy is configured
  if (req.ip) return req.ip;
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string") return fwd.split(",")[0].trim();
  if (Array.isArray(fwd) && fwd.length > 0) return fwd[0].trim();
  return "unknown";
}

export async function writePlatformAuditLog(params: PlatformAuditParams): Promise<void> {
  const { action, actorUserId, actorEmail, req, orgId, metadata = {} } = params;

  try {
    await db.insert(platformAuditLogs).values({
      action,
      actorUserId: actorUserId ?? null,
      actorEmail,
      ip: extractIp(req),
      userAgent: (req.headers["user-agent"] ?? "").slice(0, 512),
      orgId: orgId ?? null,
      metadata,
    });
  } catch (err) {
    // Audit log failures must never interrupt the main request flow.
    console.error("[PlatformAudit] Failed to write log:", err);
  }
}
