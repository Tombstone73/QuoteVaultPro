import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const migrationPath = "server/db/migrations_v2/0209_v2_template_permission_convergence.sql";

describe("M5.1A template permission convergence migration", () => {
  test("synchronizes each managed organization set from its declared template", () => {
    const sql = read(migrationPath);
    expect(sql).toContain("INSERT INTO v2_permission_set_capabilities");
    expect(sql).toContain("JOIN v2_permission_set_templates template");
    expect(sql).toContain("template.template_key=permission_set.source_template_key");
    expect(sql).toContain("JOIN v2_permission_set_template_capabilities template_capability");
    expect(sql).toContain("ON CONFLICT DO NOTHING");
  });

  test("does not broaden custom permission sets and advances freshness only for changed organizations", () => {
    const sql = read(migrationPath);
    expect(sql).toContain("WHERE permission_set.source_template_key IS NOT NULL");
    expect(sql).not.toContain("WHERE permission_set.source_template_key IS NULL");
    expect(sql).toContain("RETURNING organization_id");
    expect(sql).toContain("authority_revision=state.authority_revision+1");
    expect(sql).toContain("SELECT DISTINCT organization_id FROM inserted");
  });

  test("covers the later operational and payment template grants that the Owner requires", () => {
    const sql = read(migrationPath);
    const ownerOperationalCapabilities = [
      "artwork.view", "artwork.adopt", "artwork.assign",
      "proof.view", "proof.prepare", "proof.issue",
      "prepress.view", "prepress.work", "prepress.complete",
      "production.view", "production.work", "production.complete",
      "fulfillment.view", "fulfillment.ship", "payment.view",
    ];
    const sources = [
      "0197_v2_artwork_domain_foundation.sql",
      "0199_v2_proofing_domain_foundation.sql",
      "0201_v2_prepress_domain_foundation.sql",
      "0204_v2_production_domain_foundation.sql",
      "0205_v2_fulfillment_domain_foundation.sql",
      "0208_v2_payment_history_capability.sql",
    ].map((file) => read(`server/db/migrations_v2/${file}`)).join("\n");
    for (const capability of ownerOperationalCapabilities) expect(sources).toContain(`'${capability}'`);
    expect(sql).toContain("template_capability.capability_id");
  });
});
