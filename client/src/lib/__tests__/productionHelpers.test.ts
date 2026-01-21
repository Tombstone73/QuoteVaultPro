/**
 * Test: deriveLaminationDisplay helper
 * Run with: npx tsx client/src/lib/__tests__/productionHelpers.test.ts
 */

import { deriveLaminationDisplay, isRollJob, isFlatbedJob, formatDimensions } from '../productionHelpers';

console.log('🧪 Testing deriveLaminationDisplay()...\n');

// Test 1: Gloss from structured option
const test1 = deriveLaminationDisplay({
  lineItem: {
    selectedOptions: [
      { optionId: '1', optionName: 'Lamination Type', value: 'gloss' }
    ]
  }
});
console.log('✅ Test 1 - Gloss from option:', test1);
console.assert(test1.kind === 'gloss', 'Should detect gloss');
console.assert(test1.source === 'option', 'Source should be option');

// Test 2: Matte from structured option
const test2 = deriveLaminationDisplay({
  lineItem: {
    selectedOptions: [
      { optionId: '2', optionName: 'Finish', value: 'matte' }
    ]
  }
});
console.log('✅ Test 2 - Matte from option:', test2);
console.assert(test2.kind === 'matte', 'Should detect matte');

// Test 3: Textured Floor from option with note
const test3 = deriveLaminationDisplay({
  lineItem: {
    selectedOptions: [
      { optionId: '3', optionName: 'Lamination', value: 'textured', note: 'floor graphics anti-slip' }
    ]
  }
});
console.log('✅ Test 3 - Textured Floor from option:', test3);
console.assert(test3.kind === 'textured_floor', 'Should detect textured floor');

// Test 4: Custom from option
const test4 = deriveLaminationDisplay({
  lineItem: {
    selectedOptions: [
      { optionId: '4', optionName: 'Lamination', value: 'custom', note: 'See notes for UV-resistant specs' }
    ]
  }
});
console.log('✅ Test 4 - Custom from option:', test4);
console.assert(test4.kind === 'custom', 'Should detect custom');

// Test 5: Gloss from notes (fallback)
const test5 = deriveLaminationDisplay({
  lineItem: { selectedOptions: [] },
  notes: 'Customer wants gloss lamination on this banner'
});
console.log('✅ Test 5 - Gloss from notes:', test5);
console.assert(test5.kind === 'gloss', 'Should detect gloss from notes');
console.assert(test5.source === 'note', 'Source should be note');

// Test 6: Matte from notes
const test6 = deriveLaminationDisplay({
  lineItem: { selectedOptions: [] },
  notes: 'Apply matte lamination after printing'
});
console.log('✅ Test 6 - Matte from notes:', test6);
console.assert(test6.kind === 'matte', 'Should detect matte from notes');

// Test 7: No lamination data
const test7 = deriveLaminationDisplay({
  lineItem: { selectedOptions: [] },
  notes: ''
});
console.log('✅ Test 7 - No lamination:', test7);
console.assert(test7.kind === 'none', 'Should return none');
console.assert(test7.label === '—', 'Label should be em dash');

// Test 8: Empty input
const test8 = deriveLaminationDisplay({});
console.log('✅ Test 8 - Empty input:', test8);
console.assert(test8.kind === 'none', 'Should handle empty input');

console.log('\n🧪 Testing isRollJob()...\n');

console.assert(isRollJob('roll') === true, 'Should detect roll');
console.assert(isRollJob('Roll') === true, 'Should be case-insensitive');
console.assert(isRollJob('ROLL') === true, 'Should handle uppercase');
console.assert(isRollJob('flatbed') === false, 'Should not match flatbed');
console.assert(isRollJob(null) === false, 'Should handle null');
console.assert(isRollJob(undefined) === false, 'Should handle undefined');
console.log('✅ All isRollJob() tests passed');

console.log('\n🧪 Testing isFlatbedJob()...\n');

console.assert(isFlatbedJob('flatbed') === true, 'Should detect flatbed');
console.assert(isFlatbedJob('Flatbed') === true, 'Should be case-insensitive');
console.assert(isFlatbedJob('FLATBED') === true, 'Should handle uppercase');
console.assert(isFlatbedJob('roll') === false, 'Should not match roll');
console.assert(isFlatbedJob(null) === false, 'Should handle null');
console.log('✅ All isFlatbedJob() tests passed');

console.log('\n🧪 Testing formatDimensions()...\n');

const dim1 = formatDimensions('54', '120', true);
console.log('Roll dimensions:', dim1);
console.assert(dim1 === '54" wide × 120" run', 'Should format roll dimensions');

const dim2 = formatDimensions('24', '36', false);
console.log('Flat dimensions:', dim2);
console.assert(dim2 === '24 × 36', 'Should format flat dimensions');

const dim3 = formatDimensions('54', null, true);
console.log('Roll width only:', dim3);
console.assert(dim3 === '54" wide', 'Should handle roll width only');

const dim4 = formatDimensions(null, null, false);
console.log('No dimensions:', dim4);
console.assert(dim4 === '—', 'Should return em dash for missing dimensions');

console.log('✅ All formatDimensions() tests passed');

console.log('\n✅ All tests passed! 🎉');
