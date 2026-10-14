import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { buildLocalRenamePlan, type LocalRenamePlanEntry } from "@shared/fileUploadNaming";

export type ApprovedLocalRenamePlan = { prefix: string; entries: LocalRenamePlanEntry[] };

function secret(): string {
  const value = String(process.env.SESSION_SECRET || "").trim();
  if (!value) throw new Error("SESSION_SECRET is not configured");
  return value;
}

function digest(plan: ApprovedLocalRenamePlan): string {
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

export function issueLocalRenameToken(organizationId: string, plan: ApprovedLocalRenamePlan, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ organizationId, digest: digest(plan), expiresAt: now + 30 * 60_000 })).toString("base64url");
  const signature = createHmac("sha256", secret()).update(`bulk-file-renamer:${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyLocalRenameToken(token: string, plan: ApprovedLocalRenamePlan, now = Date.now()): string | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", secret()).update(`bulk-file-renamer:${payload}`).digest("base64url");
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!decoded || typeof decoded.organizationId !== "string" || decoded.expiresAt <= now || decoded.digest !== digest(plan)) return null;
    if (JSON.stringify(buildLocalRenamePlan(plan.prefix, plan.entries.map((entry) => entry.originalName))) !== JSON.stringify(plan.entries)) return null;
    return decoded.organizationId;
  } catch {
    return null;
  }
}
