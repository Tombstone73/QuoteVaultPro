import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { newBusinessRequestId, shippingPricingApi, type ApiError, type ShippingPricingMode } from "./api";

type Form = Readonly<{mode:ShippingPricingMode;currency:string;flatAmountCents:string;percentageBasisPoints:string}>;
const empty:Form={mode:"pass_through",currency:"USD",flatAmountCents:"",percentageBasisPoints:""};
const form=(value:Form)=>({mode:value.mode,currency:value.currency,...(value.mode==="flat"?{flatAmountCents:Number(value.flatAmountCents)}:{}),...(value.mode==="percent"?{percentageBasisPoints:Number(value.percentageBasisPoints)}:{})});
/** Minimal staff configuration. Customer override is intentionally explicit and may be removed to inherit. */
export const ShippingPricingSettingsWorkspace=({organizationId,sessionScope,canConfigure}:{organizationId:string;sessionScope:string;canConfigure:boolean})=>{
  const client=useQueryClient(), key=["v2",sessionScope,organizationId,"settings","shipping-pricing"] as const;
  const [value,setValue]=useState<Form>(empty),[notice,setNotice]=useState("");
  const query=useQuery({queryKey:key,queryFn:()=>shippingPricingApi.getOrganizationPolicy(organizationId),enabled:Boolean(organizationId&&sessionScope&&canConfigure)});
  useEffect(()=>{const policy=query.data?.organizationDefault;if(policy)setValue({mode:policy.mode,currency:policy.currency,flatAmountCents:policy.flatAmountCents===undefined?"":String(policy.flatAmountCents),percentageBasisPoints:policy.percentageBasisPoints===undefined?"":String(policy.percentageBasisPoints)});},[query.data?.organizationDefault?.version]);
  const save=useMutation({mutationFn:()=>shippingPricingApi.saveOrganizationPolicy(organizationId,newBusinessRequestId(),form(value)),onSuccess:data=>{client.setQueryData(key,data);setNotice("Organization shipping pricing policy saved. Existing frozen shipment prices are unchanged.");},onError:error=>setNotice((error as unknown as ApiError).message??"Shipping policy could not be saved.")});
  if(!canConfigure)return <section className="v2-settings-future"><h2>Shipping Pricing</h2><p>You do not have permission to configure shipping pricing.</p></section>;
  return <section className="v2-settings-form"><header><small>SETTINGS · SHIPPING</small><h1>Shipping Pricing</h1><p>Set the organization default used when a customer has no explicit override. Shipment customer prices freeze when staff establishes them; actual carrier cost never reprices a customer.</p></header>
    <label>Default policy <select value={value.mode} onChange={event=>setValue({...value,mode:event.target.value as ShippingPricingMode})}><option value="pass_through">Pass through estimated cost</option><option value="flat">Estimated cost + flat markup</option><option value="percent">Estimated cost + percentage markup</option><option value="no_charge">No charge</option><option value="manual">Manual customer price</option></select></label>
    <label>Currency <input value={value.currency} maxLength={3} onChange={event=>setValue({...value,currency:event.target.value.toUpperCase()})}/></label>
    {value.mode==="flat"&&<label>Flat markup (cents) <input inputMode="numeric" value={value.flatAmountCents} onChange={event=>setValue({...value,flatAmountCents:event.target.value})}/></label>}
    {value.mode==="percent"&&<label>Markup (basis points) <input inputMode="numeric" value={value.percentageBasisPoints} onChange={event=>setValue({...value,percentageBasisPoints:event.target.value})}/></label>}
    <p>Customer-specific overrides are configured from the Customer workspace and can be removed to inherit this default.</p>
    <button type="button" disabled={save.isPending} onClick={()=>save.mutate()}>{save.isPending?"Saving…":"Save shipping policy"}</button>{notice&&<p className={notice.includes("saved")?"notice":"notice error"}>{notice}</p>}
  </section>;
};
