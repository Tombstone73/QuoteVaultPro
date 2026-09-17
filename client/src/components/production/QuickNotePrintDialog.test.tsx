import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import { useQuery } from "@tanstack/react-query";

const toast = jest.fn(); const user = { id: "staff-a", lastActiveOrgId: "org-a" };
jest.mock("@tanstack/react-query", () => ({ useQuery: jest.fn() }));
jest.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user, isAdmin: true }) }));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
jest.mock("@/lib/queryClient", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/apiConfig", () => ({ apiUrl: (path: string) => path }));
jest.mock("@/components/ui/dialog", () => ({ Dialog: ({ children }: any) => <>{children}</>, DialogContent: ({ children }: any) => <div>{children}</div>, DialogDescription: ({ children }: any) => <p>{children}</p>, DialogFooter: ({ children }: any) => <footer>{children}</footer>, DialogHeader: ({ children }: any) => <header>{children}</header>, DialogTitle: ({ children }: any) => <h2>{children}</h2> }));
jest.mock("@/components/ui/button", () => ({ Button: ({ children, ...props }: any) => <button {...props}>{children}</button> }));
jest.mock("@/components/ui/input", () => ({ Input: (props: any) => <input {...props} /> }));
jest.mock("@/components/ui/textarea", () => ({ Textarea: (props: any) => <textarea {...props} /> }));
jest.mock("@/components/ui/label", () => ({ Label: ({ children, ...props }: any) => <label {...props}>{children}</label> }));
jest.mock("@/components/ui/checkbox", () => ({ Checkbox: (props: any) => <input type="checkbox" {...props} /> }));
jest.mock("@/components/ui/select", () => ({ Select: ({ children }: any) => <div>{children}</div>, SelectContent: ({ children }: any) => <div>{children}</div>, SelectItem: ({ children }: any) => <div>{children}</div>, SelectTrigger: ({ children }: any) => <div>{children}</div>, SelectValue: () => null }));
import { QuickNotePrintDialog } from "./QuickNotePrintDialog";
import { apiFetch } from "@/lib/queryClient";
const queryMock = jest.mocked(useQuery);
const destinations = [{ id: "note-a", displayName: "Note Printer", location: null, defaultCopies: 2, isDefault: true, available: true }];
let root: Root; let container: HTMLDivElement;
const type = async (selector: string, value: string) => { const node = container.querySelector(selector) as HTMLInputElement; await act(async () => { const setter = Object.getOwnPropertyDescriptor(node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")?.set; setter?.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); }); };
beforeEach(() => { (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true; container=document.createElement("div"); document.body.appendChild(container); root=createRoot(container); queryMock.mockReturnValue({ data: destinations, isLoading: false, error: null, refetch: jest.fn() } as any); jest.mocked(apiFetch).mockResolvedValue({ok:true,json:async()=>({success:true})} as any); Object.defineProperty(globalThis,"crypto",{configurable:true,value:{randomUUID:()=>"key-1"}}); });
afterEach(()=>{act(()=>root.unmount());container.remove();jest.clearAllMocks();});
async function render(){await act(async()=>{root.render(<QuickNotePrintDialog open onOpenChange={()=>undefined}/>);await Promise.resolve();});}
describe("QuickNotePrintDialog", () => {
 test("keeps Print Note disabled for an empty note and initializes profile defaults", async()=>{await render(); expect((container.querySelector("#quick-note-copies") as HTMLInputElement).value).toBe("2"); expect(Array.from(container.querySelectorAll("button")).find(x=>x.textContent==="Print Note")?.disabled).toBe(true);});
 test.each([["#quick-note-headline","Headline only"],["#quick-note-body","Body only"],["#quick-note-body","Line one\nLine two"]])("queues headline/body input through the canonical API client",async(selector,value)=>{await render();await type(selector as string,value as string);const copies=container.querySelector("#quick-note-copies") as HTMLInputElement;await type("#quick-note-copies","3");await act(async()=>{Array.from(container.querySelectorAll("button")).find(x=>x.textContent==="Print Note")?.click();await Promise.resolve();});expect(apiFetch).toHaveBeenCalledWith("/api/direct-print/quick-note",expect.objectContaining({body:expect.stringContaining('"copies":3'),headers:expect.objectContaining({"Idempotency-Key":"key-1"})}));const payload=JSON.parse((jest.mocked(apiFetch).mock.calls[0][1] as RequestInit).body as string);expect(selector==="#quick-note-headline"?payload.headline:payload.note).toBe(value);});
 test("preserves typed multiline content after an unavailable printer failure so retry is possible",async()=>{jest.mocked(apiFetch).mockResolvedValue({ok:false,json:async()=>({error:"offline"})} as any);await render();await type("#quick-note-body","Keep upright\nDo not stack");await act(async()=>{Array.from(container.querySelectorAll("button")).find(x=>x.textContent==="Print Note")?.click();await Promise.resolve();});expect((container.querySelector("#quick-note-body") as HTMLTextAreaElement).value).toBe("Keep upright\nDo not stack");expect(toast).toHaveBeenCalledWith(expect.objectContaining({variant:"destructive"}));});
 test("shows an explicit destination error and retries without closing",async()=>{const refetch=jest.fn();queryMock.mockReturnValue({data:undefined,isLoading:false,error:new Error("network"),refetch} as any);const onOpenChange=jest.fn();await act(async()=>{root.render(<QuickNotePrintDialog open onOpenChange={onOpenChange}/>);});expect(container.textContent).toContain("Could not load Quick Note destinations.");await act(async()=>{Array.from(container.querySelectorAll("button")).find(x=>x.textContent==="Retry")?.click();});expect(refetch).toHaveBeenCalledTimes(1);Array.from(container.querySelectorAll("button")).find(x=>x.textContent==="Cancel")?.click();expect(onOpenChange).toHaveBeenCalledWith(false);});
 test("shows a configuration state when no Quick Note destinations exist",async()=>{queryMock.mockReturnValue({data:[],isLoading:false,error:null,refetch:jest.fn()} as any);await render();expect(container.textContent).toContain("No Quick Note destinations are configured.");});
 test("identifies an outdated Print Agent instead of presenting Quick Note as queueable",async()=>{queryMock.mockReturnValue({data:[{...destinations[0],available:false,agentVersion:"1.0.23",quickNoteSupported:false,unavailableReason:"PRINT_AGENT_UPDATE_REQUIRED"}],isLoading:false,error:null,refetch:jest.fn()} as any);await render();expect(container.textContent).toContain("Print Agent update required");expect(container.textContent).toContain("Download Print Agent Update");expect(Array.from(container.querySelectorAll("button")).find(x=>x.textContent==="Print Note")?.disabled).toBe(true);});
});
