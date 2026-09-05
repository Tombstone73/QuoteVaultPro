import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

type Preview = {
  customers: Array<{ id: string; companyName: string }>;
  conflicts: Record<string, Array<{ customerId: string; value: unknown }>>;
  relationshipCounts: Record<string, number>;
  primaryContacts: Array<{ contactId: string; customerId: string; firstName: string; lastName: string; email: string | null }>;
  quickBooksResolution: {
    retainedQuickBooksCustomerId: string | null;
    retiredQuickBooksCustomerIds: string[];
    warning: string | null;
  };
};

const label = (value: string) => value.replace(/([A-Z])/g, " $1").replace(/^./, (character) => character.toUpperCase());

export function CustomerMergeDialog({ customerIds, open, onOpenChange }: { customerIds: string[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [survivorCustomerId, setSurvivorCustomerId] = useState("");
  const [fieldChoices, setFieldChoices] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [primaryContactId, setPrimaryContactId] = useState("");
  const previewQuery = useQuery<{ success: true; data: Preview }>({
    queryKey: ["customer-merge-preview", customerIds],
    enabled: open && customerIds.length >= 2,
    queryFn: async () => {
      const response = await fetch("/api/customers/merge/preview", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerIds }) });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error?.message ?? "Unable to prepare customer merge.");
      return response.json();
    },
  });
  const preview = previewQuery.data?.data;
  const conflicts = preview?.conflicts ?? {};

  useEffect(() => {
    if (!open || !preview?.customers.length) return;
    const initialSurvivor = preview.customers.some((customer) => customer.id === survivorCustomerId) ? survivorCustomerId : preview.customers[0]!.id;
    setSurvivorCustomerId(initialSurvivor);
    setFieldChoices(Object.fromEntries(Object.keys(conflicts).map((field) => [field, initialSurvivor])));
    setPrimaryContactId(preview.primaryContacts.length === 1 ? preview.primaryContacts[0]!.contactId : "");
    setConfirmed(false);
  }, [open, preview?.customers.length]);

  const merge = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/customers/merge", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ survivorCustomerId, sourceCustomerIds: customerIds.filter((id) => id !== survivorCustomerId), fieldChoices, primaryContactId: primaryContactId || null, reviewed: true }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Customer merge failed.");
      return body;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      toast({ title: "Customers merged", description: "The duplicate records were retained as merged history." });
      onOpenChange(false);
    },
    onError: (error: Error) => toast({ title: "Customer merge failed", description: error.message, variant: "destructive" }),
  });

  const survivorName = useMemo(() => preview?.customers.find((customer) => customer.id === survivorCustomerId)?.companyName ?? "selected customer", [preview, survivorCustomerId]);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Merge Customers</DialogTitle><DialogDescription>Select the surviving customer, resolve conflicting account values, then confirm this consequential merge.</DialogDescription></DialogHeader>
      {previewQuery.isLoading ? <p className="text-sm text-muted-foreground">Preparing relationship summary…</p> : previewQuery.error ? <p className="text-sm text-destructive">{previewQuery.error.message}</p> : preview ? <div className="space-y-5">
        <div className="space-y-2"><Label>Keep this customer</Label><Select value={survivorCustomerId} onValueChange={(value) => { setSurvivorCustomerId(value); setFieldChoices(Object.fromEntries(Object.keys(conflicts).map((field) => [field, value]))); }}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{preview.customers.map((customer) => <SelectItem key={customer.id} value={customer.id}>{customer.companyName}</SelectItem>)}</SelectContent></Select></div>
        <div><p className="text-sm font-medium mb-2">Relationships that will be retained and re-parented</p><div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">{Object.entries(preview.relationshipCounts).map(([key, value]) => <div key={key} className="rounded border p-2"><span className="block text-muted-foreground">{label(key)}</span><strong>{value}</strong></div>)}</div></div>
        {preview.quickBooksResolution.warning && <div data-testid="quickbooks-merge-warning" className="rounded-md border border-amber-500/50 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">{preview.quickBooksResolution.warning}</div>}
        {Object.keys(conflicts).length > 0 && <div className="space-y-3"><p className="text-sm font-medium">Resolve conflicting customer values</p>{Object.entries(conflicts).map(([field, options]) => <div key={field} className="grid grid-cols-[150px,1fr] items-center gap-3"><Label>{label(field)}</Label><Select value={fieldChoices[field] ?? ""} onValueChange={(value) => setFieldChoices((current) => ({ ...current, [field]: value }))}><SelectTrigger><SelectValue placeholder="Choose value" /></SelectTrigger><SelectContent>{options.map((option) => <SelectItem key={`${option.customerId}-${String(option.value)}`} value={option.customerId}>{preview.customers.find((customer) => customer.id === option.customerId)?.companyName}: {String(option.value)}</SelectItem>)}</SelectContent></Select></div>)}</div>}
        {preview.primaryContacts.length > 1 && <div className="space-y-2"><Label>Primary contact for the survivor</Label><Select value={primaryContactId} onValueChange={setPrimaryContactId}><SelectTrigger><SelectValue placeholder="Choose primary contact" /></SelectTrigger><SelectContent>{preview.primaryContacts.map((contact) => <SelectItem key={contact.contactId} value={contact.contactId}>{contact.firstName} {contact.lastName}{contact.email ? ` — ${contact.email}` : ""}</SelectItem>)}</SelectContent></Select></div>}
        <div className="flex items-start gap-2"><Checkbox id="confirm-customer-merge" checked={confirmed} onCheckedChange={(value) => setConfirmed(value === true)} /><Label htmlFor="confirm-customer-merge">I understand this re-parents records and retires the source customers as merged history.</Label></div>
      </div> : null}
      <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!preview || !survivorCustomerId || (preview.primaryContacts.length > 1 && !primaryContactId) || !confirmed || merge.isPending} onClick={() => merge.mutate()}>Merge into {survivorName}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
