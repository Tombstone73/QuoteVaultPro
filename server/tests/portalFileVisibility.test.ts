import fs from "node:fs";
import path from "node:path";

import {
  getPortalFileCategoryLabel,
  normalizePortalFileCategory,
  portalFileCategoryValues,
} from "../../shared/portalFileVisibility";

const repoRoot = process.cwd();

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("portal file visibility classification", () => {
  test("unknown categories normalize to a customer-safe document label", () => {
    expect(normalizePortalFileCategory("bad_internal_category")).toBe("other_customer_document");
    expect(getPortalFileCategoryLabel("bad_internal_category")).toBe("Customer Document");
    expect(portalFileCategoryValues).toContain("approved_artwork");
    expect(portalFileCategoryValues).toContain("shipping_document");
  });

  test("migration defaults attachment visibility to hidden", () => {
    const migration = read("server/db/migrations_v2/0059_portal_file_visibility.sql").toLowerCase();

    expect(migration).toContain("customer_visible boolean not null default false");
    expect(migration).not.toContain("default true");
  });

  test("portal file DTO mapper does not expose storage internals", () => {
    const service = read("server/services/portal.service.ts");

    expect(service).toContain("PortalFileDto");
    expect(service).toContain("portalDisplayName");
    expect(service).not.toContain("objectPath: attachment");
    expect(service).not.toContain("bucket: attachment");
    expect(service).not.toContain("fileUrl: attachment");
  });
});
