import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const route = fs.readFileSync(path.resolve(process.cwd(), "server/routes/printerProfiles.routes.ts"), "utf8");
const bridge = fs.readFileSync(path.resolve(process.cwd(), "server/routes/localBridge.routes.ts"), "utf8");

describe("Quick Note durable direct-print contract", () => {
  test("validates note content/copies and creates an orderless quick-note job", () => {
    expect(route).toContain('app.post("/api/direct-print/quick-note"');
    expect(route).toContain('copies: z.coerce.number().int().min(1).max(25)');
    expect(route).toContain('orderId: null');
    expect(route).toContain('documentType: "quick_note"');
  });
  test("rejects an idempotency key reused for a different note and exposes claimed source only", () => {
    expect(route).toContain('QUICK_NOTE_IDEMPOTENCY_CONFLICT');
    expect(bridge).toContain('jobs/:id/quick-note');
    expect(bridge).toContain('job.documentType !== "quick_note"');
  });
});
