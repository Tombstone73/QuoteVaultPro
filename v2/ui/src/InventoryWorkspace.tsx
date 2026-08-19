import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { inventoryApi, newBusinessRequestId, quoteApi } from "./api";

const organizationFromSession = () => {
  try { return sessionStorage.getItem("ph.v2.organization-id")?.trim() ?? ""; } catch { return ""; }
};
const keys = { bootstrap: (org:string) => ["v2",org,"inventory","bootstrap"] as const, materials: (org:string) => ["v2",org,"inventory","materials"] as const };

/** A deliberately small, Inventory-owned receipt surface. The server remains
 * authoritative for tenant scope, Material unit, movement kind, and balance. */
export const InventoryWorkspace = () => {
  const organizationId = useMemo(organizationFromSession, []);
  const client = useQueryClient();
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const bootstrap = useQuery({ queryKey: keys.bootstrap(organizationId), queryFn: () => quoteApi.bootstrap(organizationId), enabled: Boolean(organizationId), staleTime: 0 });
  const materials = useQuery({ queryKey: keys.materials(organizationId), queryFn: () => inventoryApi.materials(organizationId), enabled: Boolean(organizationId && bootstrap.data?.capabilities.inventoryView) });
  const selected = materials.data?.find((item) => item.materialId === selectedMaterialId) ?? materials.data?.[0];
  const receive = useMutation({ mutationFn: () => inventoryApi.receive(organizationId, selected!.materialId, newBusinessRequestId(), { quantity, reason }), onSuccess: () => { setQuantity(""); setReason(""); void client.invalidateQueries({ queryKey: keys.materials(organizationId) }); } });
  if (!organizationId) return <section className="v2-production"><h1>Inventory</h1><p className="notice error">An authenticated organization is required to load Inventory.</p></section>;
  return <section className="v2-production"><header className="v2-production-page-header"><div><h1>Inventory</h1><p>Receive physical stock through immutable, tenant-scoped Inventory movements.</p></div></header>
    {bootstrap.isLoading && <p className="v2-proof-empty">Restoring authenticated Inventory access…</p>}
    {bootstrap.isSuccess && !bootstrap.data.capabilities.inventoryView && <p className="notice error">You do not have permission to view Inventory.</p>}
    {materials.isError && <p className="notice error">Inventory balances are unavailable in this organization.</p>}
    {materials.data && <><section className="v2-production-overview"><article className="v2-production-overview-table"><header><h2>Material balances</h2></header><div className="v2-production-table-scroll"><table><thead><tr><th>Material</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Unit</th><th /></tr></thead><tbody>{materials.data.map((material) => <tr key={material.materialId}><td><b>{material.materialName}</b><small>{material.materialSku ?? "No SKU"}</small></td><td>{material.onHandQuantity}</td><td>{material.reservedQuantity}</td><td>{material.availableQuantity}</td><td>{material.unit}</td><td><button type="button" onClick={() => setSelectedMaterialId(material.materialId)}>Receive</button></td></tr>)}</tbody></table></div></article>
      <aside className="v2-production-overview-side"><article><header><h2>Receive stock</h2></header>{selected ? <><p><b>{selected.materialName}</b><br /><small>Current on hand {selected.onHandQuantity} {selected.unit}</small></p><label>Quantity to add<input aria-label="Inventory quantity to add" value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="decimal" /></label><label>Reason<input aria-label="Inventory receipt reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Vendor delivery" /></label><button type="button" disabled={!bootstrap.data?.capabilities.inventoryReceive || !quantity || reason.trim().length < 3 || receive.isPending} onClick={() => receive.mutate()}>{receive.isPending ? "Receiving…" : `Receive ${selected.unit}`}</button>{receive.isSuccess && <p className="notice success">Receipt recorded. Balance refreshed from Inventory.</p>}{receive.isError && <p className="notice error">{(receive.error as {message?:string}).message ?? "Inventory receipt failed."}</p>}</> : <p>No active Materials are available.</p>}</article></aside></section></>}
  </section>;
};
