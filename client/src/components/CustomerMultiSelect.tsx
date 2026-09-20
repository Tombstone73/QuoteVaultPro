import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiFetch } from "@/lib/queryClient";

type Customer = { id: string; companyName?: string | null; email?: string | null };
const label = (customer: Customer) => customer.companyName || customer.email || `Customer ${customer.id}`;

export function CustomerMultiSelect({ label: fieldLabel, value, onChange, disabled }: {
  label: string; value: string[]; onChange: (ids: string[]) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Customer[]>([]);
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(search), 250); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { setPage(1); setRows([]); }, [debouncedSearch]);
  const query = useQuery({
    queryKey: ["customers", "multi-select", debouncedSearch, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), pageSize: "25" });
      if (debouncedSearch) params.set("search", debouncedSearch);
      const response = await apiFetch(`/api/customers?${params}`);
      if (!response.ok) throw new Error("Failed to load customers");
      const payload = await response.json();
      return { customers: (payload?.data?.customers || []) as Customer[], pagination: payload?.data?.pagination || {} };
    },
    enabled: open,
  });
  useEffect(() => {
    if (!query.data) return;
    setRows((prior) => page === 1 ? query.data.customers : Array.from(new Map([...prior, ...query.data.customers].map((row) => [row.id, row])).values()));
  }, [page, query.data]);
  const selectedQueries = useQueries({ queries: value.map((id) => ({ queryKey: ["customers", "selected-label", id], queryFn: async () => { const r = await apiFetch(`/api/customers/${id}`); if (!r.ok) throw new Error("Customer not found"); return r.json() as Promise<Customer>; }, staleTime: 60_000 })) });
  const selected = useMemo(() => new Set(value), [value]);
  const selectedNames = selectedQueries.map((q, index) => q.data ? label(q.data) : rows.find((r) => r.id === value[index]) ? label(rows.find((r) => r.id === value[index])!) : "Selected customer");
  const hasMore = Boolean(query.data?.pagination?.hasNextPage ?? (query.data?.pagination?.page < query.data?.pagination?.totalPages));
  const toggle = (id: string) => onChange(selected.has(id) ? value.filter((item) => item !== id) : [...value, id].sort());
  return <div className="grid gap-1 text-sm"><span>{fieldLabel}</span><Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild><Button type="button" variant="outline" className="justify-between font-normal" disabled={disabled}>{value.length ? `${fieldLabel}: ${value.length} selected` : `All customers`}<ChevronsUpDown className="h-4 w-4 opacity-50" /></Button></PopoverTrigger><PopoverContent className="w-[360px] p-3" align="start"><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customers..." /><div className="mt-2 max-h-64 space-y-1 overflow-auto">{rows.map((customer) => <label key={customer.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-muted"><Checkbox checked={selected.has(customer.id)} onCheckedChange={() => toggle(customer.id)} /><span className="truncate">{label(customer)}</span></label>)}{query.isLoading && <p className="p-2 text-muted-foreground">Loading customers...</p>}{!query.isLoading && rows.length === 0 && <p className="p-2 text-muted-foreground">No customers found.</p>}</div>{hasMore && <Button type="button" variant="ghost" className="mt-2 w-full" onClick={() => setPage((current) => current + 1)} disabled={query.isFetching}>{query.isFetching ? "Loading..." : "Load more customers"}</Button>}<div className="mt-2 flex items-center justify-between text-xs text-muted-foreground"><span className="truncate">{selectedNames.slice(0, 2).join(", ")}{value.length > 2 ? ` +${value.length - 2}` : ""}</span>{value.length > 0 && <button type="button" onClick={() => onChange([])}>Clear</button>}</div></PopoverContent></Popover></div>;
}
