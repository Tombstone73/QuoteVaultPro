/** Fixed Code 128-B TEST sample (104,52,37,51,52,checksum 76,106).
 * Symbol patterns: https://github.com/lindell/JsBarcode/blob/master/src/barcodes/CODE128/constants.js
 * This is an alignment artifact, never a carrier label or shipment barcode.
 */
const testBarcode = ['11010010000','11011100010','10001101000','11011101000','11011100010','11001010000','1100011101011'].join('');
const lines = (text: string) => text.match(/.{1,46}/gu) ?? [''];
export function ShippingLabelAlignmentTest({profileName,workstation,queueName,createdAt}:{profileName:string;workstation:string;queueName:string;createdAt:string}) {
  const details = [`Profile: ${profileName}`,`Workstation: ${workstation}`,`Windows queue: ${queueName}`,`Requested: ${new Date(createdAt).toLocaleString()}`].flatMap(lines);
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 384 576" width="4in" height="6in" role="img" aria-label="4 by 6 inch shipping label alignment test" style={{display:'block',background:'white',color:'black',fontFamily:'Arial, sans-serif'}}>
    <title>TEST PRINT · NOT A SHIPPING LABEL</title>
    <rect x="12" y="12" width="360" height="552" fill="none" stroke="black" strokeWidth="0.75" />
    <g fill="none" stroke="black" strokeWidth="2"><path d="M12 24V12H24 M360 12H372V24 M12 552V564H24 M360 564H372V552"/></g>
    <g fontSize="10" fill="black"><text x="26" y="27">TOP LEFT</text><text x="358" y="27" textAnchor="end">TOP RIGHT</text>
      <text x="26" y="552">BOTTOM LEFT</text><text x="358" y="552" textAnchor="end">BOTTOM RIGHT</text></g>
    <g textAnchor="middle" fill="black"><text x="192" y="48" fontSize="15" fontWeight="bold">↑ TOP · 4 × 6 INCHES</text>
      <text x="192" y="68" fontSize="11" fontWeight="bold">TEST PRINT · NOT A SHIPPING LABEL</text>
      <text x="192" y="88" fontSize="10">Border inset: 1/8 inch from every edge</text></g>
    <g fontSize="11" fill="black">{details.map((text,index)=><text key={index} x="28" y={114+index*13}>{text}</text>)}</g>
    <g transform="translate(93 442)" fill="black" shapeRendering="crispEdges" data-test-barcode="TEST" data-code128-checksum="76">
      {Array.from(testBarcode).map((bit,index)=>bit==='1'?<rect key={index} x={20+index*2} y="0" width="2" height="36"/>:null)}
    </g>
    <g textAnchor="middle" fill="black" fontSize="10"><text x="192" y="496">TEST · Code 128 · not valid for shipping</text>
      <text x="192" y="515">WIDTH 4 inches · HEIGHT 6 inches</text><text x="192" y="532">All four corners and border must be visible.</text></g>
  </svg>;
}
