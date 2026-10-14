import type { Express } from "express";
import path from "node:path";
import { z } from "zod";
import { getRequestOrganizationId } from "../tenantContext";
import { buildLocalRenamePlan } from "@shared/fileUploadNaming";
import { isFilePrefixToolsEnabled } from "../services/filePrefixTools";
import { issueLocalRenameToken, verifyLocalRenameToken } from "../services/localRenameAuthorization";

const planInput = z.object({
  prefix: z.string().min(1).max(100),
  filenames: z.array(z.string().min(1).max(255)).min(1).max(500),
}).strict();

export function registerBulkFileRenamerRoutes(app: Express, middleware: {
  isAuthenticated: any;
  tenantContext: any;
  assertInternalUser: (req: any, res: any) => boolean;
}, dependencies: { isEnabled?: typeof isFilePrefixToolsEnabled } = {}): void {
  const requireStaff = [middleware.isAuthenticated, middleware.tenantContext];
  const isEnabled = dependencies.isEnabled ?? isFilePrefixToolsEnabled;
  const guarded = (handler: (req: any, res: any) => Promise<unknown>) => (req: any, res: any) => {
    void handler(req, res).catch((error) => {
      console.error("[BulkFileRenamer] Request failed", error instanceof Error ? error.name : "Error");
      if (!res.headersSent) res.status(503).json({ error: "File Prefix Tools are temporarily unavailable." });
    });
  };

  app.get("/api/tools/bulk-file-renamer/status", ...requireStaff, guarded(async (req: any, res) => {
    if (!middleware.assertInternalUser(req, res)) return;
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId) return res.status(403).json({ enabled: false });
    return res.json({ enabled: await isEnabled(organizationId) });
  }));

  app.get("/api/tools/bulk-file-renamer/helper", ...requireStaff, guarded(async (req: any, res) => {
    if (!middleware.assertInternalUser(req, res)) return;
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId || !await isEnabled(organizationId)) return res.status(403).json({ error: "File Prefix Tools are disabled for this organization." });
    return res.download(path.resolve(process.cwd(), "dist", "bulk-file-renamer.py"), "printershero-bulk-file-renamer.py");
  }));

  app.post("/api/tools/bulk-file-renamer/plan", ...requireStaff, guarded(async (req: any, res) => {
    if (!middleware.assertInternalUser(req, res)) return;
    const organizationId = getRequestOrganizationId(req);
    if (!organizationId || !await isEnabled(organizationId)) return res.status(403).json({ error: "File Prefix Tools are disabled for this organization." });
    const parsed = planInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Select up to 500 files and enter a valid prefix." });
    const plan = { prefix: parsed.data.prefix, entries: buildLocalRenamePlan(parsed.data.prefix, parsed.data.filenames) };
    if (plan.entries.some((entry) => entry.status === "invalid" || entry.status === "collision")) {
      return res.status(422).json({ error: "Resolve invalid names and collisions before approval.", entries: plan.entries });
    }
    return res.json({ ...plan, authorizationToken: issueLocalRenameToken(organizationId, plan), expiresInSeconds: 1800 });
  }));

  // A short-lived plan capability lets the local helper recheck tenant authority
  // without receiving the browser session or sending local paths/file contents.
  app.post("/api/tools/bulk-file-renamer/authorize", guarded(async (req: any, res) => {
    const parsed = z.object({
      authorizationToken: z.string().max(4096),
      prefix: planInput.shape.prefix,
      entries: z.array(z.object({
        originalName: z.string().min(1).max(255),
        proposedName: z.string().min(1).max(255),
        status: z.enum(["ready", "already_prefixed", "invalid", "collision"]),
        reason: z.string().optional(),
      }).strict()).min(1).max(500),
    }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ authorized: false });
    const organizationId = verifyLocalRenameToken(parsed.data.authorizationToken, { prefix: parsed.data.prefix, entries: parsed.data.entries });
    if (!organizationId || !await isEnabled(organizationId)) return res.status(403).json({ authorized: false });
    return res.json({ authorized: true });
  }));
}
