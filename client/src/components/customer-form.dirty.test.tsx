import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";

jest.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { role: "admin" }, isAdmin: true }) }));
jest.mock("@/hooks/useActiveOrganizationRole", () => ({ useActiveOrganizationRole: () => ({ activeOrgId: "tenant", isAdminOrOwner: true }) }));
jest.mock("@/lib/queryClient", () => ({ apiRequest: jest.fn() }));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
const guard = jest.fn();
jest.mock("@/contexts/navigationGuardRegistration", () => ({ useWorkspaceUnsavedChanges: (...args: unknown[]) => guard(...args) }));
jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: any) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>, DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h1>{children}</h1>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}));
jest.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => <select value={value} onChange={event => onValueChange(event.target.value)}>{children}</select>,
  SelectTrigger: () => null, SelectValue: () => null, SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));
import CustomerForm from "./customer-form";
let host: HTMLDivElement, root: Root, client: QueryClient;
const closed = jest.fn();
const customer = { id: "synthetic-customer", companyName: "Test Company", customerType: "business", status: "active",
  contacts: [{ id: "synthetic-contact", firstName: "Test", lastName: "Contact", email: "test@example.test", isPrimary: true }] } as any;
let complete: (response: Response) => void;
const fetchMock = jest.fn<typeof fetch>();
const originalFetch = globalThis.fetch;
const response = (body: unknown, ok = true) => ({ ok, json: async () => body } as Response);
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(globalThis, { ResizeObserver: class { observe() {} unobserve() {} disconnect() {} } });
  guard.mockClear(); closed.mockClear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  fetchMock.mockReset(); fetchMock.mockImplementation(async (url, options) => {
    if (options?.method === "PATCH") return new Promise<Response>(resolve => { complete = resolve; });
    return response({ data: null });
  });
  globalThis.fetch = fetchMock;
});
afterEach(() => { act(() => root.unmount()); host.remove(); client.clear(); globalThis.fetch = originalFetch; jest.restoreAllMocks(); });
const latestDirty = () => guard.mock.calls.at(-1)?.[0];

test("confirmed Customer Save clears its own dirty baseline; failed saves retain edits and guard", async () => {
  await act(async () => root.render(<QueryClientProvider client={client}><CustomerForm open customer={customer} onOpenChange={closed} /></QueryClientProvider>));
  expect(latestDirty()).toBe(false);
  const status = host.querySelectorAll("select")[1];
  await act(async () => Simulate.change(status, { target: { value: "inactive" } } as any));
  expect(status.value).toBe("inactive");
  const notes = host.querySelector<HTMLTextAreaElement>("#notes")!;
  const credit = host.querySelector<HTMLInputElement>("#creditLimit")!;
  await act(async () => { credit.value = "1000"; Simulate.change(credit); });
  await act(async () => { notes.value = "Staff notes"; Simulate.change(notes); });
  expect(latestDirty()).toBe(true);
  await act(async () => Simulate.submit(host.querySelector("form")!));
  expect(Array.from(host.querySelectorAll(".text-destructive,.text-red-600")).map(node => node.textContent)).toEqual([]);
  expect(host.querySelector("fieldset")!.disabled).toBe(true);
  await act(async () => { complete(response({ message: "Try again" }, false)); });
  expect(latestDirty()).toBe(true);
  expect(notes.value).toBe("Staff notes");
  expect(closed).not.toHaveBeenCalled();
  await act(async () => Simulate.submit(host.querySelector("form")!));
  await act(async () => { complete(response({ ...customer, notes: "Staff notes" })); });
  expect(closed).toHaveBeenCalledWith(false);
  expect(latestDirty()).toBe(false);
  expect(notes.value).toBe("Staff notes");
  await act(async () => { notes.value = "More unsaved notes"; Simulate.change(notes); });
  expect(latestDirty()).toBe(true);
});

test("confirmed creation clears the form for a different new company", async () => {
  fetchMock.mockImplementation(async (_url, options) => options?.method === "POST"
    ? new Promise<Response>(resolve => { complete = resolve; }) : response([]));
  await act(async () => root.render(<QueryClientProvider client={client}><CustomerForm open onOpenChange={closed} /></QueryClientProvider>));
  for (const [id, value] of [["companyName", "New Synthetic Company"], ["primaryContact.firstName", "Test"], ["primaryContact.lastName", "Buyer"], ["primaryContact.email", "buyer@example.test"], ["creditLimit", "1000"]]) {
    const input = host.querySelector<HTMLInputElement>(`[name="${id}"]`)!;
    await act(async () => { input.value = value; Simulate.change(input); });
  }
  await act(async () => Simulate.submit(host.querySelector("form")!));
  expect(host.querySelector("fieldset")!.disabled).toBe(true);
  await act(async () => complete(response({ id: "new-customer", companyName: "New Synthetic Company" })));
  expect(closed).toHaveBeenCalledWith(false);
  expect(host.querySelector<HTMLInputElement>('[name="companyName"]')!.value).toBe("");
});

test('untouched Customer dialog, same-value controls, reverting notes and a refetch stay clean',async()=>{
  const render=()=>root.render(<QueryClientProvider client={client}><CustomerForm open customer={{...customer}} onOpenChange={closed}/></QueryClientProvider>);
  await act(async()=>render());expect(latestDirty()).toBe(false);
  const notes=host.querySelector<HTMLTextAreaElement>('#notes')!;
  await act(async()=>{notes.value='Changed';Simulate.change(notes);});expect(latestDirty()).toBe(true);
  await act(async()=>{notes.value='';Simulate.change(notes);});expect(latestDirty()).toBe(false);
  await act(async()=>render());expect(latestDirty()).toBe(false);
});

test('closing an edited Customer dialog requires deliberate discard and clears only its draft',async()=>{
  const confirm=jest.spyOn(window,'confirm').mockReturnValue(false);
  await act(async()=>root.render(<QueryClientProvider client={client}><CustomerForm open customer={customer} onOpenChange={closed}/></QueryClientProvider>));
  const notes=host.querySelector<HTMLTextAreaElement>('#notes')!;await act(async()=>{notes.value='Keep edits';Simulate.change(notes);});
  const cancel=Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Cancel')!;
  await act(async()=>Simulate.click(cancel));expect(closed).not.toHaveBeenCalled();expect(notes.value).toBe('Keep edits');
  confirm.mockReturnValue(true);await act(async()=>Simulate.click(cancel));expect(closed).toHaveBeenCalledWith(false);expect(notes.value).toBe('');expect(latestDirty()).toBe(false);
});
