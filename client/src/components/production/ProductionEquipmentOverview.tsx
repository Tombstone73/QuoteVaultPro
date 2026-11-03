import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { describeProductionMachineConfiguration } from "@shared/productionMachineOptions";
import { materialDimensionConfiguration } from "@shared/materialConfigurationReadiness";
import { useMaterials } from "@/hooks/useMaterials";
import { apiFetch } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type EquipmentPreferences = { production?: { printerOptionsByStation?: unknown } };

function MaterialDimensionsOverview() {
  const materials = useMaterials();
  const [search, setSearch] = useState("");
  const media = (materials.data ?? []).filter(material => ["roll", "sheet"].includes(materialDimensionConfiguration(material).form));
  const incomplete = media.filter(material => materialDimensionConfiguration(material).issues.length > 0);
  const visible = media.filter(material => `${material.name} ${material.sku}`.toLowerCase().includes(search.trim().toLowerCase()));
  if (materials.isLoading) return <p role="status">Loading material configuration…</p>;
  if (materials.isError) return <div role="alert">Material configuration could not be loaded. <Button variant="outline" size="sm" onClick={() => void materials.refetch()}>Retry material read</Button></div>;
  return <div className="space-y-3">
    <p>{media.length} roll/sheet records · {incomplete.length} need dimension review. Machine and ink compatibility has not been recorded.</p>
    <Input aria-label="Filter media configuration" placeholder="Filter by material name or SKU…" value={search} onChange={event => setSearch(event.target.value)}/>
    <div className="max-h-64 overflow-auto rounded border border-border">
      <table className="w-full text-left text-xs"><thead className="sticky top-0 bg-background"><tr><th className="p-2">Material / SKU</th><th className="p-2">Recorded media size</th><th className="p-2">Recorded stock / status</th><th className="p-2">Configuration review</th></tr></thead>
        <tbody>{visible.map(material => {
          const { form, issues } = materialDimensionConfiguration(material);
          return <tr key={material.id} className="border-t border-border align-top">
            <td className="p-2"><Link className="font-medium underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" to={`/materials/${encodeURIComponent(material.id)}`}>{material.name}</Link><div>{material.sku}</div></td>
            <td className="p-2">{material.width || "Unknown"}{form === "sheet" ? ` × ${material.height || "Unknown"}` : ' wide'} in
              {form === "roll" && <div>Edge waste: {material.edgeWasteInPerSide ?? "not recorded"} in/side</div>}
              {material.thickness && <div>Thickness: {material.thickness} {material.thicknessUnit || "(unit missing)"}</div>}
            </td>
            <td className="p-2">{material.stockQuantity} {material.inventoryUnit}<div>{material.isActive ? "Active material" : "Inactive material"}</div></td>
            <td className="p-2">{issues.length ? <ul className="list-inside list-disc text-red-700 dark:text-red-300">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : "Media dimensions recorded; printer compatibility unverified"}</td>
          </tr>;
        })}</tbody>
      </table>
      {!visible.length && <p className="p-3">No matching roll or sheet materials.</p>}
    </div>
  </div>;
}

/** Reads canonical settings and inventory only. Never writes equipment or job assignments. */
export function ProductionEquipmentOverview() {
  const preferences = useQuery<EquipmentPreferences>({
    queryKey: ["/api/organization/preferences"],
    queryFn: async () => {
      const response = await apiFetch("/api/organization/preferences");
      if (!response.ok) throw new Error("Production configuration could not be read.");
      return response.json();
    },
  });
  const [showMaterials, setShowMaterials] = useState(false);
  const rows = describeProductionMachineConfiguration(preferences.data?.production?.printerOptionsByStation);
  return <section className="space-y-3 rounded-lg border border-border bg-card p-4 text-sm text-card-foreground" aria-labelledby="production-equipment-heading">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div><h2 id="production-equipment-heading" className="font-semibold">Production machine configuration</h2>
        <p className="mt-1 text-muted-foreground">Saved assignment labels are separate from the document print queues below.</p></div>
      <Link className="underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" to="/settings/production">Production workflow settings</Link>
    </div>
    {preferences.isLoading ? <p role="status">Loading machine configuration…</p> : preferences.isError ? <div role="alert">Machine configuration could not be loaded. No equipment inventory has been verified. <Button variant="outline" size="sm" onClick={() => void preferences.refetch()}>Retry configuration read</Button></div> : <>
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-border"><th className="p-2">Station key</th><th className="p-2">Machine choices</th><th className="p-2">Configuration source</th></tr></thead><tbody>
        {rows.map(row => <tr key={row.stationKey} className="border-b border-border align-top"><th scope="row" className="p-2 font-medium">{row.stationKey}</th>
          <td className="p-2">{row.machines.length ? <ul className="space-y-1">{row.machines.map(name => <li key={name} className="break-words">{name}</li>)}</ul> : "No configured choices"}</td>
          <td className="p-2">{row.source === "configured" ? "Saved organization labels" : row.source === "invalid" ? "Invalid saved configuration" : "Legacy defaults — equipment unverified"}
            {row.issues.map(issue => <p key={issue} className="mt-1 text-red-700 dark:text-red-300">{issue}</p>)}
          </td></tr>)}
      </tbody></table></div>
      <p className="text-muted-foreground">These labels do not establish installed equipment or active status. Printer media limits, white ink, multilayer modes, print speeds, and finishing compatibility are not structured in this configuration. Verify them with an operator before planning work.</p>
    </>}
    <details onToggle={event => setShowMaterials(event.currentTarget.open)}>
      <summary className="cursor-pointer rounded py-1 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">Material dimensions and configuration gaps</summary>
      <p className="my-2 text-muted-foreground">Inventory width and sheet size describe the media, not a printer's supported limits. No machine compatibility or routing recommendation is inferred.</p>
      {showMaterials && <MaterialDimensionsOverview/>}
    </details>
  </section>;
}
