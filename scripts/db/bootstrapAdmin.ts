import "dotenv/config";
import crypto from "crypto";
import { db } from "../../server/db";
import { platformAuditLogs } from "../../shared/schema";
import { bootstrapAdminBodySchema, bootstrapPlatformAdmin } from "../../server/services/bootstrapAdminService";

function readArg(flag: string): string | undefined {
  const index = process.argv.findIndex((arg) => arg === flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function timingSafeTokenMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) {
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

async function main() {
  const bootstrapModeEnabled = (process.env.BOOTSTRAP_MODE ?? "").trim().toLowerCase() === "true";
  if (!bootstrapModeEnabled) {
    console.error(JSON.stringify({ success: false, data: null, message: "BOOTSTRAP_MODE is not enabled." }));
    process.exit(1);
  }

  const configuredToken = (process.env.BOOTSTRAP_TOKEN ?? "").trim();
  if (!configuredToken) {
    console.error(JSON.stringify({ success: false, data: null, message: "BOOTSTRAP_TOKEN is not configured." }));
    process.exit(1);
  }

  const providedToken = (
    readArg("--token") ??
    process.env.BOOTSTRAP_REQUEST_TOKEN ??
    ""
  ).trim();

  if (!providedToken || !timingSafeTokenMatch(configuredToken, providedToken)) {
    console.error(JSON.stringify({ success: false, data: null, message: "Forbidden: invalid bootstrap token." }));
    process.exit(1);
  }

  const parse = bootstrapAdminBodySchema.safeParse({
    email: readArg("--email") ?? process.env.BOOTSTRAP_ADMIN_EMAIL,
    password: readArg("--password") ?? process.env.BOOTSTRAP_ADMIN_PASSWORD,
    name: readArg("--name") ?? process.env.BOOTSTRAP_ADMIN_NAME,
    orgName: readArg("--org-name") ?? process.env.BOOTSTRAP_ADMIN_ORG_NAME,
    orgSlug: readArg("--org-slug") ?? process.env.BOOTSTRAP_ADMIN_ORG_SLUG,
  });

  if (!parse.success) {
    console.error(JSON.stringify({
      success: false,
      data: null,
      message: parse.error.issues[0]?.message ?? "Validation failed",
    }));
    process.exit(1);
  }

  try {
    const result = await bootstrapPlatformAdmin(parse.data);

    if (result.status === "already_bootstrapped") {
      console.log(JSON.stringify({
        success: false,
        data: { existingAdminId: result.existingAdminId },
        message: "Bootstrap already completed. Platform admin already exists.",
      }));
      process.exit(0);
    }

    await db.insert(platformAuditLogs).values({
      action: "platform.bootstrap_admin",
      actorUserId: result.userId,
      actorEmail: result.email,
      ip: "cli",
      userAgent: "bootstrap-cli",
      orgId: result.organizationId,
      metadata: {
        bootstrap: true,
        source: "cli",
        userId: result.userId,
        email: result.email,
        organizationId: result.organizationId,
      },
    });

    console.log(JSON.stringify({
      success: true,
      data: {
        userId: result.userId,
        organizationId: result.organizationId,
      },
      message: "Initial platform admin created.",
    }));
    process.exit(0);
  } catch (err: any) {
    if (err?.code === "23505") {
      console.error(JSON.stringify({
        success: false,
        data: null,
        message: "Bootstrap conflict: user or organization already exists.",
      }));
      process.exit(1);
    }

    console.error(err);
    console.error(JSON.stringify({
      success: false,
      data: null,
      message: "Failed to bootstrap platform admin.",
    }));
    process.exit(1);
  }
}

main();
