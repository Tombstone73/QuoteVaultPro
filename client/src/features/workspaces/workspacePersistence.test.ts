import { readWorkspace, writeWorkspace, workspaceStorageKey } from './workspacePersistence';
import { beforeEach, test, expect } from '@jest/globals';
const scope={userId:'staff-a',organizationId:'tenant-a'};
beforeEach(()=>localStorage.clear());
test('versioned metadata preserves ordering, active tab and canonical identity without business payloads',()=>{
  const tabs=[{id:'a',pathname:'/orders/order-1',general:false},{id:'b',pathname:'/quotes/new',general:false},{id:'c',pathname:'/customers/customer-1',general:true}];
  writeWorkspace(localStorage,scope,tabs,'b');
  expect(readWorkspace(localStorage,scope)).toEqual({version:1,tabs,activeId:'b'});
  expect(readWorkspace(localStorage,{...scope,userId:'staff-b'})).toBeNull();
  expect(readWorkspace(localStorage,{...scope,organizationId:'tenant-b'})).toBeNull();
  writeWorkspace(localStorage,scope,[{...tabs[0],customerNotes:'private',token:'secret',state:{draft:'sensitive'}} as any],'a');
  expect(localStorage.getItem(workspaceStorageKey(scope))).not.toMatch(/private|secret|sensitive|customerNotes|state/);
});
test.each(['{','{"version":0,"tabs":[]}','{"version":1,"tabs":[{"id":"bad","pathname":"https://elsewhere.test","general":true}]}','{"version":1,"tabs":[{"id":"bad","pathname":"/api/payments","general":true}]}'])('corrupt or incompatible storage safely falls back: %s',value=>{
  localStorage.setItem(workspaceStorageKey(scope),value);expect(readWorkspace(localStorage,scope)).toBeNull();
});
test('saved records deduplicate by entity type, not displayed number, and close is durable',()=>{
  const tabs=[{id:'a',pathname:'/orders/20937',general:false},{id:'b',pathname:'/orders/20937/edit',general:false},{id:'c',pathname:'/quotes/20937',general:false}];
  writeWorkspace(localStorage,scope,tabs,'b');expect(readWorkspace(localStorage,scope)?.tabs.map(tab=>tab.id)).toEqual(['a','c']);
  writeWorkspace(localStorage,scope,[tabs[2]],'c');expect(readWorkspace(localStorage,scope)?.tabs).toEqual([tabs[2]]);
});
test('blocked or exhausted browser storage cannot break mounted editors',()=>{
  const unavailable={getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('full');}};
  expect(readWorkspace(unavailable,scope)).toBeNull();expect(()=>writeWorkspace(unavailable,scope,[],null)).not.toThrow();
});
