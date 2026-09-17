import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("Quick Note schema contract", () => {
  test("migration 0204 adds the printer receipt width and makes direct-print orders optional", () => {
    const migration = read("server/db/migrations_v2/0204_quick_note_direct_print.sql");
    expect(migration).toContain("ALTER TABLE direct_print_jobs");
    expect(migration).toContain("ALTER COLUMN order_id DROP NOT NULL");
    expect(migration).toContain("ALTER TABLE printer_profiles");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS receipt_width_mm numeric(7,2) NOT NULL DEFAULT 80");
  });

  test("ORM maps receipt_width_mm to printer profiles, not direct-print jobs", () => {
    const schema = read("shared/schema.ts");
    const profiles = schema.slice(schema.indexOf("export const printerProfiles"), schema.indexOf("export const insertPrinterProfileSchema"));
    const jobs = schema.slice(schema.indexOf("export const directPrintJobs"), schema.indexOf("// Stage 19G"));
    expect(profiles).toContain('receiptWidthMm: numeric("receipt_width_mm"');
    expect(jobs).not.toContain('receiptWidthMm: numeric("receipt_width_mm"');
    expect(jobs).toContain('orderId: varchar("order_id").references');
  });

  test("destinations filter for Quick Note support, retain availability, and safely report database failures", () => {
    const route = read("server/routes/printerProfiles.routes.ts");
    expect(route).toContain("printerProfiles.receiptWidthMm");
    expect(route).toContain("supportedDocuments} ? 'quick_note'");
    expect(route).toContain("available: Boolean(item.agentId && item.queueMapped && item.configuredQueueName && item.queueMapped === item.configuredQueueName)");
    expect(route).toContain('operation: "list_quick_note_destinations"');
    expect(route).toContain('code: "QUICK_NOTE_DESTINATIONS_UNAVAILABLE"');
  });
});
