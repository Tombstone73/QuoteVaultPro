import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { ThemeProvider, useTheme } from "@/hooks/useTheme";
import PrinterSettingsPage from "@/pages/settings/printers";
import { PrinterMachineAssignment } from "@/components/production/PrinterMachineAssignment";
import "../../client/src/index.css";

let scenario="configured";
const requests:Array<{path:string;method:string}>=[];
const originalFetch=window.fetch.bind(window);
window.fetch=async(input,init)=>{
  const path=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url,location.origin).pathname;
  if(!path.startsWith('/api/'))return originalFetch(input,init);
  const method=init?.method??'GET';requests.push({path,method});
  if(method!=='GET')throw new Error('Synthetic configuration audit does not authorize writes');
  const raw=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  const success=(data:unknown)=>raw({success:true,data});
  if(path==='/api/organization/preferences') {
    if(scenario==='error')return raw({message:'Synthetic denied read'},403);
    if(scenario==='legacy')return raw({});
    return raw({production:{printerOptionsByStation:scenario==='empty'?{roll:[],flatbed:[]}:scenario==='invalid'?{roll:'not an array',wide_roll:['Legacy alias']}:{roll:['Canon Colorado M5W','Epson SureColor S60600'],flatbed:['Digitech ST'],finishing:['Kongsberg XL24','Graphtec FC9000','Laminator']}}});
  }
  if(path==='/api/materials')return success([
    {id:'roll-1',name:'Synthetic adhesive vinyl',sku:'QA-ROLL',type:'roll',materialForm:'roll',width:'54',height:null,edgeWasteInPerSide:'0.25',stockQuantity:'2',inventoryUnit:'roll',isActive:true},
    {id:'sheet-1',name:'Synthetic incomplete rigid board',sku:'QA-SHEET',type:'sheet',materialForm:'sheet',width:'48',height:null,stockQuantity:'0',inventoryUnit:'sheet',isActive:false},
    ...Array.from({length:45},(_,index)=>({id:`media-${index}`,name:`Synthetic media ${index+1}`,sku:`QA-${index}`,type:'sheet',width:'48',height:'96',stockQuantity:'1',inventoryUnit:'sheet',isActive:true})),
  ]);
  if(path==='/api/printer-profiles')return success([{id:'profile-1',organizationId:'synthetic',displayName:'Synthetic office ticket queue',printerType:'production_ticket',intendedUse:'production_ticket',windowsQueueName:'QA queue',isActive:true,isDefault:true,createdAt:'2026-11-03',updatedAt:'2026-11-03'}]);
  if(path==='/api/local-bridge/admin/agents')return success([]);
  throw new Error(`Unexpected synthetic API read: ${path}`);
};
Object.assign(window,{
  __printerConfigurationRequests:()=>requests,
  __printerConfigurationScenario:async(value:string)=>{scenario=value;await queryClient.invalidateQueries({queryKey:['/api/organization/preferences']});},
});
function Fixture() {
  const {setTheme}=useTheme();
  return <div className="min-h-screen bg-background p-4 text-foreground">
    <div className="mb-3 flex gap-3 text-xs"><span>Synthetic configuration · no equipment contacted</span><button onClick={()=>setTheme('light')}>Light</button><button onClick={()=>setTheme('dark')}>Dark</button></div>
    <PrinterSettingsPage/>
    <section className="mt-4 max-w-lg rounded border p-3"><h2>Assignment display fixture</h2><PrinterMachineAssignment jobId="synthetic-job" stationKey="flatbed" assignedPrinterName="Historical assignment retained" printerOptions={['Digitech ST']}/></section>
  </div>;
}
createRoot(document.getElementById('root')!).render(<ThemeProvider><QueryClientProvider client={queryClient}><BrowserRouter><Fixture/></BrowserRouter></QueryClientProvider></ThemeProvider>);
