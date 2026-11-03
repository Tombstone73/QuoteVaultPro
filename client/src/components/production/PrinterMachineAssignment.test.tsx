import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Simulate } from "react-dom/test-utils";
import { beforeEach, afterEach, expect, jest, test } from "@jest/globals";
const mutate=jest.fn();
jest.mock("@/hooks/useProduction",()=>({useAssignProductionPrinter:()=>({mutate,isPending:false})}));
import { PrinterMachineAssignment } from "./PrinterMachineAssignment";
let host:HTMLDivElement,root:Root;
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});mutate.mockClear();host=document.createElement("div");document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
test("configured choices exclude legacy defaults and retain a historical saved assignment",()=>{
  act(()=>root.render(<PrinterMachineAssignment jobId="job" stationKey="flatbed" assignedPrinterName="Existing historical machine" printerOptions={["Digitech ST"]}/>));
  expect(Array.from(host.querySelectorAll("option")).map(option=>option.value)).toEqual(["Digitech ST"]);
  expect(host.querySelector("input")!.value).toBe("Existing historical machine");expect(mutate).not.toHaveBeenCalled();
  const input=host.querySelector("input")!;act(()=>{input.value="Digitech ST";Simulate.change(input);});
  expect(mutate).not.toHaveBeenCalled();act(()=>host.querySelector("button")!.click());
  expect(mutate).toHaveBeenCalledWith({assignedPrinterId:null,assignedPrinterName:"Digitech ST"});
});
test("empty configured choices do not reintroduce fallback machines or clear existing data",()=>{
  act(()=>root.render(<PrinterMachineAssignment jobId="job" stationKey="roll" assignedPrinterName="Historical roll" printerOptions={[]}/>));
  expect(host.querySelectorAll("option")).toHaveLength(0);expect(host.querySelector("input")!.value).toBe("Historical roll");expect(mutate).not.toHaveBeenCalled();
});
