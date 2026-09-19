import { describe, expect, it } from "@jest/globals";
import { readFile } from "node:fs/promises";
import path from "node:path";

async function source(file: string) {
  return readFile(path.resolve(process.cwd(), file), "utf8");
}

describe("terminal Order editability contract", () => {
  it("allows Admin/Owner completed-order corrections while keeping cancelled commercial recovery distinct", async () => {
    const routes = await source("server/routes/orders.routes.ts");

    expect(routes).toContain('import { classifyTerminalOrderPatch } from "@shared/terminalOrderEditPolicy"');
    expect(routes).toContain('const terminalPatchClassification = classifyTerminalOrderPatch(req.body ?? {});');
    expect(routes).toContain('terminalPatchClassification === "high_risk"');
    expect(routes).toContain('ORDER_CANCELLED_EDIT_RESTRICTED');
    expect(routes).toContain('This completed-order change can affect commercial or customer identity history and requires an Admin or Owner.');
    expect(routes).not.toContain('ORDER_LOCKED_SETTING_DISABLED');
  });

  it("writes append-only notes and metadata corrections to the Order timeline", async () => {
    const routes = await source("server/routes/orders.routes.ts");

    expect(routes).toContain("actionType: 'order.internal_note_added'");
    expect(routes).toContain('metadata: { appendOnly: true, noteId: created.id }');
    expect(routes).toContain("fieldKey: 'flags'");
    expect(routes).toContain("fieldKey: 'contact'");
    expect(routes).toContain('new OrdersRepository(tx).createOrderAuditLog');
  });

  it("keeps payment-applied invoice history immutable without rolling back the Order correction", async () => {
    const invoicesService = await source("server/invoicesService.ts");

    expect(invoicesService).toContain('financialState.amountPaidCents > 0');
    expect(invoicesService).toContain('paid_invoice_adjustment_required');
    expect(invoicesService).toContain('PAID_INVOICE_ADJUSTMENT_REQUIRED');
    expect(invoicesService).toContain('order_paid_invoice_adjustment_required');
  });
});
