import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { MaterialFamilyVariantEditor } from "@/components/MaterialFamilyVariantEditor";
import { MaterialForm } from "@/components/MaterialForm";
import { ContentLayout, DataCard, Page, PageHeader, StatusPill, TitanTable, TitanTableBody, TitanTableCell, TitanTableContainer, TitanTableHead, TitanTableHeader, TitanTableRow } from "@/components/titan";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useActiveOrganizationRole } from "@/hooks/useActiveOrganizationRole";
import { useMaterial, useMaterialFamily, type MaterialFamily } from "@/hooks/useMaterials";
import { useVendors } from "@/hooks/useVendors";
import { materialDimensionKey } from "@/lib/materialFamilyControls";

type FamilyAction = "add" | "edit" | "dimensions" | "status";
type FamilyRequest = { method: "POST" | "PATCH" | "DELETE"; suffix?: string; body?: Record<string, unknown> };

const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });
const price = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 4 });

function displayNumber(value: string | number | null | undefined, formatter = number) {
  if (value == null || !String(value).trim()) return "—";
  return Number.isFinite(Number(value)) ? formatter.format(Number(value)) : "—";
}

function displayUnit(value: string | null | undefined) {
  return value?.replaceAll("_", " ") ?? "";
}

function useFamilyChange(familyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ method, suffix = "", body }: FamilyRequest) => {
      const response = await fetch(`/api/material-families/${encodeURIComponent(familyId)}${suffix}`, {
        method,
        credentials: "include",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || result?.message || "Could not update the material family. Try again.");
      }
    },
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ["/api/material-families"] }),
      queryClient.invalidateQueries({ queryKey: ["/api/materials"] }),
    ]),
  });
}

