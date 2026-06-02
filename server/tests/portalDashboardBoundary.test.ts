import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("portal dashboard boundary", () => {
  test("dashboard endpoint is implemented through portal service DTOs", () => {
    const routes = read("server/routes/portal.routes.ts");
    const service = read("server/services/portal.service.ts");

    expect(routes).toContain('"/api/portal/dashboard"');
    expect(routes).toContain("getPortalDashboard");
    expect(service).toContain("PortalDashboardDto");
    expect(service).toContain("listPortalInvoices(req)");
    expect(service).toContain("listPortalOrders(req)");
    expect(service).toContain("listPortalQuotes(req)");
  });

  test("portal dashboard and quotes page converge on the traced quote service", () => {
    const routes = read("server/routes/portal.routes.ts");
    const service = read("server/services/portal.service.ts");
    const hooks = read("client/src/hooks/usePortal.ts");

    expect(hooks).toContain('portalFetch<PortalDashboardDto>("/api/portal/dashboard")');
    expect(hooks).toContain('portalFetch<PortalQuoteListDto[]>("/api/portal/quotes")');
    expect(routes).toContain('app.get("/api/portal/dashboard", ...portalMiddlewares, portalGet(getPortalDashboard))');
    expect(routes).toContain('app.get("/api/portal/quotes", ...portalMiddlewares, portalGet(listPortalQuotes))');
    expect(service).toContain("PORTAL_QUOTE_HYDRATION_TRACE");
    expect(service).toContain("export async function listPortalQuotes");
  });

  test("dashboard source avoids raw internal data surfaces", () => {
    const service = read("server/services/portal.service.ts");
    const start = service.indexOf("export async function getPortalDashboard");
    const dashboardSource = service.slice(start, service.indexOf("function buildProofSummary", start));

    expect(dashboardSource).not.toContain("notesInternal");
    expect(dashboardSource).not.toContain("staff");
    expect(dashboardSource).not.toContain("route");
    expect(dashboardSource).not.toContain("fileUrl");
    expect(dashboardSource).not.toContain("bucket");
    expect(dashboardSource).not.toContain("objectPath");
  });
});
