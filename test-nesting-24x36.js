import NestingCalculator from './server/NestingCalculator.js';

// Test 24×36 pieces on 48×96 sheet @ $70/sheet
const calc = new NestingCalculator(48, 96, 70);

console.log('=== Testing 24×36 pieces on 48×96 sheet @ $70/sheet ===\n');

// Test 1 piece
console.log('--- 1 piece of 24×36 ---');
const result1 = calc.calculatePricingWithWaste(24, 36, 1);
console.log('Max pieces per sheet:', result1.maxPiecesPerSheet);
console.log('Total price:', '$' + result1.totalPrice.toFixed(2));
console.log('Average per piece:', '$' + result1.averageCostPerPiece.toFixed(2));
if (result1.partialSheetDetails) {
  console.log('Pattern:', result1.partialSheetDetails.pattern);
  console.log('Material:', result1.partialSheetDetails.chargeWidth + '" × ' + result1.partialSheetDetails.chargeHeight + '"');
}
console.log('');

// Test 2 pieces
console.log('--- 2 pieces of 24×36 ---');
const result2 = calc.calculatePricingWithWaste(24, 36, 2);
console.log('Max pieces per sheet:', result2.maxPiecesPerSheet);
console.log('Total price:', '$' + result2.totalPrice.toFixed(2));
console.log('Average per piece:', '$' + result2.averageCostPerPiece.toFixed(2));
if (result2.partialSheetDetails) {
  console.log('Pattern:', result2.partialSheetDetails.pattern);
  console.log('Material:', result2.partialSheetDetails.chargeWidth + '" × ' + result2.partialSheetDetails.chargeHeight + '"');
}
console.log('');

// Test 3 pieces
console.log('--- 3 pieces of 24×36 ---');
const result3 = calc.calculatePricingWithWaste(24, 36, 3);
console.log('Max pieces per sheet:', result3.maxPiecesPerSheet);
console.log('Total price:', '$' + result3.totalPrice.toFixed(2));
console.log('Average per piece:', '$' + result3.averageCostPerPiece.toFixed(2));
if (result3.partialSheetDetails) {
  console.log('Pattern:', result3.partialSheetDetails.pattern);
  console.log('Material:', result3.partialSheetDetails.chargeWidth + '" × ' + result3.partialSheetDetails.chargeHeight + '"');
}
console.log('');

// Test 5 pieces
console.log('--- 5 pieces of 24×36 ---');
const result5 = calc.calculatePricingWithWaste(24, 36, 5);
console.log('Max pieces per sheet:', result5.maxPiecesPerSheet);
console.log('Nesting pattern:', result5.nestingPattern);
console.log('Orientation:', result5.orientation);
console.log('Full sheets:', result5.fullSheets);
console.log('Remaining pieces:', result5.remainingPieces);
if (result5.partialSheetDetails) {
  console.log('Partial sheet pattern:', result5.partialSheetDetails.pattern);
  console.log('Material used:', result5.partialSheetDetails.chargeWidth + '" × ' + result5.partialSheetDetails.chargeHeight + '" (' + result5.partialSheetDetails.materialUsedSqft + ' sqft)');
  console.log('Waste:', result5.partialSheetDetails.wasteWidth + '" × ' + result5.partialSheetDetails.wasteHeight + '" (' + result5.partialSheetDetails.wasteSqft + ' sqft)');
  console.log('Usable waste:', result5.partialSheetDetails.usableWaste ? 'YES (sellable)' : 'NO (trash)');
  console.log('Cost:', '$' + result5.partialSheetDetails.cost.toFixed(2));
}
console.log('Total price:', '$' + result5.totalPrice.toFixed(2));
console.log('Average per piece:', '$' + result5.averageCostPerPiece.toFixed(2));
console.log('');

// Test 4 pieces
console.log('--- 4 pieces of 24×36 ---');
const result4 = calc.calculatePricingWithWaste(24, 36, 4);
console.log('Max pieces per sheet:', result4.maxPiecesPerSheet);
console.log('Nesting pattern:', result4.nestingPattern);
console.log('Orientation:', result4.orientation);
console.log('Full sheets:', result4.fullSheets);
console.log('Remaining pieces:', result4.remainingPieces);
if (result4.partialSheetDetails) {
  console.log('Partial sheet pattern:', result4.partialSheetDetails.pattern);
  console.log('Material used:', result4.partialSheetDetails.chargeWidth + '" × ' + result4.partialSheetDetails.chargeHeight + '" (' + result4.partialSheetDetails.materialUsedSqft + ' sqft)');
  console.log('Waste:', result4.partialSheetDetails.wasteWidth + '" × ' + result4.partialSheetDetails.wasteHeight + '" (' + result4.partialSheetDetails.wasteSqft + ' sqft)');
  console.log('Usable waste:', result4.partialSheetDetails.usableWaste ? 'YES (sellable)' : 'NO (trash)');
  console.log('Cost:', '$' + result4.partialSheetDetails.cost.toFixed(2));
}
console.log('Total price:', '$' + result4.totalPrice.toFixed(2));
console.log('Average per piece:', '$' + result4.averageCostPerPiece.toFixed(2));
console.log('');

// Test 10 pieces (should be 2 full sheets with 5 per sheet)
console.log('--- 10 pieces of 24×36 ---');
const result10 = calc.calculatePricingWithWaste(24, 36, 10);
console.log('Max pieces per sheet:', result10.maxPiecesPerSheet);
console.log('Nesting pattern:', result10.nestingPattern);
console.log('Orientation:', result10.orientation);
console.log('Full sheets:', result10.fullSheets);
console.log('Remaining pieces:', result10.remainingPieces);
console.log('Full sheets cost:', '$' + result10.fullSheetsCost.toFixed(2));
console.log('Total price:', '$' + result10.totalPrice.toFixed(2));
console.log('Average per piece:', '$' + result10.averageCostPerPiece.toFixed(2));
console.log('');

// Test 48×48 pieces
console.log('--- 1 piece of 48×48 ---');
const result48 = calc.calculatePricingWithWaste(48, 48, 1);
console.log('Max pieces per sheet:', result48.maxPiecesPerSheet);
console.log('Total price:', '$' + result48.totalPrice.toFixed(2));
console.log('Average per piece:', '$' + result48.averageCostPerPiece.toFixed(2));
console.log('');

console.log('=== Expected Results ===');
console.log('24×36 pieces: Max 5 per sheet, $14/piece (regardless of quantity)');
console.log('48×48 pieces: Max 2 per sheet, $35/piece (regardless of quantity)');
console.log('1 piece of 24×36: $14.00');
console.log('5 pieces of 24×36: $70.00 ($14/piece)');
console.log('10 pieces of 24×36: $140.00 ($14/piece)');
console.log('1 piece of 48×48: $35.00');

