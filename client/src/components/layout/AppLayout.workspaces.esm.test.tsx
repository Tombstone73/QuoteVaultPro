import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React, { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { beforeAll, beforeEach, afterEach, expect, jest, test } from "@jest/globals";
import { MemoryRouter, Routes, Route, useLocation, useParams } from "react-router-dom";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { NavigationGuardProvider } from "@/contexts/NavigationGuardContext";
let presentation = "overlay", organization = "org-a", loading = false, outletMounts = 0, staff="staff", authenticated=true;
jest.unstable_mockModule("@/features/assistant", () => ({
  AssistantWorkspaceProvider: ({children}: {children: React.ReactNode}) => <>{children}</>,
  AssistantOverlay: () => null, AssistantDock: () => <aside>Assistant</aside>,
  useAssistantWorkspace: () => ({presentation,capabilities:{enabled:true,conversationsEnabled:true}}),
}));
jest.unstable_mockModule("./TitanSidebarNav", () => ({TitanSidebarNav: () => null}));
jest.unstable_mockModule("./TitanTopBar", () => ({TitanTopBar: () => <nav>Main navigation</nav>}));
jest.unstable_mockModule("@/components/runtime/RuntimeSafetyWarning", () => ({RuntimeSafetyWarning: () => null}));
jest.unstable_mockModule("@/hooks/useAuth", () => ({useAuth: () => ({user:{id:staff,lastActiveOrgId:organization},isAuthenticated:authenticated})}));
jest.unstable_mockModule("@/hooks/useActiveOrganizationRole", () => ({useActiveOrganizationRole: () => ({activeOrgId:organization,isLoading:loading})}));
jest.unstable_mockModule("@/features/workspaces/WorkspaceEditor", () => ({WorkspaceEditor: function Editor() {
  const [value,setValue] = useState(""); return <input aria-label="Retained editor" value={value} onChange={event=>setValue(event.target.value)}/>;
}}));
let AppLayout: typeof import("./AppLayout").AppLayout;
beforeAll(async () => { ({ AppLayout } = await import("./AppLayout")); });
const queryClient=new QueryClient();
let host: HTMLDivElement, root: Root;
function RouterEditorOutlet() { useEffect(()=>{outletMounts++;},[]); return <span>Unscoped editor</span>; }
function IntakeReviewOutlet() {
  const { sessionId } = useParams();
  const { search } = useLocation();
  const workspace = useWorkspace();
  useEffect(() => { outletMounts++; }, []);
  return <output data-testid="intake-review">{sessionId}{search} · {workspace?.active ? "Active workspace" : "No active workspace"}</output>;
}
function App({ initial = "/orders/new" }: { initial?: string }) {
  return <QueryClientProvider client={queryClient}><MemoryRouter initialEntries={[initial]}><NavigationGuardProvider><Routes>
    <Route element={<AppLayout/>}>
      <Route path="/orders/new" element={<RouterEditorOutlet/>}/>
      <Route path="/admin/product-intake/sessions/:sessionId/review" element={<IntakeReviewOutlet/>}/>
    </Route>
  </Routes></NavigationGuardProvider></MemoryRouter></QueryClientProvider>;
}
beforeEach(() => {
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true}); Element.prototype.scrollIntoView=jest.fn();
  presentation="overlay";organization="org-a";loading=false;staff="staff";authenticated=true;localStorage.clear();
  outletMounts=0;
  Object.defineProperty(crypto,"randomUUID",{configurable:true,value:()=>"workspace"});
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
});
afterEach(()=>{act(()=>root.unmount());host.remove();queryClient.clear();jest.restoreAllMocks();});

test("AppLayout mounts a direct Product Intake review once inside its active workspace panel", () => {
  act(() => root.render(<App initial="/admin/product-intake/sessions/session-42/review?view=errors"/>));
  const selectedTab = host.querySelector('[role="tab"][aria-selected="true"]');
  const reviews = host.querySelectorAll('[data-testid="intake-review"]');
  expect(reviews).toHaveLength(1);
  expect(reviews[0].textContent).toBe("session-42?view=errors · Active workspace");
  expect(reviews[0].closest('[role="tabpanel"]')?.id).toBe(selectedTab?.getAttribute("aria-controls"));
  expect(outletMounts).toBe(1);
});

test("Assistant docking/undocking never reparents or remounts retained workspace editors",()=>{
  act(()=>root.render(<App/>)); const input=host.querySelector<HTMLInputElement>('[aria-label="Retained editor"]')!;
  expect(outletMounts).toBe(0);
  act(()=>{input.value="Unsaved pricing and artwork";Simulate.change(input);});
  for(const next of ["dock_left","dock_right","dock_bottom","overlay"]) {
    presentation=next;act(()=>root.render(<App/>));
    expect(host.querySelector('[aria-label="Retained editor"]')).toBe(input);expect(input.value).toBe("Unsaved pricing and artwork");
  }
});

test("workspace lifetime is scoped to the confirmed organization and waits for its initial identity",()=>{
  loading=true;act(()=>root.render(<App/>));expect(host.querySelector('[role="tabpanel"]')).toBeNull();
  loading=false;act(()=>root.render(<App/>));const first=host.querySelector('[role="tabpanel"]');expect(first).not.toBeNull();
  organization="org-b";act(()=>root.render(<App/>));expect(host.querySelector('[role="tabpanel"]')).not.toBe(first);
});

test('session expiration unmounts all editors and a different authenticated user cannot restore their metadata',()=>{
  act(()=>root.render(<App/>));const old=host.querySelector<HTMLInputElement>('[aria-label="Retained editor"]')!;
  act(()=>{old.value='Staff A private unsaved value';Simulate.change(old);});
  authenticated=false;act(()=>root.render(<App/>));expect(host.querySelector('[role="tabpanel"]')).toBeNull();expect(host.textContent).not.toContain('Staff A private');
  queryClient.setQueryData(['/api/orders','private-old-user'],{customer:'Must not leak'});
  staff='staff-b';authenticated=true;act(()=>root.render(<App/>));expect(host.querySelector<HTMLInputElement>('[aria-label="Retained editor"]')!.value).toBe('');
  expect(localStorage.getItem('titanos.workspaces.v1:staff:org-a')).not.toContain('private');
  expect(queryClient.getQueryData(['/api/orders','private-old-user'])).toBeUndefined();
});
