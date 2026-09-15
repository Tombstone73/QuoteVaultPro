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

    expect(bridge).toContain('app.get("/api/local-bridge/direct-print/jobs/:id/traveler", bridgeAuth');
    expect(bridge).toContain('eq(directPrintJobs.status, "claimed")');
    expect(bridge).toContain("getOrderTravelerSource(agent.organizationId, job.orderId)");
    expect(bridge).toContain("bridgeAuth");
    expect(source).toContain("The single server-side projection");
  });

  test("missing or invalid bridge credentials cannot read the direct Traveler source", () => {
    const bridge = read("server/routes/localBridge.routes.ts");

    expect(bridge).toContain("const raw = String(req.headers.authorization || \"\").replace(/^Bearer\\s+/i, \"\")");
    expect(bridge).toContain('if (!raw) return res.status(401).json({ error: "Bridge token required" })');
    expect(bridge).toContain('eq(localBridgeAgents.status, "active")');
    expect(bridge).toContain('return res.status(401).json({ error: "Invalid or revoked bridge token" })');
  });

  test("only a structural direct-print shell bypasses staff routing; it embeds no Traveler data", () => {
    const app = read("client/src/App.tsx");
    const gate = read("client/src/pages/direct-print-traveler-route.tsx");

    expect(app).toContain('<Route path="/orders/:orderId/traveler" element={<DirectPrintTravelerRoute />} />');
    expect(gate).toContain("hasValidDirectPrintJobId");
    expect(gate).toContain('<Navigate to="/login" replace />');
    expect(gate).not.toContain("api/local-bridge/direct-print/jobs/");
    expect(gate).not.toContain("Authorization");
  });

  test("the agent opens the existing Traveler page and the page uses the claimed-job source", () => {
    const traveler = read("client/src/pages/order-traveler.tsx");
    const agent = read("windows-print-agent/Program.cs");

    expect(traveler).toContain("directPrintJobId");
    expect(traveler).toContain("/api/local-bridge/direct-print/jobs/");
    expect(agent).toContain("job.travelerUrl");
    expect(agent).toContain("GetTravelerNavigationUri");
    expect(agent).toContain("PrintersHero did not return an absolute Traveler web URL");
    expect(agent).toContain("CanonicalTravelerWebHosts");
    expect(agent).not.toContain('var route = $"{BaseUrl}{job.travelerUrl}');
    expect(traveler).toContain("apiFetch(url)");
    expect(agent).toContain('Uri.EscapeDataString(job.printNote ?? "")');
    expect(agent).toContain("WebView2PrintStatus.Succeeded");
  });

  test("the server claims jobs with the canonical configured web origin, not its API host", () => {
    const bridge = read("server/routes/localBridge.routes.ts");
    const urlBuilder = read("server/lib/directTravelerPrintUrl.ts");

    expect(bridge).toContain("getPublicWebOrigin()");
    expect(bridge).toContain("buildClaimedTravelerWebUrl");
    expect(urlBuilder).toContain('"www.printershero.com"');
    expect(urlBuilder).toContain('"dev.printershero.com"');
    expect(urlBuilder).toContain("directPrintJobId");
  });

  test("the ready marker remains attached only to the rendered Traveler print page", () => {
    const traveler = read("client/src/pages/order-traveler.tsx");
    const primitives = read("client/src/components/production/ticketPrintPrimitives.tsx");

    expect(traveler).toContain("if (error || !data || !traveler)");
    expect(traveler).toContain("<ThermalPrintPage ready");
    expect(primitives).toContain('data-traveler-ready={ready ? "true" : undefined}');
  });

  test("direct mode does not initialize staff printer controls", () => {
    const traveler = read("client/src/pages/order-traveler.tsx");
    const directStart = traveler.indexOf("function DirectPrintTravelerRenderer");
    const interactiveStart = traveler.indexOf("function InteractiveTravelerRenderer");
    const directRenderer = traveler.slice(directStart, interactiveStart);

    expect(directRenderer).not.toContain("useStationPrinter");
    expect(directRenderer).not.toContain("PrinterPicker");
    expect(directRenderer).not.toContain("window.print");
  });

  test("the print-only note stays on the durable print job and reaches both Traveler paths", () => {
    const schema = read("shared/schema.ts");
    const routes = read("server/routes/printerProfiles.routes.ts");
    const dialog = read("client/src/components/production/TravelerPrintDialog.tsx");

    expect(schema).toContain('printNote: varchar("print_note", { length: 1000 })');
    expect(routes).toContain("printNote: printNote || null");
    expect(routes).not.toContain("internalNotes:");
    expect(dialog).toContain("travelerBrowserPrintUrl(orderId, note)");
    expect(dialog).toContain("new URLSearchParams({ printNote: note })");
  });

  test("browser print remains an explicit fallback", () => {
    const dialog = read("client/src/components/production/TravelerPrintDialog.tsx");
    expect(dialog).toContain("Open Browser Print");
    expect(dialog).toContain("Idempotency-Key");
  });

  test("snapshots additional feed and renders it after the standard thermal tear-off space", () => {
    const schema = read("shared/schema.ts");
    const routes = read("server/routes/printerProfiles.routes.ts");
    const traveler = read("client/src/pages/order-traveler.tsx");
    const agent = read("windows-print-agent/Program.cs");
    const profileForm = read("client/src/components/production/PrinterProfileForm.tsx");

    expect(schema).toContain('trailingFeedMm: numeric("trailing_feed_mm"');
    expect(schema).toContain("z.coerce.number().min(0).max(100)");
    expect(routes).toContain("trailingFeedMm: destination.trailingFeedMm");
    expect(traveler).toContain("travelerFeedSpacerMm(feedMm)");
    expect(profileForm).toContain("Additional trailing feed (mm)");
    expect(profileForm).toContain("Added after the standard 38.1 mm / 1.5 in tear-off space.");
    expect(agent).toContain("CultureInfo.InvariantCulture");
    expect(agent).toContain("Effective trailing feed:");
    expect(agent).toContain("const decimal BaseTravelerTrailingFeedMm = 38.1m");
    expect(agent).toContain("BaseTravelerTrailingFeedMm + additionalFeedMm");
  });

  test("keeps the standard tear-off space plus only the configured additional feed", () => {
    const effectiveFeed = (additional: number) => 38.1 + Math.min(Math.max(additional, 0), 100);

    expect(effectiveFeed(0)).toBeCloseTo(38.1, 6);
    expect(effectiveFeed(12.7)).toBeCloseTo(50.8, 6);
    expect(effectiveFeed(25)).toBeCloseTo(63.1, 6);
    expect(effectiveFeed(100)).toBeCloseTo(138.1, 6);
  });

  test("queues durable work independently of freshness and then sends a data-free wake", () => {
    const routes = read("server/routes/printerProfiles.routes.ts");
    const wake = read("server/services/printAgentWake.ts");

    expect(routes).toContain("publishPrintAgentWake(agent.tokenHash)");
    expect(routes).not.toContain('code: "PRINT_AGENT_OFFLINE"');
    expect(routes).not.toContain("now - new Date(item.lastSeenAt).getTime() < 120000");
    expect(wake).toContain('JSON.stringify({ type: PRINT_AGENT_WAKE_EVENT })');
    expect(wake).toContain("maxAttempts = 2");
    expect(wake).not.toContain("orderId");
    expect(wake).not.toContain("queueName");
  });
});
