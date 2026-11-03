import { useEffect, useRef, useState } from 'react';
import { apiCall, toFulfillmentError } from '@/hooks/useFulfillment';
import { customerShippingAddressFromParty, type ShipmentCustomerAddressTarget } from '@shared/fulfillmentCustomerAddress';
import type { ShippingParty } from '@shared/shippingDocuments';

type Props = {
  shipmentId: string;
  blindShipping: boolean;
  destination: ShippingParty;
  prepareShipment: () => Promise<{updatedAt:string;destination:ShippingParty}>;
};

/** Profile updates are explicit; shipment autosave never writes a Customer. */
export function SaveCustomerShippingAddress({shipmentId,blindShipping,destination,prepareShipment}:Props) {
  const [target,setTarget] = useState<ShipmentCustomerAddressTarget|null>(null);
  const [loadError,setLoadError] = useState<string|null>(null);
  const [checked,setChecked] = useState(false);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState<{error:boolean;text:string}|null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const loadEpoch = useRef(0);
  const destinationKey = JSON.stringify(customerShippingAddressFromParty(destination));
  const currentDestinationKey = useRef(destinationKey);
  currentDestinationKey.current = destinationKey;
  const endpoint = `/api/fulfillment/shipments/${shipmentId}/customer-shipping-address`;
  const loadTarget = async () => {
    const epoch = ++loadEpoch.current;
    setChecked(false); setLoadError(null); setTarget(null);
    try {
      const result = await apiCall<ShipmentCustomerAddressTarget>(endpoint);
      if (mounted.current && epoch === loadEpoch.current) setTarget(result);
    } catch(error) { if (mounted.current && epoch === loadEpoch.current) setLoadError(toFulfillmentError(error).message); }
  };
  useEffect(()=>{
    mounted.current = true;
    void loadTarget();
    return ()=>{mounted.current=false;loadEpoch.current++;};
  },[shipmentId]);
  useEffect(()=>{if(blindShipping)setChecked(false);},[blindShipping]);
  useEffect(()=>{setMessage(null);},[destinationKey]);
  const save = async () => {
    if (inFlight.current) return;
    inFlight.current=true; setBusy(true); setMessage(null);
    let shipmentSaved=false;
    try {
      const saveProfile = checked && !blindShipping;
      const reviewedTarget = target;
      const saved = await prepareShipment();
      shipmentSaved=true;
      if (!saveProfile) {
        setMessage({error:false,text:'Shipment address saved. Customer profile unchanged.'});
        return;
      }
      if (!reviewedTarget) throw new Error('Review the customer profile before saving its address.');
      const updated = await apiCall<ShipmentCustomerAddressTarget>(endpoint,{method:'POST',body:JSON.stringify({
        customerId:reviewedTarget.customerId,expectedCustomerUpdatedAt:reviewedTarget.updatedAt,expectedShipmentUpdatedAt:saved.updatedAt,
      })});
      if (updated.customerId !== reviewedTarget.customerId || JSON.stringify(updated.address) !== JSON.stringify(customerShippingAddressFromParty(saved.destination))) {
        throw new Error('Customer address readback could not be confirmed. Review the customer profile before retrying.');
      }
      if (mounted.current) {
        setTarget(updated); setChecked(false);
        setMessage({error:false,text:currentDestinationKey.current === JSON.stringify(updated.address)
          ? `Saved the shipment address and ${updated.companyName}'s default shipping address. Historical Orders and Shipments were not changed.`
          : `The earlier confirmed address was saved to ${updated.companyName}'s profile. Newer destination edits have not updated the profile.`});
      }
    } catch(error) {
      if (mounted.current) setMessage({error:true,text:shipmentSaved
        ? `Shipment address saved. Customer profile update was not confirmed: ${toFulfillmentError(error).message}`
        : `Shipment save was not confirmed. Customer profile unchanged: ${toFulfillmentError(error).message}`});
    } finally {inFlight.current=false;if(mounted.current)setBusy(false);}
  };
  return <div className="mt-3 space-y-2 rounded border bg-muted/20 p-3 text-sm">
    <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={checked} disabled={busy || blindShipping || !target}
      onChange={event=>setChecked(event.target.checked)}/>Also save to customer profile</label>
    <p className="text-xs text-muted-foreground">{blindShipping
      ? 'Blind-shipping destinations stay shipment-only. Change a permanent default from the Customer page.'
      : target ? `Updates ${target.companyName}'s default shipping address for future orders. Leave unchecked for a one-time or drop-shipping destination.`
        : loadError ?? 'Loading customer address permission and current profile…'}</p>
    {target && !blindShipping && <p className="break-words text-xs text-muted-foreground">Current customer default: {Object.values(target.address).filter(Boolean).join(', ') || target.legacyAddress || 'No saved shipping address'}</p>}
    {checked && !busy && <p className="text-xs" role="status">Customer profile update is not yet confirmed. Click Save shipping address to submit this change.</p>}
    <div className="flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={()=>void save()} className="rounded border px-3 py-1.5 text-xs font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">{busy?'Saving address…':'Save shipping address'}</button>
      {!blindShipping && <button type="button" disabled={busy} onClick={()=>void loadTarget()} className="rounded border px-3 py-1.5 text-xs hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">Review latest customer address</button>}
    </div>
    {message && <p role={message.error?'alert':'status'} className={message.error?'break-words text-destructive':'break-words'}>{message.text}</p>}
  </div>;
}
