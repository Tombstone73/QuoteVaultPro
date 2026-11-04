import { inboundOrderParsedDraftSchema } from '@shared/inboundOrdersApi';
// Regression evidence transcribed from the supplied PO, never a customer-specific parser rule.
export const brainstormPoText = 'Purchase Order 152989 11/04/26 Brainstorm Print Contact: QA buyer Supplier: Titan Arrival Due Date; MUST EOD 11/5 Price Approved: $55.00 + $25 RUSH = $80.00 Quantity Description 10 Double Sided Yard Signs Contour Cut Bassett Yard Signs - 1 VERSION Prints: 4/4 *DIFFERENT IMAGES ON EACH SIDE* Final Trim Size: 15.5" x 24" Contour Cut Stock: 4mil Coro QTY: 10';
export function brainstormParsedFixture() {
 return inboundOrderParsedDraftSchema.parse({customer:{companyName:'Brainstorm Print'},order:{jobLabel:'Titan Bassett Yard Signs',poNumber:'152989',requestedDueDate:'2026-11-05',requestedDeadline:{date:'2026-11-05',kind:'eod',localTime:null,sourceText:'MUST EOD 11/5'},poTotalPriceCents:8000,notes:'Approved PO total $80 includes $25 rush. Source says 4mil Coro; verify stock thickness. Requested deadline only.'},
 lineItems:[{productName:'Double Sided Yard Signs',sourceText:brainstormPoText,quantity:10,width:15.5,height:24,dimensionsUnit:'in',materialText:'4mil Coro',optionTexts:['Prints 4/4','Different images on each side'],finishingTexts:['Contour cut'],confidence:95}]});
}
