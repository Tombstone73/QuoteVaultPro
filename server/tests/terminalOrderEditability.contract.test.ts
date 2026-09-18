import { describe, expect, it } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(file: string) {
  return readFile(path.resolve(process.cwd(), file), "utf8");
}

describe("terminal Order editability contract", () => {
  it("keeps narrow completed-order metadata corrections separate from high-risk overrides", async () => {
    const routes = await source("server/routes/orders.routes.ts");

    expect(routes).toContain('import { classifyTerminalOrderPatch } from "@shared/terminalOrderEditPolicy"');
    expect(routes).toContain('const terminalPatchClassification = classifyTerminalOrderPatch(req.body ?? {});');
    expect(routes).toContain('terminalPatchClassification === "high_risk"');
    expect(routes).toContain('ORDER_CANCELLED_EDIT_RESTRICTED');
    expect(routes).toContain('High-risk completed-order corrections are disabled');
  });

  it("writes append-only notes and metadata corrections to the Order timeline", async () => {
    const routes = await source("server/routes/orders.routes.ts");

    expect(routes).toContain("actionType: 'order.internal_note_added'");
    expect(routes).toContain('metadata: { appendOnly: true, noteId: created.id }');
    expect(routes).toContain("fieldKey: 'flags'");
    expect(routes).toContain("fieldKey: 'contact'");
    expect(routes).toContain('new OrdersRepository(tx).createOrderAuditLog');
  });

  it("does not allow payment-applied invoice revisions to create an impossible balance", async () => {
    const invoicesService = await source("server/invoicesService.ts");

    expect(invoicesService).toContain('financialState.amountPaidCents > 0');
    expect(invoicesService).toContain('ORDER_INVOICE_PAYMENT_LOCKED');
    expect(invoicesService).toContain('Create a separate adjustment or additional invoice instead.');
  });
});
