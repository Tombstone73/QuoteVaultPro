import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { Simulate } from "react-dom/test-utils";
import { beforeEach, afterEach, expect, jest, test } from "@jest/globals";

const query = jest.fn();
const materialRead = jest.fn();
jest.mock("@tanstack/react-query", () => ({ useQuery: (...args: unknown[]) => query(...args) }));
jest.mock("@/hooks/useMaterials", () => ({ useMaterials: (...args: unknown[]) => materialRead(...args) }));
jest.mock("@/lib/queryClient", () => ({ apiFetch: jest.fn() }));
import { ProductionEquipmentOverview } from "./ProductionEquipmentOverview";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host=document.createElement("div");document.body.append(host);root=createRoot(host);
  query.mockReturnValue({data:{production:{printerOptionsByStation:{roll:["Verified roll label"],flatbed:[]}}},isLoading:false,isError:false,refetch:jest.fn()});
  materialRead.mockClear(); materialRead.mockReturnValue({data:[
    {id:"roll",name:"Vinyl",sku:"ROLL-54",type:"roll",width:"54",stockQuantity:"2",inventoryUnit:"roll",isActive:true},
    {id:"sheet",name:"Rigid board",sku:"BOARD",type:"sheet",width:"48",height:null,stockQuantity:"0",inventoryUnit:"sheet",isActive:false},
  ],isLoading:false,isError:false,refetch:jest.fn()});
});
afterEach(()=>{act(()=>root.unmount());host.remove();jest.restoreAllMocks();});
const render=()=>act(()=>root.render(<MemoryRouter><ProductionEquipmentOverview/></MemoryRouter>));
function expandMaterials() { const details=host.querySelector("details")!;act(()=>{details.open=true;details.dispatchEvent(new Event("toggle"));}); }

test("saved labels and explicit empty lists are displayed without fabricated legacy equipment",()=>{
  render();expect(host.textContent).toContain("Verified roll label");expect(host.textContent).toContain("No configured choices");
  expect(host.textContent).not.toContain("Jetson");expect(host.textContent).not.toContain("S40");
  expect(host.textContent).toContain("active status");expect(host.textContent).toContain("not structured");
  expect(materialRead).not.toHaveBeenCalled();
});

test("legacy defaults and malformed stored configuration are explicitly unverified",()=>{
  query.mockReturnValue({data:{},isLoading:false,isError:false});render();expect(host.textContent).toContain("Legacy defaults — equipment unverified");
  query.mockReturnValue({data:{production:{printerOptionsByStation:{roll:"invalid"}}},isLoading:false,isError:false});render();
  expect(host.textContent).toContain("Invalid saved configuration");
});

test("an unsuccessful settings read never renders defaults as inventory",()=>{
  query.mockReturnValue({isLoading:false,isError:true,refetch:jest.fn()});render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("No equipment inventory has been verified");
  expect(host.textContent).not.toContain("S40");expect(host.querySelector("table")).toBeNull();
});

test("material details read existing records on demand and show independent size/status gaps",()=>{
  render();expandMaterials();expect(materialRead).toHaveBeenCalled();expect(host.textContent).toContain("2 roll/sheet records · 1 need dimension review");
  expect(host.textContent).toContain("Positive sheet height is missing");expect(host.textContent).toContain("Inactive material");
  expect(host.querySelector('a[href="/materials/sheet"]')).not.toBeNull();
  const input=host.querySelector<HTMLInputElement>('[aria-label="Filter media configuration"]')!;
  act(()=>{input.value="ROLL-54";Simulate.change(input);});expect(host.textContent).toContain("Vinyl");expect(host.textContent).not.toContain("Rigid board");
  expect(host.querySelector("form")).toBeNull();expect(Array.from(host.querySelectorAll("button")).some(button=>/assign|save|create|print/i.test(button.textContent ?? ""))).toBe(false);
});

test("material read failure is visible without changing the machine list",()=>{
  materialRead.mockReturnValue({isLoading:false,isError:true,refetch:jest.fn()});render();expandMaterials();
  expect(host.textContent).toContain("Material configuration could not be loaded");expect(host.textContent).toContain("Verified roll label");
});
