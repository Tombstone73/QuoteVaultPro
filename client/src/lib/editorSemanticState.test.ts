import { test, expect } from '@jest/globals';
import { editorNumberEqual, editorSemanticEqual, remainingEditorPatch } from './editorSemanticState';
test('option key order and blank optional values are not meaningful edits',()=>{
  expect(editorSemanticEqual({selected:{sides:'single',material:'vinyl'},note:null},{note:'',selected:{material:'vinyl',sides:'single'}})).toBe(true);
  expect(editorSemanticEqual({selected:{sides:'double'}},{selected:{sides:'single'}})).toBe(false);
  expect(editorSemanticEqual(['front','back'],['back','front'])).toBe(false);
});
test.each([['15.00',15],['24',24],['0.5',0.5],['',null]])('numeric formatting preserves meaning: %s', (a,b)=>expect(editorNumberEqual(a,b)).toBe(true));
test('blank required inputs, changed quantities and invalid numbers remain different',()=>{
  expect(editorNumberEqual('',0)).toBe(false);expect(editorNumberEqual('invalid',15)).toBe(false);expect(editorNumberEqual(3,5)).toBe(false);
});
test('save acknowledgement preserves newer shipping edits and fields not included in that save',()=>{
  expect(remainingEditorPatch({city:'New city',state:'IN',phone:'New phone'},{city:'Submitted city',state:'IN'})).toEqual({city:'New city',phone:'New phone'});
});
