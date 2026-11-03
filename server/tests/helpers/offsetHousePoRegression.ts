import { PDFDocument, StandardFonts } from 'pdf-lib';
import { inboundOrderParsedDraftSchema } from '@shared/inboundOrdersApi';

/** User-supplied regression facts, not a document-specific extraction rule. */
export function offsetHouseParsedFixture() {
  return inboundOrderParsedDraftSchema.parse({
    customer:{sourceName:'Laurie',companyName:'Offset House',sourceEmail:'buyer@example.invalid',confidence:95},
    order:{poNumber:'26-109691',requestedDueDate:'2026-11-10',requestedPickup:true,requestedShipMethod:'Customer pickup',poTotalPriceCents:71825,
      notes:'In hands November 10, 2026 MUST BY END OF DAY. Ignore the quantity on the outside vendor template and produce 5,300.',confidence:95},
    lineItems:[{productName:'All Sport Hard Hat Stickers',quantity:5300,width:4,height:1.5,dimensionsUnit:'in',materialText:'White permanent adhesive vinyl',
      sourceText:'All Sport Hard Hat Stickers - Cut To Shape 4 x 1.5 inches. Quantity 5300. Prints 4/0 on White Vinyl, Permanent Adhesive. Contour cut and shrink-wrap in 100s.',
      optionTexts:['4/0'],finishingTexts:['Contour cut','Shrink-wrap in 100s'],confidence:95}],
  });
}

export async function formPoFixture(reverseFields=false) {
  const pdf=await PDFDocument.create(),page=pdf.addPage([612,792]),font=await pdf.embedFont(StandardFonts.Helvetica),form=pdf.getForm();
  const rows=[['Purchase Order #','26-109691'],['Ordering customer','Offset House'],['Supplier','Titan Graphics'],['Ship to','We will pick up when ready'],
    ['Order date','11-2-2026'],['In Hands Date','11-10-2026 MUST - BY END OF DAY'],['Qty Ordered','5,300'],
    ['Item Description','All Sport Hard Hat Stickers - Cut To Shape 4 x 1.5 in'],['Specifications','Prints 4/0 on White Vinyl, Permanent Adhesive'],
    ['Finishing',"Contour cut & Shrink Wrap in 100's"],['Unit Price','Lot 5300'],['Total','$718.25']];
  for(const [i,[label,value]] of rows.entries())page.drawText(label,{x:30,y:750-i*49,size:11,font});
  const fields=rows.map(([label,value],i)=>({label,value,i}));
  for(const {label,value,i} of reverseFields?fields.reverse():fields){
    // Form names intentionally disagree with business meaning. Layout wins.
    const field=form.createTextField(label==='Ship to'?'Company Name':String(i));field.setText(value);field.addToPage(page,{x:160,y:741-i*49,width:420,height:21,font});
  }
  return Buffer.from(await pdf.save());
}
