import { allocateCustomerPayment } from "../../shared/customerPaymentAllocation";

const invoices = [
  { invoiceId: "a", remainingCents: 101, dueDate: "2026-01-01", invoiceNumber: "1" },
  { invoiceId: "b", remainingCents: 100, dueDate: "2026-01-02", invoiceNumber: "2" },
  { invoiceId: "c", remainingCents: 99, dueDate: "2026-01-03", invoiceNumber: "3" },
];
test("oldest-first never exceeds an invoice balance", () => expect(allocateCustomerPayment({ invoices, amountCents: 150, mode: "oldest_first" })).toEqual([{ invoiceId: "a", amountCents: 101 }, { invoiceId: "b", amountCents: 49 }]));
test("proportional allocation conserves exact cents deterministically", () => { const result = allocateCustomerPayment({ invoices, amountCents: 100, mode: "proportional" }); expect(result.reduce((total, item) => total + item.amountCents, 0)).toBe(100); expect(result).toEqual([{ invoiceId: "a", amountCents: 34 }, { invoiceId: "b", amountCents: 33 }, { invoiceId: "c", amountCents: 33 }]); });
test("custom allocation requires the exact payment amount and preserves zero-free child rows", () => expect(allocateCustomerPayment({ invoices, amountCents: 100, mode: "custom", customAllocations: [{ invoiceId: "a", amountCents: 100 }, { invoiceId: "b", amountCents: 0 }, { invoiceId: "c", amountCents: 0 }] })).toEqual([{ invoiceId: "a", amountCents: 100 }]));
test("guards empty selections, overpayments, duplicate IDs, and invalid custom allocations", () => { expect(() => allocateCustomerPayment({ invoices: [], amountCents: 1, mode: "oldest_first" })).toThrow(); expect(() => allocateCustomerPayment({ invoices, amountCents: 301, mode: "oldest_first" })).toThrow(); expect(() => allocateCustomerPayment({ invoices, amountCents: 10, mode: "custom", customAllocations: [] })).toThrow(); });
