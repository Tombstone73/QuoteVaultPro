import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("direct Traveler printing safety contract", () => {
  test("one request key has one tenant-scoped durable job", () => {
    const schema = read("shared/schema.ts");
    const migration = read("server/db/migrations_v2/0200_direct_traveler_print_idempotency.sql");
    const routes = read("server/routes/printerProfiles.routes.ts");

    expect(schema).toContain('requestKey: varchar("request_key", { length: 160 }).notNull()');
    expect(migration).toContain("direct_print_jobs_org_request_key_uidx");
    expect(routes).toContain('req.header("Idempotency-Key")');
    expect(routes).toContain("onConflictDoNothing");
    expect(routes).toContain("directPrintJobs.requestKey");
  });

  test("a claimed device receives the canonical Traveler source only for its job", () => {
    const bridge = read("server/routes/localBridge.routes.ts");
    const source = read("server/services/orderTravelerSourceService.ts");

    expect(bridge).toContain('app.get("/api/local-bridge/direct-print/jobs/:id/traveler"');
    expect(bridge).toContain('eq(directPrintJobs.status, "claimed")');
    expect(bridge).toContain("getOrderTravelerSource(agent.organizationId, job.orderId)");
    expect(source).toContain("The single server-side projection");
  });

  test("the agent opens the existing Traveler page and the page uses the claimed-job source", () => {
    const traveler = read("client/src/pages/order-traveler.tsx");
    const agent = read("windows-print-agent/Program.cs");

    expect(traveler).toContain("directPrintJobId");
    expect(traveler).toContain("/api/local-bridge/direct-print/jobs/");
    expect(agent).toContain("job.travelerUrl");
    expect(agent).toContain("WebView2PrintStatus.Succeeded");
  });

  test("browser print remains an explicit fallback", () => {
    const dialog = read("client/src/components/production/TravelerPrintDialog.tsx");
    expect(dialog).toContain("Open Browser Print");
    expect(dialog).toContain("Idempotency-Key");
  });
});
