import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { quickBooksIntegrationApi, type ApiError } from "./api";
import { quickBooksIntegrationCallbackNotice } from "./quickBooksIntegrationCallbackNotice";

const label=(value:string)=>({not_connected:"Not connected",connected_sandbox:"Connected · Sandbox",connected_production:"Connected · Production",connected_unknown:"Connected · Mode unknown",authorization_required:"Authorization required",reconnect_required:"Reconnect required",worker_not_ready:"Worker not ready",sync_ready:"Sync ready",action_required:"Action required"} as Record<string,string>)[value]??"Unknown";
/** Settings deliberately exposes status, company display name, and OAuth
 * actions only.  Provider credentials and runtime secrets never cross it. */
export const QuickBooksSettingsWorkspace=({organizationId,sessionScope,canConfigure}:{organizationId:string;sessionScope:string;canConfigure:boolean})=>{
  const client=useQueryClient(); const key=["v2",sessionScope,organizationId,"settings","accounting"] as const;
  const callbackNotice=typeof window === "undefined" ? undefined : quickBooksIntegrationCallbackNotice(window.location.search);
  const query=useQuery({queryKey:key,queryFn:()=>quickBooksIntegrationApi.get(organizationId),enabled:Boolean(organizationId&&sessionScope&&canConfigure)});
  const refresh=(value:unknown)=>client.setQueryData(key,value);
  const connect=useMutation({mutationFn:()=>quickBooksIntegrationApi.connect(organizationId),onSuccess:(value)=>window.location.assign(value.authorizeUrl)});
  const disconnect=useMutation({mutationFn:()=>quickBooksIntegrationApi.disconnect(organizationId),onSuccess:refresh});
  if(!canConfigure)return <main className="lab"><h1>Accounting</h1><p>You do not have permission to configure Accounting.</p></main>;
  const value=query.data; const error=(query.error??connect.error??disconnect.error) as unknown as ApiError|undefined;
  const reconnect=value?.state==="authorization_required"||value?.state==="reconnect_required";
  return <main className="lab v2-sales-tax-settings"><header><small>SETTINGS</small><h1>Accounting</h1><p>QuickBooks receives a projection of canonical V2 Billing records through the single accounting queue. Credentials remain server-side.</p></header>{query.isLoading?<p>Loading accounting readiness…</p>:<section className="v2-sales-notes"><h2>QuickBooks Online</h2>{callbackNotice&&<p className="notice error">{callbackNotice}</p>}<p><b>Status:</b> {label(value?.state??"not_connected")}</p><p><b>Connection mode:</b> {(value?.environment??"unknown").toUpperCase()}</p>{value?.connectedCompanyName&&<p><b>Connected company:</b> {value.connectedCompanyName}</p>}<p>{value?.actionRequired??"The accounting queue is ready for canonical V2 Invoice, Payment, and Refund projections."}</p>{value?.state!=="sync_ready"&&<button className="button" type="button" disabled={connect.isPending} onClick={()=>connect.mutate()}>{connect.isPending?"Opening QuickBooks…":reconnect?"Reconnect QuickBooks":"Connect QuickBooks"}</button>}{value?.connected&&<button className="button secondary" type="button" disabled={disconnect.isPending} onClick={()=>disconnect.mutate()}>{disconnect.isPending?"Disconnecting…":"Disconnect QuickBooks"}</button>}{error&&<p className="notice error">{error.message??"Accounting integration is unavailable."}</p>}</section>}</main>;
};
