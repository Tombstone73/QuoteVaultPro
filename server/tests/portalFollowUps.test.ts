import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("portal follow-up operational queue", () => {
  test("maps portal action events to deterministic queue metadata", async () => {
    const {
      buildPortalFollowUpIdempotencyKey,
      defaultPortalFollowUpArea,
      PORTAL_FOLLOW_UP_EVENT_LABELS,
    } = await import("../services/portalFollowUps");

    expect(buildPortalFollowUpIdempotencyKey("QUOTE_APPROVED", "quote", "quote_1")).toBe("portal:QUOTE_APPROVED:quote:quote_1");
    expect(defaultPortalFollowUpArea("QUOTE_REVISION_REQUESTED")).toBe("Estimating");
    expect(defaultPortalFollowUpArea("PROOF_REJECTED")).toBe("Design");
    expect(PORTAL_FOLLOW_UP_EVENT_LABELS.INVOICE_PAYMENT_SUCCEEDED).toBe("Invoice Payment Received");
  });

  test("migration and schema enforce scoped idempotent follow-up rows", () => {
    const migration = read("server/db/migrations_v2/0060_portal_follow_up_items.sql");
    const schema = read("shared/schema.ts");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS portal_follow_up_items");
    expect(migration).toContain("status varchar(30) NOT NULL DEFAULT 'new'");
    expect(migration).toContain("portal_follow_up_items_org_idempotency_uidx");
    expect(migration).toContain("QUOTE_REVISION_REQUESTED");
    expect(schema).toContain("export const portalFollowUpItems");
    expect(schema).toContain("uniqueIndex(\"portal_follow_up_items_org_idempotency_uidx\")");
  });

  test("portal actions record idempotent staff follow-up items without exposing a customer API", () => {
    const service = read("server/services/portal.service.ts");
    const followUps = read("server/services/portalFollowUps.ts");
    const routes = read("server/routes/portalFollowUps.routes.ts");

    expect(service).toContain("recordPortalQuoteFollowUp");
    expect(service).toContain("recordPortalProofFollowUp");
    expect(service).toContain("INVOICE_PAYMENT_SUCCEEDED");
    expect(followUps).toContain("onConflictDoNothing");
    expect(routes).toContain('"/api/internal/portal-follow-ups"');
    expect(routes).not.toContain('"/api/portal/');
    expect(routes).toContain("customers.userId");
    expect(routes).toContain("Access denied");
  });
});
