import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("Traveler printer preference contract", () => {
  test("uses the durable user and organization scoped preference store", () => {
    const schema = read("shared/schema.ts");
    const routes = read("server/routes/printerProfiles.routes.ts");

    expect(schema).toContain("uniqueIndex('list_settings_unique').on(table.organizationId, table.userId, table.listKey)");
    expect(routes).toContain('app.get("/api/direct-print/traveler-preferences"');
    expect(routes).toContain('app.put("/api/direct-print/traveler-preferences"');
    expect(routes).toContain("TRAVELER_PRINTER_PREFERENCE_LIST_KEY");
    expect(routes).toContain("getUserId(req.user)");
    expect(routes).toContain("onConflictDoUpdate");
  });

  test("accepts only a current tenant's active mapped Traveler destination", () => {
    const routes = read("server/routes/printerProfiles.routes.ts");

    expect(routes).toContain("getAvailableTravelerDestination");
    expect(routes).toContain("eq(printerProfiles.organizationId, organizationId)");
    expect(routes).toContain("eq(printerProfiles.isActive, true)");
    expect(routes).toContain("supportedDocuments} ? 'traveler'");
    expect(routes).toContain('eq(localBridgeAgents.status, "active")');
    expect(routes).toContain("configuredTravelerPrinterName === destination.windowsQueueName");
    expect(routes).toContain('item.agentStatus === "active"');
  });

  test("keeps Traveler preferences separate from Quick Note printing", () => {
    const routes = read("server/routes/printerProfiles.routes.ts");
    const travelerPreferenceSection = routes.slice(
      routes.indexOf('app.get("/api/direct-print/traveler-preferences"'),
      routes.indexOf('app.post("/api/orders/:orderId/direct-print/traveler"'),
    );

    expect(travelerPreferenceSection).not.toContain("quick_note");
    expect(travelerPreferenceSection).not.toContain("quick-note");
  });
});
