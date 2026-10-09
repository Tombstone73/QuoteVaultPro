import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Droplets, Pencil, Plus, Trash2 } from "lucide-react";
import { Page, PageHeader, ContentLayout } from "@/components/titan";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useActiveOrganizationRole } from "@/hooks/useActiveOrganizationRole";
import { apiFetch } from "@/lib/queryClient";
import {
  INK_COLORS,
  calculateInkJob,
  inkMasterPrinterInputSchema,
  parseInkMasterForm,
  specFromDraft,
  validateInkMasterPrinterSettings,
  type InkColor,
  type InkMasterPrinter,
  type InkMasterPrinterInput,
  type InkMasterSavedSpec,
  type InkQuantities,
  type PrintSides,
} from "@shared/inkMaster";

const apiBase = "/api/mini-apps/ink-master";
const colors: Record<InkColor, { label: string; swatch: string }> = {
  cyan: { label: "Cyan", swatch: "bg-cyan-500" },
  magenta: { label: "Magenta", swatch: "bg-fuchsia-500" },
  yellow: { label: "Yellow", swatch: "bg-yellow-400" },
  black: { label: "Black", swatch: "bg-neutral-900 border border-neutral-500" },
  white: { label: "White", swatch: "bg-white border border-border" },
};
const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 });
const zeroInputs = (): Record<InkColor, string> => ({ cyan: "0", magenta: "0", yellow: "0", black: "0", white: "0" });
const numericInputs = (values: InkQuantities): Record<InkColor, string> => ({
  cyan: String(values.cyan), magenta: String(values.magenta), yellow: String(values.yellow),
  black: String(values.black), white: String(values.white),
});
const blankInputs = (): Record<InkColor, string> => ({ cyan: "", magenta: "", yellow: "", black: "", white: "" });

async function request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await apiFetch(`${apiBase}${path}`, {
    method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({})) as { success?: boolean; data?: T; error?: string; message?: string };
  if (!response.ok || !payload.success || payload.data === undefined) {
    throw new Error(payload.error || payload.message || "Ink Master request failed");
  }
  return payload.data;
}

type PrinterForm = { name: string; size: string; price: string; target: string };
const blankPrinterForm = (): PrinterForm => ({ name: "", size: "1", price: "", target: "0" });
const formFromPrinter = (printer: InkMasterPrinter): PrinterForm => ({
  name: printer.name,
  size: String(printer.containerSizeLiters),
  price: printer.containerPriceCents === null ? "" : String(printer.containerPriceCents / 100),
  target: String(printer.restockTargetLiters),
});

function ColorLabel({ color, compact = false }: { color: InkColor; compact?: boolean }) {
  return <span className={`inline-flex items-center ${compact ? "gap-1" : "gap-2"}`}><span className={`${compact ? "h-2 w-2" : "h-3 w-3"} shrink-0 rounded-full ${colors[color].swatch}`} />{colors[color].label}</span>;
}

