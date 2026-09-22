import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "client/src/pages/portal/statement.tsx"), "utf8");

describe("PortalStatementPage", () => {
  test("uses the canonical portal statement hook and authenticated download", () => {
    expect(source).toContain("usePortalStatement()");
    expect(source).toContain("usePortalDownload()");
    expect(source).toContain("portalStatementPdfUrl(true)");
    expect(source).not.toContain("customerId");
  });

  test("renders the account balance, canonical line amounts, and zero state", () => {
    expect(source).toContain("Current amount due");
    expect(source).toContain("data.openItems.map");
    expect(source).toContain("Your account is up to date");
    expect(source).toContain("Download Statement");
    expect(source).toContain("data.recentPayments.map");
    expect(source).toContain("data.unappliedCredits.map");
  });

  test("uses responsive statement cards on mobile while retaining the desktop table", () => {
    expect(source).toContain('className="divide-y md:hidden"');
    expect(source).toContain('className="hidden overflow-x-auto md:block"');
    expect(source).toContain("Payments / credits");
  });
});
