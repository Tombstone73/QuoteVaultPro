import { describe, expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("purchase order full-page workflow", () => {
  test("new purchase orders use a dedicated route instead of the old create modal", () => {
    const app = read("client/src/App.tsx");
    const list = read("client/src/pages/purchase-orders.tsx");

    expect(app).toContain('path="/purchase-orders/new"');
    expect(list).toContain('navigate("/purchase-orders/new")');
    expect(list).not.toContain("setShowCreate");
    expect(list).not.toContain("<PurchaseOrderForm open=");
  });

  test("purchase order form includes searchable Related Job / Order and clear support", () => {
    const form = read("client/src/components/PurchaseOrderForm.tsx");

    expect(form).toContain("Related Job / Order");
    expect(form).toContain("usePurchaseOrderRelatedOrderSearch");
    expect(form).toContain("onSelect(null)");
    expect(form).toContain('form.setValue("relatedOrderId"');
  });

  test("form preserves manual lines while material selection can populate vendor defaults", () => {
    const form = read("client/src/components/PurchaseOrderForm.tsx");

    expect(form).toContain("Manual / misc line");
    expect(form).toContain("material.vendorSku");
    expect(form).toContain("material.preferredVendorId");
    expect(form).toContain("material.vendorCostPerUnit");
  });

  test("new-page cancel returns to the PO list without a create request", () => {
    const page = read("client/src/pages/purchase-order-new.tsx");

    expect(page).toContain('onCancel={() => navigate("/purchase-orders")}');
    expect(page).toContain('onSaved={(po) => navigate(`/purchase-orders/${po.id}`)}');
  });
});
