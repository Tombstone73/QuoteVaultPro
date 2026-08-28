import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { emailIntegrationApi, type ApiError } from "./api";
import { emailIntegrationCallbackNotice } from "./emailIntegrationCallbackNotice";

const statusCopy = (status: string) => status === "ready" ? "Ready" : status === "reauth_required" ? "Reconnect required" : status === "error" ? "Needs attention" : "Not configured";

/** V2's only operator surface for tenant Gmail authorization.  It exposes
 * readiness only; credentials never cross this browser boundary. */
export const EmailSettingsWorkspace=({organizationId,sessionScope,canConfigure}:{organizationId:string;sessionScope:string;canConfigure:boolean})=>{
  const client=useQueryClient(); const key=["v2",sessionScope,organizationId,"settings","email"] as const;
  const callbackNotice=typeof window === "undefined" ? undefined : emailIntegrationCallbackNotice(window.location.search);
  const query=useQuery({queryKey:key,queryFn:()=>emailIntegrationApi.get(organizationId),enabled:Boolean(organizationId&&sessionScope&&canConfigure)});
  const refresh=(value:unknown)=>client.setQueryData(key,value);
  const connect=useMutation({mutationFn:()=>emailIntegrationApi.connect(organizationId),onSuccess:(value)=>{window.location.assign(value.authorizeUrl);}});
  const adopt=useMutation({mutationFn:()=>emailIntegrationApi.adoptLegacy(organizationId),onSuccess:refresh});
  const disconnect=useMutation({mutationFn:()=>emailIntegrationApi.disconnect(organizationId),onSuccess:refresh});
  if(!canConfigure)return <main className="lab"><h1>Email / Communications</h1><p>You do not have permission to configure tenant email delivery.</p></main>;
  const value=query.data; const error=(query.error??connect.error??adopt.error??disconnect.error) as unknown as ApiError|undefined;
  return <main className="lab v2-sales-tax-settings"><header><small>SETTINGS</small><h1>Email / Communications</h1><p>Connect the tenant Gmail sender used for authoritative customer-document delivery. Sender credentials remain server-side and encrypted at rest.</p></header>{query.isLoading?<p>Loading email readiness…</p>:<section className="v2-sales-notes"><h2>Gmail delivery</h2>{callbackNotice&&<p className="notice error">{callbackNotice}</p>}<p><b>Status:</b> {statusCopy(value?.status??"not_configured")}{value?.sendingAddress?` · ${value.sendingAddress}`:""}</p><p>{value?.actionRequired??"Customer-document delivery is ready when Gmail and the selected Quote recipient are both ready."}</p>{value?.legacyAvailable&&<button className="button secondary" type="button" disabled={adopt.isPending} onClick={()=>adopt.mutate()}>{adopt.isPending?"Adopting…":"Adopt existing Gmail connection"}</button>}{value?.status!=="ready"&&<button className="button" type="button" disabled={connect.isPending} onClick={()=>connect.mutate()}>{connect.isPending?"Opening Gmail…":value?.status==="reauth_required"?"Reconnect Gmail":"Connect Gmail"}</button>}{value?.status==="ready"&&<button className="button secondary" type="button" disabled={disconnect.isPending} onClick={()=>disconnect.mutate()}>{disconnect.isPending?"Disconnecting…":"Disconnect Gmail"}</button>}{error&&<p className="notice error">{error.message??"Email integration is unavailable."}</p>}</section>}</main>;
};
