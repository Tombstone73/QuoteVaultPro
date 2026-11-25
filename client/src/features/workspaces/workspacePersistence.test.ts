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
  const tabs=[{id:'a',pathname:'/orders/20937',general:false},{id:'b',pathname:'/orders/20937/edit',general:false},{id:'c',pathname:'/quotes/20937',general:false},{id:'d',pathname:'/purchase-orders/20937',general:false},{id:'e',pathname:'/purchase-orders/20937',general:false}];
  writeWorkspace(localStorage,scope,tabs,'b');expect(readWorkspace(localStorage,scope)?.tabs.map(tab=>tab.id)).toEqual(['a','c','d']);
  writeWorkspace(localStorage,scope,[tabs[2]],'c');expect(readWorkspace(localStorage,scope)?.tabs).toEqual([tabs[2]]);
});
test('blocked or exhausted browser storage cannot break mounted editors',()=>{
  const unavailable={getItem:()=>{throw new Error('blocked');},setItem:()=>{throw new Error('full');}};
  expect(readWorkspace(unavailable,scope)).toBeNull();expect(()=>writeWorkspace(unavailable,scope,[],null)).not.toThrow();
});

test("ordinary routes restore by pathname and explicit navigation slots keep separate identities", () => {
  const tabs = [
    { id: "first", pathname: "/admin/product-intake/sessions/a/review", general: false },
    { id: "duplicate", pathname: "/admin/product-intake/sessions/a/review/", general: false },
    { id: "second", pathname: "/admin/product-intake/sessions/b/review", general: false },
    { id: "explicit", pathname: "/admin/product-intake/sessions/a/review", general: true },
  ];
  writeWorkspace(localStorage, scope, tabs, "second");
  expect(readWorkspace(localStorage, scope)).toEqual({
    version: 1,
    tabs: [tabs[0], tabs[2], tabs[3]],
    activeId: "second",
  });
});

test("portal metadata is scoped to its own account and excludes token and staff routes", () => {
  const portal = { kind: "portal" as const, userId: scope.userId, customerId: scope.organizationId };
  const invoice = { id: "invoice", pathname: "/portal/invoices/invoice-1", general: false };
  const proofToken = { id: "token", pathname: "/portal/proof/private-token", general: false };
  const order = { id: "staff", pathname: "/orders/123", general: false };
  writeWorkspace(localStorage, portal, [invoice, proofToken, order], "invoice");
  expect(readWorkspace(localStorage, portal)?.tabs).toEqual([invoice]);
  expect(readWorkspace(localStorage, { ...portal, customerId: "different-customer" })).toBeNull();
  expect(readWorkspace(localStorage, scope)).toBeNull();
  expect(localStorage.getItem(workspaceStorageKey(portal))).not.toContain("private-token");
  writeWorkspace(localStorage, scope, [invoice, order], "staff");
  expect(readWorkspace(localStorage, scope)?.tabs).toEqual([order]);
});
