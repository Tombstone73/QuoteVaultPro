import { describe, expect, test } from "@jest/globals";
import { parseTenderedAmountCents, reconcileCustomerPaymentEntry, resolveCustomerPaymentAmounts } from "./customerPaymentTender";

describe("customer payment tender calculations", () => {
  test("uses the entire tender for an exact selected balance", () => {
    expect(resolveCustomerPaymentAmounts(486700, parseTenderedAmountCents("4867.00")!)).toEqual({ appliedAmountCents: 486700, remainingBalanceCents: 0, changeDueCents: 0 });
  });

  test("keeps the unpaid remainder for a partial payment", () => {
    expect(resolveCustomerPaymentAmounts(486700, parseTenderedAmountCents("4000")!)).toEqual({ appliedAmountCents: 400000, remainingBalanceCents: 86700, changeDueCents: 0 });
  });

  test("caps an overpayment before it can be submitted as an invoice payment", () => {
    expect(resolveCustomerPaymentAmounts(486700, parseTenderedAmountCents("5000")!)).toEqual({ appliedAmountCents: 486700, remainingBalanceCents: 0, changeDueCents: 13300 });
  });

  test("allows a $5,000 tender against $4,910.75 and leaves $89.25 as change", () => {
    expect(resolveCustomerPaymentAmounts(491075, parseTenderedAmountCents("5000.00")!)).toEqual({ appliedAmountCents: 491075, remainingBalanceCents: 0, changeDueCents: 8925 });
  });

  test("preserves cents exactly and rejects malformed or non-positive input at the caller", () => {
    expect(resolveCustomerPaymentAmounts(9995, parseTenderedAmountCents("100.00")!)).toEqual({ appliedAmountCents: 9995, remainingBalanceCents: 0, changeDueCents: 5 });
    expect(parseTenderedAmountCents("1.999")).toBeNull();
    expect(parseTenderedAmountCents("-1")).toBeNull();
  });
});


const entryInvoices=[{invoiceId:'later',invoiceNumber:'A',remainingCents:17500,dueDate:'2026-06-20'},{invoiceId:'oldest',invoiceNumber:'Z',remainingCents:20000,dueDate:'2026-06-01'},{invoiceId:'last',invoiceNumber:'C',remainingCents:10000,dueDate:'2026-07-01'}];
const reconcile=(amount:number,extra:Partial<Parameters<typeof reconcileCustomerPaymentEntry>[0]>={})=>reconcileCustomerPaymentEntry({invoices:entryInvoices,tenderedAmountCents:amount,mode:'oldest_first',customAmounts:{},returnChange:false,...extra});
test('canonical oldest-first uses dates rather than display order and never loses partial cents',()=>{
 const result=reconcile(25001);expect(result.allocations).toEqual([{invoiceId:'oldest',amountCents:20000},{invoiceId:'later',amountCents:5001}]);expect(result).toMatchObject({appliedAmountCents:25001,remainingBalanceCents:22499,unresolvedCents:0,ready:true});
});
test('excess cannot be silently held or discarded; an explicit return is required',()=>{
 expect(reconcile(50000)).toMatchObject({appliedAmountCents:47500,potentialChangeCents:2500,changeDueCents:0,unresolvedCents:2500,unappliedCreditCents:0,ready:false});
 expect(reconcile(50000,{returnChange:true})).toMatchObject({changeDueCents:2500,unresolvedCents:0,unappliedCreditCents:0,ready:true});
});
test('custom amounts use shared validation and report the actual edited total, not the tender cap',()=>{
 const incomplete=reconcile(30000,{mode:'custom',customAmounts:{later:'100',oldest:'150',last:'0'}});expect(incomplete).toMatchObject({appliedAmountCents:25000,unresolvedCents:5000,ready:false});expect(incomplete.error).toContain('exactly');
 const valid=reconcile(30000,{mode:'custom',customAmounts:{later:'100',oldest:'150',last:'50'}});expect(valid.ready).toBe(true);expect(valid.allocations.reduce((sum,row)=>sum+row.amountCents,0)).toBe(30000);
 expect(reconcile(30000,{mode:'custom',customAmounts:{later:'100.005',oldest:'150',last:'50'}}).ready).toBe(false);
 expect(reconcile(30000,{mode:'custom',customAmounts:{later:'400',oldest:'0',last:'0'}}).error).toContain('exceeds');
});
