import { invoiceBulkActionPermissions } from "../invoiceBulkActionPermissions";

describe("Invoice bulk action authority", () => {
  test("Owner retains all four operations", () => {
    expect(invoiceBulkActionPermissions("owner", [])).toEqual({ send: true, markSent: true, approve: true, payment: true });
  });

  test("tenant Admin can collect a payment even when global identity fields differ", () => {
    expect(invoiceBulkActionPermissions("admin", [])).toEqual({ send: true, markSent: true, approve: true, payment: true });
  });

  test("Accounting and custom staff can collect payment from an assigned grant", () => {
    for (const role of ["member", "custom"]) {
      expect(invoiceBulkActionPermissions(role, ["payment.record"])).toEqual({ send: false, markSent: false, approve: false, payment: true });
    }
  });

  test("a staff member without payment permission cannot collect payment", () => {
    expect(invoiceBulkActionPermissions("member", [])).toEqual({ send: false, markSent: false, approve: false, payment: false });
  });

  test("unrelated Invoice capabilities cannot authorize delivery or accounting approval", () => {
    expect(invoiceBulkActionPermissions("member", ["invoice.issue", "invoice.editIssued"])).toEqual({ send: false, markSent: false, approve: false, payment: false });
  });
});
