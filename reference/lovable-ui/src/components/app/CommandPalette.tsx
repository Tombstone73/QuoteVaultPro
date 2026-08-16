import { useNavigate } from "@tanstack/react-router";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { useApp } from "@/lib/app-store";
import { artworkFiles, customers, invoices, products, shipments } from "@/lib/mock/data";

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, docs } = useApp();
  const navigate = useNavigate();

  const go = (to: string) => {
    setPaletteOpen(false);
    void navigate({ to });
  };

  return (
    <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
      <CommandInput placeholder="Search everything — customer, quote #, order #, PO, phone, file…" />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Quick Actions">
          <CommandItem value="new quote" onSelect={() => go("/quotes")}>New Quote</CommandItem>
          <CommandItem value="new order" onSelect={() => go("/orders")}>New Order</CommandItem>
          <CommandItem value="production board" onSelect={() => go("/production")}>Open Production Board</CommandItem>
          <CommandItem value="theme appearance" onSelect={() => go("/appearance")}>Switch Theme</CommandItem>
        </CommandGroup>
        <CommandGroup heading="Customers">
          {customers.map((c) => (
            <CommandItem
              key={c.id}
              value={`${c.name} ${c.contacts.map((x) => `${x.name} ${x.email} ${x.phone}`).join(" ")}`}
              onSelect={() => go(`/customers/${c.id}`)}
            >
              <span className="flex-1">{c.name}</span>
              <span className="text-[11px] text-muted-foreground">{c.contacts[0]?.name}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Quotes & Orders">
          {docs.map((d) => (
            <CommandItem key={d.id} value={`${d.documentType} ${d.number} ${d.po}`} onSelect={() => go(`/sales/${d.number}`)}>
              <span className="num flex-1">{d.documentType} #{d.number}</span>
              <span className="text-[11px] text-muted-foreground">PO {d.po || "—"} · {d.status}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Invoices">
          {invoices.map((i) => (
            <CommandItem key={i.id} value={i.number} onSelect={() => go(`/invoices/${i.id}`)}>
              <span className="num flex-1">{i.number}</span>
              <span className="text-[11px] text-muted-foreground">{i.status}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Products">
          {products.map((p) => (
            <CommandItem key={p.id} value={`${p.name} ${p.sku}`} onSelect={() => go(`/products/${p.id}`)}>
              <span className="flex-1">{p.name}</span>
              <span className="num text-[11px] text-muted-foreground">{p.sku}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Artwork">
          {artworkFiles.map((a) => (
            <CommandItem key={a.id} value={a.name} onSelect={() => go("/artwork")}>
              <span className="flex-1">{a.name}</span>
              <span className="text-[11px] text-muted-foreground">{a.kind}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Shipments">
          {shipments.map((s) => (
            <CommandItem key={s.id} value={`${s.tracking} ${s.order}`} onSelect={() => go("/shipping")}>
              <span className="num flex-1">{s.tracking}</span>
              <span className="text-[11px] text-muted-foreground">{s.status}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