export default function InkMasterPage() {
  const { activeOrgId, isLoading: orgLoading } = useActiveOrganizationRole();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [printerId, setPrinterId] = useState("");
  const [printSides, setPrintSides] = useState<PrintSides>("single");
  const [sheetCountInput, setSheetCountInput] = useState("");
  const [usageInputs, setUsageInputs] = useState(zeroInputs);
  const [inventoryInputs, setInventoryInputs] = useState(blankInputs);
  const [specName, setSpecName] = useState("");
  const [loadedSpecId, setLoadedSpecId] = useState<string | null>(null);
  const [selectedSpecId, setSelectedSpecId] = useState("");
  const [printerDialogOpen, setPrinterDialogOpen] = useState(false);
  const [editingPrinterId, setEditingPrinterId] = useState<string | null>(null);
  const [printerForm, setPrinterForm] = useState<PrinterForm>(blankPrinterForm);
  const [confirmAction, setConfirmAction] = useState<{ kind: "printer" | "spec"; id: string; name: string } | null>(null);

  const printersQuery = useQuery({
    queryKey: [apiBase, "printers", activeOrgId],
    queryFn: () => request<InkMasterPrinter[]>("/printers"),
    enabled: Boolean(activeOrgId),
  });
  const specsQuery = useQuery({
    queryKey: [apiBase, "specs", activeOrgId],
    queryFn: () => request<InkMasterSavedSpec[]>("/specs"),
    enabled: Boolean(activeOrgId),
  });
  const printers = printersQuery.data ?? [];
  const specs = specsQuery.data ?? [];
  const selectedPrinter = printers.find((printer) => printer.id === printerId);
  const activePrinters = printers.filter((printer) => printer.isActive);

  // A change of organization must not carry manual quantities into another tenant.
  useEffect(() => {
    setPrinterId("");
    setPrintSides("single");
    setSheetCountInput("");
    setUsageInputs(zeroInputs());
    setInventoryInputs(blankInputs());
    setLoadedSpecId(null);
    setSelectedSpecId("");
    setSpecName("");
  }, [activeOrgId]);

  useEffect(() => {
    if (!printerId && activePrinters.length > 0) setPrinterId(activePrinters[0].id);
  }, [printerId, activePrinters]);

  const form = useMemo(() => parseInkMasterForm({ sheetCount: sheetCountInput, usage: usageInputs, inventory: inventoryInputs }, printerId, printSides), [sheetCountInput, usageInputs, inventoryInputs, printerId, printSides]);
  const profileForm = useMemo(() => parseInkMasterForm({ sheetCount: "", usage: usageInputs, inventory: zeroInputs() }, printerId, printSides), [usageInputs, printerId, printSides]);
  const printerError = selectedPrinter ? validateInkMasterPrinterSettings(selectedPrinter) : null;
  const calculation = useMemo(() => {
    if (!selectedPrinter || printerError || !form.draft) return { result: null, error: null };
    try { return { result: calculateInkJob(form.draft, selectedPrinter), error: null }; }
    catch (error) { return { result: null, error: error instanceof Error ? error.message : "Could not calculate this job." }; }
  }, [form, selectedPrinter, printerError]);
  const result = calculation.result;
  const selectedSpec = specs.find((spec) => spec.id === selectedSpecId);

  const invalidatePrinters = () => queryClient.invalidateQueries({ queryKey: [apiBase, "printers", activeOrgId] });
  const invalidateSpecs = () => queryClient.invalidateQueries({ queryKey: [apiBase, "specs", activeOrgId] });
  const savePrinter = useMutation({
    mutationFn: ({ id, input }: { id: string | null; input: InkMasterPrinterInput }) =>
      request<InkMasterPrinter>(id ? `/printers/${id}` : "/printers", id ? "PATCH" : "POST", input),
    onSuccess: (printer) => {
      invalidatePrinters();
      setPrinterId(printer.id);
      setPrinterDialogOpen(false);
      toast({ title: "Printer settings saved" });
    },
    onError: (error: Error) => toast({ title: "Could not save printer", description: error.message, variant: "destructive" }),
  });
  const deactivatePrinter = useMutation({
    mutationFn: (id: string) => request<InkMasterPrinter>(`/printers/${id}`, "DELETE"),
    onSuccess: (printer) => {
      invalidatePrinters();
      if (printerId === printer.id) setPrinterId("");
      setConfirmAction(null);
      toast({ title: "Printer deactivated", description: "Saved job specs remain available." });
    },
    onError: (error: Error) => toast({ title: "Could not deactivate printer", description: error.message, variant: "destructive" }),
  });
  const activatePrinter = useMutation({
    mutationFn: (id: string) => request<InkMasterPrinter>(`/printers/${id}/activate`, "POST"),
    onSuccess: () => { invalidatePrinters(); toast({ title: "Printer activated" }); },
    onError: (error: Error) => toast({ title: "Could not activate printer", description: error.message, variant: "destructive" }),
  });
  const saveSpec = useMutation({
    mutationFn: ({ id, name }: { id: string | null; name: string }) =>
      request<InkMasterSavedSpec>(id ? `/specs/${id}` : "/specs", id ? "PATCH" : "POST", specFromDraft(name, profileForm.draft!)),
    onSuccess: (spec) => {
      invalidateSpecs();
      setLoadedSpecId(spec.id);
      setSelectedSpecId(spec.id);
      setSpecName(spec.name);
      toast({ title: "Job spec saved" });
    },
    onError: (error: Error) => toast({ title: "Could not save job spec", description: error.message, variant: "destructive" }),
  });
  const deleteSpec = useMutation({
    mutationFn: (id: string) => request<{ deleted: boolean }>(`/specs/${id}`, "DELETE"),
    onSuccess: (_, id) => {
      invalidateSpecs();
      if (loadedSpecId === id) setLoadedSpecId(null);
      if (selectedSpecId === id) setSelectedSpecId("");
      setConfirmAction(null);
      toast({ title: "Job spec deleted" });
    },
    onError: (error: Error) => toast({ title: "Could not delete job spec", description: error.message, variant: "destructive" }),
  });

  function openPrinterDialog(printer?: InkMasterPrinter) {
    setEditingPrinterId(printer?.id ?? null);
    setPrinterForm(printer ? formFromPrinter(printer) : blankPrinterForm());
    setPrinterDialogOpen(true);
  }

  function submitPrinter() {
    const dollars = printerForm.price.trim() === "" ? null : Number(printerForm.price);
    const cents = dollars === null ? null : Math.round(dollars * 100);
    if (dollars !== null && (!Number.isFinite(dollars) || dollars < 0 || Math.abs(Math.round(dollars * 100) / 100 - dollars) > 1e-9)) {
      toast({ title: "Enter a valid price with at most two decimal places", variant: "destructive" });
      return;
    }
    const parsed = inkMasterPrinterInputSchema.safeParse({
      name: printerForm.name,
      containerSizeLiters: Number(printerForm.size),
      containerPriceCents: cents,
      restockTargetLiters: Number(printerForm.target),
    });
    if (!parsed.success) {
      toast({ title: "Check printer settings", description: "Name and container size are required; price and target cannot be negative.", variant: "destructive" });
      return;
    }
    savePrinter.mutate({ id: editingPrinterId, input: parsed.data });
  }

  function loadSpec(spec: InkMasterSavedSpec) {
    setPrinterId(spec.printerId);
    setPrintSides(spec.printSides);
    setUsageInputs(numericInputs(spec.usageMlPerSheetSide));
    setSpecName(spec.name);
    setLoadedSpecId(spec.id);
    setSelectedSpecId(spec.id);
    toast({ title: "Job spec loaded" });
  }

  function changeColorInput(kind: "usage" | "inventory", color: InkColor, value: string) {
    const setter = kind === "usage" ? setUsageInputs : setInventoryInputs;
    setter((current) => ({ ...current, [color]: value }));
  }

  if (orgLoading) return <Page><PageHeader title="Ink Master" /><ContentLayout>Checking organization access…</ContentLayout></Page>;
  if (!activeOrgId) return <Page><PageHeader title="Ink Master" /><ContentLayout>Select an organization to use Ink Master.</ContentLayout></Page>;

  return <Page>
    <PageHeader title="Ink Master" subtitle="Calculate ink requirements and restocking needs for print jobs." className="mb-3" />
    <ContentLayout className="space-y-4">
      <Tabs defaultValue="calculator">
        <TabsList className="h-9"><TabsTrigger value="calculator">Calculator</TabsTrigger><TabsTrigger value="settings">Settings</TabsTrigger></TabsList>
        <TabsContent value="calculator" className="mt-3">
          {(printersQuery.isLoading || specsQuery.isLoading) && <p className="text-sm text-muted-foreground">Loading Ink Master…</p>}
          {(printersQuery.isError || specsQuery.isError) && <Card className="mb-3"><CardContent className="flex items-center justify-between gap-3 p-3"><span className="text-sm text-destructive">{printersQuery.error?.message || specsQuery.error?.message || "Could not load Ink Master"}</span><Button size="sm" variant="outline" onClick={() => { printersQuery.refetch(); specsQuery.refetch(); }}>Retry</Button></CardContent></Card>}
          {!printersQuery.isError && !specsQuery.isError && <div className="grid min-w-0 items-start gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <div className="min-w-0 space-y-3">
              <Card><CardHeader className="p-3 pb-2"><CardTitle className="text-sm">Job Configuration</CardTitle></CardHeader><CardContent className="grid gap-2 p-3 pt-0 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.7fr)]">
                <div className="min-w-0"><Label htmlFor="ink-printer" className="text-xs">Printer</Label><Select value={printerId || undefined} onValueChange={setPrinterId}><SelectTrigger id="ink-printer" className="h-9"><SelectValue placeholder="Select printer" /></SelectTrigger><SelectContent>{printers.map((printer) => <SelectItem key={printer.id} value={printer.id}>{printer.name}{printer.isActive ? "" : " (inactive)"}</SelectItem>)}</SelectContent></Select></div>
                <div className="min-w-0"><Label htmlFor="ink-sides" className="text-xs">Print type</Label><Select value={printSides} onValueChange={(value: PrintSides) => setPrintSides(value)}><SelectTrigger id="ink-sides" className="h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="single">Single Sided</SelectItem><SelectItem value="double">Double Sided</SelectItem></SelectContent></Select></div>
                <div className="min-w-0"><Label htmlFor="ink-sheets" className="text-xs">Sheets</Label><Input id="ink-sheets" inputMode="numeric" value={sheetCountInput} onChange={(event) => setSheetCountInput(event.target.value)} placeholder="0" className="h-9" aria-invalid={Boolean(form.errors.sheetCount)} aria-describedby={form.errors.sheetCount ? "ink-sheets-error" : undefined} />{form.errors.sheetCount && <p id="ink-sheets-error" className="mt-1 text-[11px] text-destructive">{form.errors.sheetCount}</p>}</div>
              </CardContent></Card>

              <Card><CardHeader className="p-3 pb-2"><CardTitle className="text-sm">Ink Usage Per Sheet Side <span className="font-normal text-muted-foreground">(mL)</span></CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-2 p-3 pt-0 sm:grid-cols-3 lg:grid-cols-5">
                {INK_COLORS.map((color) => <div key={color} className="min-w-0"><Label htmlFor={`ink-usage-${color}`} className="text-xs"><ColorLabel color={color} /></Label><div className="relative"><Input id={`ink-usage-${color}`} inputMode="decimal" value={usageInputs[color]} onChange={(event) => changeColorInput("usage", color, event.target.value)} className="h-9 pr-8" aria-invalid={Boolean(form.errors.usage[color])} aria-describedby={form.errors.usage[color] ? `ink-usage-${color}-error` : undefined} /><span className="pointer-events-none absolute right-2 top-2.5 text-[11px] text-muted-foreground">mL</span></div>{form.errors.usage[color] && <p id={`ink-usage-${color}-error`} className="mt-1 text-[11px] text-destructive">{form.errors.usage[color]}</p>}</div>)}
              </CardContent></Card>

              <Card><CardHeader className="p-3 pb-2"><CardTitle className="text-sm">Saved Job Specs</CardTitle></CardHeader><CardContent className="space-y-2 p-3 pt-0">
                <div className="flex min-w-0 flex-wrap gap-2"><Select value={selectedSpecId || undefined} onValueChange={setSelectedSpecId}><SelectTrigger aria-label="Saved job spec" className="h-9 min-w-[160px] flex-1"><SelectValue placeholder={specs.length ? "Select saved profile" : "No saved profiles"} /></SelectTrigger><SelectContent>{specs.map((spec) => <SelectItem key={spec.id} value={spec.id}>{spec.name}</SelectItem>)}</SelectContent></Select><Button size="sm" variant="outline" disabled={!selectedSpec} onClick={() => selectedSpec && loadSpec(selectedSpec)}>Load</Button><Button size="sm" variant="ghost" disabled={!selectedSpec} aria-label="Delete selected job spec" onClick={() => selectedSpec && setConfirmAction({ kind: "spec", id: selectedSpec.id, name: selectedSpec.name })}><Trash2 className="h-4 w-4" /></Button></div>
                <div className="flex min-w-0 flex-wrap gap-2"><Input aria-label="Job spec name" placeholder="Profile name" value={specName} onChange={(event) => setSpecName(event.target.value)} className="h-9 min-w-[150px] flex-1" /><Button size="sm" disabled={!selectedPrinter?.isActive || !profileForm.draft || saveSpec.isPending || !specName.trim()} onClick={() => saveSpec.mutate({ id: null, name: specName })}>Save New</Button><Button size="sm" variant="outline" disabled={!loadedSpecId || !selectedPrinter?.isActive || !profileForm.draft || saveSpec.isPending || !specName.trim()} onClick={() => saveSpec.mutate({ id: loadedSpecId, name: specName })}>Update Loaded</Button></div>
                {Object.keys(form.errors.usage).length > 0 && <p className="text-xs text-destructive">Correct ink usage before saving a profile.</p>}
              </CardContent></Card>

              <Card><CardHeader className="p-3 pb-2"><CardTitle className="text-sm">Current Inventory <span className="font-normal text-muted-foreground">(L · manual for this calculation)</span></CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-2 p-3 pt-0 sm:grid-cols-3 lg:grid-cols-5">
                {INK_COLORS.map((color) => <div key={color} className="min-w-0"><Label htmlFor={`ink-on-hand-${color}`} className="text-xs"><ColorLabel color={color} /></Label><div className="relative"><Input id={`ink-on-hand-${color}`} inputMode="decimal" placeholder="Required" value={inventoryInputs[color]} onChange={(event) => changeColorInput("inventory", color, event.target.value)} className="h-9 pr-6" aria-invalid={Boolean(form.errors.inventory[color])} aria-describedby={form.errors.inventory[color] ? `ink-on-hand-${color}-error` : undefined} /><span className="pointer-events-none absolute right-2 top-2.5 text-[11px] text-muted-foreground">L</span></div>{form.errors.inventory[color] && <p id={`ink-on-hand-${color}-error`} className="mt-1 text-[11px] text-destructive">{form.errors.inventory[color]}</p>}</div>)}
              </CardContent></Card>
            </div>

            <Card className="min-w-0 lg:sticky lg:top-4"><CardHeader className="p-3 pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Droplets className="h-4 w-4" />Job Summary</CardTitle><CardDescription className="text-xs">{selectedPrinter ? `${selectedPrinter.name} · ${sheetCountInput || "0"} sheets · ${printSides === "double" ? "Double Sided" : "Single Sided"}` : "Select a printer to calculate"}</CardDescription></CardHeader><CardContent className="p-3 pt-0">
              {printerError && <p className="text-sm text-destructive" role="alert">{printerError}</p>}
              {calculation.error && <p className="text-sm text-destructive" role="alert">{calculation.error}</p>}
              {!printerError && !calculation.error && !result && <p className="text-xs text-muted-foreground">Enter current inventory for each color and correct any marked job fields to calculate purchasing.</p>}
              {result && <>
                <table className="w-full table-fixed break-words text-left text-[11px] leading-tight sm:text-xs"><thead><tr className="border-b text-muted-foreground"><th className="w-[22%] pb-2 font-medium">Ink</th><th className="w-[21%] pb-2 font-medium">Usage</th><th className="w-[19%] pb-2 font-medium">On Hand</th><th className="w-[21%] pb-2 font-medium">After Job</th><th className="w-[17%] pb-2 text-right font-medium">Order</th></tr></thead><tbody>{result.colors.map((row) => <tr key={row.color} className="border-b last:border-0"><td className="py-2 font-medium"><ColorLabel color={row.color} compact /></td><td className="py-2 tabular-nums">{decimal.format(row.usageMl)}<span className="text-muted-foreground"> mL</span><div className="text-muted-foreground">{decimal.format(row.usageLiters)} L</div></td><td className="py-2 tabular-nums">{decimal.format(row.currentInventoryLiters)} L</td><td className={`py-2 tabular-nums ${row.afterJobLiters < 0 ? "font-semibold text-amber-600 dark:text-amber-400" : ""}`}>{decimal.format(row.afterJobLiters)} L</td><td className="py-2 text-right tabular-nums" title={`${decimal.format(row.purchaseLiters)} L to buy${row.estimatedCostCents === null ? "" : ` · ${money.format(row.estimatedCostCents / 100)}`}`}>{row.containersToOrder}</td></tr>)}</tbody></table>
                <div className="mt-3 space-y-1 rounded-md bg-muted/50 p-2.5 text-xs"><div className="flex justify-between gap-2"><span>Containers to Order</span><strong className="tabular-nums">{result.totalContainersToOrder}</strong></div><div className="flex justify-between gap-2"><span>Estimated Purchase Cost</span><strong className="tabular-nums">{result.totalEstimatedCostCents === null ? "Not configured" : money.format(result.totalEstimatedCostCents / 100)}</strong></div></div>
                <p className="mt-2 text-[11px] text-muted-foreground">{decimal.format(selectedPrinter!.containerSizeLiters)} L containers · {decimal.format(selectedPrinter!.restockTargetLiters)} L post-job target per color</p>
              </>}
            </CardContent></Card>
          </div>}
        </TabsContent>

        <TabsContent value="settings" className="mt-4 space-y-4"><div className="flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">Printer settings are shared with staff in this organization.</p><Button size="sm" onClick={() => openPrinterDialog()}><Plus className="mr-1 h-4 w-4" />Add Printer</Button></div>
          {printersQuery.isLoading && <p className="text-sm text-muted-foreground">Loading printers…</p>}
          {printersQuery.isError && <div className="flex items-center gap-3 text-sm text-destructive">{printersQuery.error.message}<Button size="sm" variant="outline" onClick={() => printersQuery.refetch()}>Retry</Button></div>}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{printers.map((printer) => <Card key={printer.id}><CardHeader className="pb-2"><div className="flex items-start justify-between gap-2"><CardTitle className="text-base">{printer.name}</CardTitle><Badge variant={printer.isActive ? "default" : "secondary"}>{printer.isActive ? "Active" : "Inactive"}</Badge></div></CardHeader><CardContent className="space-y-3"><div className="grid grid-cols-2 gap-2 text-sm"><span className="text-muted-foreground">Container size</span><span className="text-right">{decimal.format(printer.containerSizeLiters)} L</span><span className="text-muted-foreground">Container cost</span><span className="text-right">{printer.containerPriceCents === null ? "Not configured" : money.format(printer.containerPriceCents / 100)}</span><span className="text-muted-foreground">Restock target</span><span className="text-right">{decimal.format(printer.restockTargetLiters)} L</span></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => openPrinterDialog(printer)}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>{printer.isActive ? <Button size="sm" variant="ghost" disabled={activePrinters.length <= 1} onClick={() => setConfirmAction({ kind: "printer", id: printer.id, name: printer.name })}><Trash2 className="mr-1 h-3.5 w-3.5" />Delete</Button> : <Button size="sm" variant="outline" onClick={() => activatePrinter.mutate(printer.id)}>Reactivate</Button>}</div></CardContent></Card>)}</div>
        </TabsContent>
      </Tabs>
    </ContentLayout>

    <Dialog open={printerDialogOpen} onOpenChange={setPrinterDialogOpen}><DialogContent><DialogHeader><DialogTitle>{editingPrinterId ? "Edit Printer" : "Add Printer"}</DialogTitle><DialogDescription>Container and target settings apply to each ink color.</DialogDescription></DialogHeader><div className="grid gap-3 py-2"><div><Label htmlFor="printer-name">Name</Label><Input id="printer-name" value={printerForm.name} onChange={(event) => setPrinterForm((form) => ({ ...form, name: event.target.value }))} /></div><div className="grid grid-cols-2 gap-3"><div><Label htmlFor="printer-size">Container size (L)</Label><Input id="printer-size" inputMode="decimal" value={printerForm.size} onChange={(event) => setPrinterForm((form) => ({ ...form, size: event.target.value }))} /></div><div><Label htmlFor="printer-price">Container cost ($)</Label><Input id="printer-price" inputMode="decimal" placeholder="Optional" value={printerForm.price} onChange={(event) => setPrinterForm((form) => ({ ...form, price: event.target.value }))} /></div></div><div><Label htmlFor="printer-target">Post-job restock target (L per color)</Label><Input id="printer-target" inputMode="decimal" value={printerForm.target} onChange={(event) => setPrinterForm((form) => ({ ...form, target: event.target.value }))} /></div></div><DialogFooter><Button variant="outline" onClick={() => setPrinterDialogOpen(false)}>Cancel</Button><Button onClick={submitPrinter} disabled={savePrinter.isPending}>Save Printer</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={Boolean(confirmAction)} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}><DialogContent><DialogHeader><DialogTitle>{confirmAction?.kind === "spec" ? "Delete job spec?" : "Deactivate printer?"}</DialogTitle><DialogDescription>{confirmAction?.kind === "spec" ? `Delete “${confirmAction.name}”? This cannot be undone.` : `Deactivate “${confirmAction?.name}”? Saved specs will retain their printer reference and you can reactivate it later.`}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirmAction(null)}>Cancel</Button><Button variant="destructive" disabled={deleteSpec.isPending || deactivatePrinter.isPending} onClick={() => { if (!confirmAction) return; if (confirmAction.kind === "spec") deleteSpec.mutate(confirmAction.id); else deactivatePrinter.mutate(confirmAction.id); }}>Confirm</Button></DialogFooter></DialogContent></Dialog>
  </Page>;
}