function FamilySettingsDialog({ family, statusOnly, onClose }: { family: MaterialFamily; statusOnly: boolean; onClose: () => void }) {
  const [name, setName] = useState(family.name);
  const [description, setDescription] = useState(family.description ?? "");
  const change = useFamilyChange(family.id);
  const action = family.isActive ? "Deactivate family" : "Reactivate family";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!statusOnly && !name.trim()) return;
    change.mutate({ method: "PATCH", body: statusOnly ? { isActive: !family.isActive } : { name: name.trim(), description: description.trim() || null } }, { onSuccess: onClose });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !change.isPending) onClose(); }}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{statusOnly ? action : "Edit family"}</DialogTitle>
          <DialogDescription>{statusOnly ? (
            family.isActive ? "Deactivation prevents new variants and assignments. Existing variants retain their inventory and history." : "Reactivation allows new variants and assignments."
          ) : "Update the family name and description."}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={submit}>
          {!statusOnly && <>
            <label className="block space-y-1 text-sm"><span>Family name</span><Input required maxLength={255} value={name} onChange={(event) => setName(event.target.value)} /></label>
            <label className="block space-y-1 text-sm"><span>Description</span><Textarea maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
          </>}
          {change.error && <p role="alert" className="text-sm text-destructive">{change.error.message}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={change.isPending}>Cancel</Button>
            <Button type="submit" disabled={change.isPending || (!statusOnly && !name.trim())}>{statusOnly ? action : "Save family"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FamilyDimensionsDialog({ family, onClose }: { family: MaterialFamily; onClose: () => void }) {
  const [names, setNames] = useState<Record<string, string>>({});
  const [newDimension, setNewDimension] = useState("");
  const [error, setError] = useState("");
  const change = useFamilyChange(family.id);

  function addDimension(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = newDimension.trim();
    const key = materialDimensionKey(displayName);
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(key)) {
      setError("Enter a dimension name that begins with a letter.");
      return;
    }
    setError("");
    const sortOrder = Math.max(-1, ...family.dimensions.map((dimension) => dimension.sortOrder)) + 1;
    change.mutate({ method: "POST", suffix: "/dimensions", body: { key, displayName, sortOrder } }, { onSuccess: () => setNewDimension("") });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !change.isPending) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-[calc(100%-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Family dimensions</DialogTitle>
          <DialogDescription>Manage the attributes that distinguish variants, such as color or pack size.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {family.dimensions.map((dimension) => {
            const value = names[dimension.id] ?? dimension.displayName;
            const suffix = `/dimensions/${encodeURIComponent(dimension.id)}`;
            return (
              <form key={dimension.id} className="flex flex-wrap items-center gap-2" onSubmit={(event) => {
                event.preventDefault();
                if (value.trim() && value.trim() !== dimension.displayName) {
                  setError("");
                  change.mutate({ method: "PATCH", suffix, body: { displayName: value.trim() } });
                }
              }}>
                <Input className="min-w-28 flex-1" aria-label={`Rename ${dimension.displayName}`} maxLength={100} value={value} onChange={(event) => setNames({ ...names, [dimension.id]: event.target.value })} />
                <Button type="submit" size="sm" variant="outline" disabled={change.isPending || !value.trim() || value.trim() === dimension.displayName}>Rename</Button>
                <Button type="button" size="sm" variant="ghost" disabled={change.isPending} aria-label={`Remove ${dimension.displayName}`} onClick={() => {
                  if (window.confirm(`Remove ${dimension.displayName}? Existing variant values prevent removal.`)) {
                    setError("");
                    change.mutate({ method: "DELETE", suffix });
                  }
                }}>Remove</Button>
              </form>
            );
          })}
        </div>
        <form className="flex flex-wrap items-center gap-2" onSubmit={addDimension}>
          <Input className="min-w-28 flex-1" aria-label="New dimension" placeholder="New dimension" maxLength={100} value={newDimension} onChange={(event) => setNewDimension(event.target.value)} />
          <Button type="submit" size="sm" disabled={change.isPending || !newDimension.trim()}>Add dimension</Button>
        </form>
        {(error || change.error) && <p role="alert" className="text-sm text-destructive">{error || change.error?.message}</p>}
        <DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={change.isPending}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditVariantDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const variant = useMaterial(id);
  if (variant.data) return <MaterialForm open material={variant.data} onOpenChange={(open) => {
    if (!open) {
      void queryClient.invalidateQueries({ queryKey: ["/api/material-families"] });
      onClose();
    }
  }} />;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-[calc(100%-2rem)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit variant</DialogTitle>
          <DialogDescription>{variant.isLoading ? "Loading material…" : "Could not load the material details."}</DialogDescription>
        </DialogHeader>
        {variant.isError && <Button type="button" variant="outline" onClick={() => void variant.refetch()}>Retry</Button>}
      </DialogContent>
    </Dialog>
  );
}

export default function MaterialFamilyDetailPage() {
  const { familyId } = useParams<{ familyId: string }>();
  return <MaterialFamilyDetail key={familyId} familyId={familyId} />;
}

function MaterialFamilyDetail({ familyId }: { familyId?: string }) {
  const familyQuery = useMaterialFamily(familyId);
  const { isAdminOrOwner } = useActiveOrganizationRole();
  const { data: vendors = [] } = useVendors();
  const [action, setAction] = useState<FamilyAction>();
  const [editVariantId, setEditVariantId] = useState<string>();
  const family = familyQuery.data;
  const back = <Button variant="ghost" size="sm" asChild><Link to="/materials"><ArrowLeft className="mr-1.5 h-4 w-4" /> Materials</Link></Button>;

  if (!family) return (
    <Page>
      <div className="mb-3">{back}</div>
      <PageHeader title="Material Family" />
      <DataCard>
        {familyQuery.isLoading ? <p role="status">Loading material family…</p> : (
          <div className="space-y-3"><p role="alert">{familyQuery.error?.message || "Material family not found."}</p><Button variant="outline" onClick={() => void familyQuery.refetch()}>Retry</Button></div>
        )}
      </DataCard>
    </Page>
  );

  const classifications = [...new Set(family.variants.map((variant) => displayUnit(variant.materialForm ?? variant.type)).filter(Boolean))];
  const vendorNames = new Map(vendors.map((vendor) => [vendor.id, vendor.name]));
  const closeAction = () => setAction(undefined);

  return (
    <Page>
      <div className="mb-3">{back}</div>
      <PageHeader title={family.name} subtitle="Material Family" className="flex-wrap gap-3 break-words" actions={isAdminOrOwner ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setAction("edit")}>Edit Family</Button>
          <Button variant="outline" onClick={() => setAction("status")}>{family.isActive ? "Deactivate Family" : "Reactivate Family"}</Button>
          <Button disabled={!family.isActive} onClick={() => setAction("add")}><Plus className="mr-1.5 h-4 w-4" /> Add Variant</Button>
        </div>
      ) : undefined} />
      <ContentLayout>
        <DataCard>
          {family.description && <p className="mb-4 whitespace-pre-wrap break-words text-titan-sm text-titan-text-primary">{family.description}</p>}
          <dl className="grid grid-cols-2 gap-4 text-titan-sm md:grid-cols-4">
            <div><dt className="mb-1 text-titan-text-muted">Variants</dt><dd className="font-medium tabular-nums">{family.variants.length}</dd></div>
            <div><dt className="mb-1 text-titan-text-muted">Classification</dt><dd className="capitalize">{classifications.join(", ") || "—"}</dd></div>
            <div><dt className="mb-1 text-titan-text-muted">Dimensions</dt><dd className="flex flex-wrap items-center gap-2">{family.dimensions.map((dimension) => dimension.displayName).join(", ") || "—"}{isAdminOrOwner && <Button type="button" size="sm" variant="link" className="h-auto px-0" onClick={() => setAction("dimensions")}>Manage dimensions</Button>}</dd></div>
            <div><dt className="mb-1 text-titan-text-muted">Status</dt><dd><StatusPill variant={family.isActive ? "success" : "muted"}>{family.isActive ? "Active" : "Inactive"}</StatusPill></dd></div>
          </dl>
        </DataCard>
        <section aria-labelledby="family-variants-heading" className="min-w-0">
          <h2 id="family-variants-heading" className="mb-3 text-titan-md font-semibold text-titan-text-primary">Variants</h2>
          {family.variants.length === 0 ? <DataCard><p className="text-titan-sm text-titan-text-muted">No variants yet.</p></DataCard> : (
            <TitanTableContainer>
              <TitanTable aria-labelledby="family-variants-heading" className="min-w-[52rem]">
                <TitanTableHeader><tr>
                  <TitanTableHead scope="col">Material</TitanTableHead><TitanTableHead scope="col">Stock</TitanTableHead><TitanTableHead scope="col">Reorder point</TitanTableHead><TitanTableHead scope="col">Vendor / SKU</TitanTableHead><TitanTableHead scope="col">Purchase cost</TitanTableHead><TitanTableHead scope="col">Status</TitanTableHead>
                </tr></TitanTableHeader>
                <TitanTableBody>
                  {family.variants.map((variant) => {
                    const dimensions = new Map(variant.variantValues?.map((value) => [value.dimensionId, value.value]));
                    const summary = family.dimensions.filter((dimension) => dimensions.has(dimension.id)).map((dimension) => `${dimension.displayName}: ${dimensions.get(dimension.id)}`).join(" · ");
                    const unit = displayUnit(variant.inventoryUnit);
                    const vendorName = variant.preferredVendorName || vendorNames.get(variant.preferredVendorId ?? "");
                    return (
                      <TitanTableRow key={variant.id}>
                        <TitanTableCell className="min-w-48">
                          <Link className="break-words font-medium text-titan-accent hover:underline focus-visible:underline" to={`/materials/${encodeURIComponent(variant.id)}`}>{variant.name}</Link>
                          <div className="break-words text-xs text-titan-text-muted">{variant.sku}</div>
                          {summary && <div className="break-words text-xs text-titan-text-muted">{summary}</div>}
                          {isAdminOrOwner && <Button type="button" size="sm" variant="link" className="h-auto px-0" aria-label={`Edit variant ${variant.name}`} onClick={() => setEditVariantId(variant.id)}>Edit variant</Button>}
                        </TitanTableCell>
                        <TitanTableCell className="whitespace-nowrap tabular-nums">{displayNumber(variant.stockQuantity)} {unit}</TitanTableCell>
                        <TitanTableCell className="whitespace-nowrap tabular-nums">{displayNumber(variant.minStockAlert)} {unit}</TitanTableCell>
                        <TitanTableCell>{vendorName || "—"}{variant.vendorSku && <div className="text-xs text-titan-text-muted">{variant.vendorSku}</div>}</TitanTableCell>
                        <TitanTableCell className="whitespace-nowrap tabular-nums">{displayNumber(variant.vendorCostPerUnit, price)}{variant.vendorCostPerUnit != null && variant.vendorCostUnit && <div className="text-xs text-titan-text-muted">per {displayUnit(variant.vendorCostUnit)}</div>}</TitanTableCell>
                        <TitanTableCell><StatusPill variant={variant.isActive ? "success" : "muted"}>{variant.isActive ? "Active" : "Inactive"}</StatusPill></TitanTableCell>
                      </TitanTableRow>
                    );
                  })}
                </TitanTableBody>
              </TitanTable>
            </TitanTableContainer>
          )}
        </section>
      </ContentLayout>
      {action === "add" && <MaterialFamilyVariantEditor family={family} onFinish={closeAction} />}
      {(action === "edit" || action === "status") && <FamilySettingsDialog family={family} statusOnly={action === "status"} onClose={closeAction} />}
      {action === "dimensions" && <FamilyDimensionsDialog family={family} onClose={closeAction} />}
      {editVariantId && <EditVariantDialog key={editVariantId} id={editVariantId} onClose={() => setEditVariantId(undefined)} />}
    </Page>
  );
}
