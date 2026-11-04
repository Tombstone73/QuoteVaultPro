import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("printer profile UI contract", () => {
  test("all profile dialogs scroll and operator removal uses history-preserving archive", () => {
    const picker = read("client/src/components/production/PrinterPicker.tsx");
    const settings = read("client/src/pages/settings/printers.tsx");
    expect(picker.match(/max-h-\[90dvh\] overflow-y-auto/g)).toHaveLength(2);
    expect(settings.match(/max-h-\[90dvh\] overflow-y-auto/g)).toHaveLength(2);
    expect(settings).toContain("deactivateMutation.mutate(profile.id)");
    expect(settings).not.toContain("useDeletePrinterProfile");
    expect(settings).toContain("already queued jobs are not canceled");
    const repo = read("server/storage/printerProfiles.repo.ts");
    expect(repo).toContain("{ isActive: false, isDefault: false }");
  });
  test("Settings exposes printer management under /settings/printers", () => {
    const app = read("client/src/App.tsx");
    const settings = read("client/src/lib/settingsSearch.ts");

    expect(app).toContain('path="printers"');
    expect(settings).toContain('route: "/settings/printers"');
    expect(settings).toContain('label: "Printers"');
  });

  test("sample ticket picker uses centralized printer profiles and empty state", () => {
    const picker = read("client/src/components/production/PrinterPicker.tsx");

    expect(picker).toContain("No printer profiles are configured.");
    expect(picker).toContain("Manage Printers");
    expect(picker).toContain("PrinterProfileForm");
    expect(picker).not.toContain("Save Printer");
    expect(picker).not.toContain("Add a printer name");
  });

  test("print UI does not falsely claim direct physical printing", () => {
    const picker = read("client/src/components/production/PrinterPicker.tsx");
    const ticket = read("client/src/pages/production-ticket.tsx");

    expect(picker).toContain("They do not bypass the browser dialog");
    expect(picker).toContain("The browser print dialog will still open");
    expect(ticket).toContain("window.print()");
  });

  test("active production-ticket profiles drive the print dropdown", () => {
    const hook = read("client/src/hooks/useStationPrinter.ts");

    expect(hook).toContain('active: true');
    expect(hook).toContain('intendedUse: "production_ticket"');
    expect(hook).toContain("profiles.length === 1");
  });
});
