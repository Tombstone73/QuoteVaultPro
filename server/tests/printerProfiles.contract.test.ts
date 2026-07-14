import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("printer profile management contract", () => {
  test("schema stores organization-scoped printer profiles with active/default state", () => {
    const schema = read("shared/schema.ts");
    const migration = read("server/db/migrations_v2/0114_printer_profiles.sql");

    expect(schema).toContain("export const printerProfiles");
    expect(schema).toContain("organizationId: varchar(\"organization_id\")");
    expect(schema).toContain("isActive: boolean(\"is_active\")");
    expect(schema).toContain("isDefault: boolean(\"is_default\")");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS printer_profiles");
    expect(migration).toContain("printer_profiles_org_default_use_uidx");
  });

  test("repository enforces tenant scope and clears duplicate defaults", () => {
    const repo = read("server/storage/printerProfiles.repo.ts");

    expect(repo).toContain("eq(printerProfiles.organizationId, organizationId)");
    expect(repo).toContain("eq(printerProfiles.intendedUse, data.intendedUse)");
    expect(repo).toContain("isDefault: false");
    expect(repo).toContain("Inactive printer profiles cannot be set as default");
  });

  test("routes provide list/create/update/default/deactivate/delete APIs", () => {
    const routes = read("server/routes/printerProfiles.routes.ts");
    const appRoutes = read("server/routes.ts");

    expect(routes).toContain('app.get("/api/printer-profiles"');
    expect(routes).toContain('app.post("/api/printer-profiles"');
    expect(routes).toContain('app.patch("/api/printer-profiles/:id"');
    expect(routes).toContain('app.post("/api/printer-profiles/:id/default"');
    expect(routes).toContain('app.post("/api/printer-profiles/:id/deactivate"');
    expect(routes).toContain('app.delete("/api/printer-profiles/:id"');
    expect(appRoutes).toContain("registerPrinterProfileRoutes");
  });
});
