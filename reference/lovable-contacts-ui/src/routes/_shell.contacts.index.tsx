import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Search, Star } from "lucide-react";
import { PageHeader, td, th } from "@/components/app/primitives";
import { Input } from "@/components/ui/input";
import { customers } from "@/lib/mock/data";

export const Route = createFileRoute("/_shell/contacts/")({
  head: () => ({
    meta: [
      { title: "Contacts — PrintersHero V2" },
      { name: "description", content: "Every customer contact in one dense list: name, company, email, phone and primary status." },
      { property: "og:title", content: "Contacts — PrintersHero V2" },
      { property: "og:description", content: "Every customer contact in one dense list with company, email and phone." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ContactsPage,
});

export interface ContactRow {
  contactId: string;
  name: string;
  title?: string | undefined;
  email: string;
  phone: string;
  customerId: string;
  customerName: string;
  primary: boolean;
}

export function allContacts(): ContactRow[] {
  return customers.flatMap((c) =>
    c.contacts.map((ct) => ({
      contactId: ct.id,
      name: ct.name,
      title: ct.title,
      email: ct.email,
      phone: ct.phone,
      customerId: c.id,
      customerName: c.name,
      primary: c.primaryContactId === ct.id,
    })),
  );
}

export function PrimaryBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-primary bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium leading-none text-primary">
      <Star className="size-3.5 shrink-0" aria-hidden />
      Primary
    </span>
  );
}

function ContactsPage() {
  const [q, setQ] = useState("");
  const navigate = useNavigate();
  const rows = allContacts().filter((r) =>
    `${r.name} ${r.title ?? ""} ${r.customerName} ${r.email} ${r.phone}`.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="space-y-3 p-4">
      <PageHeader title="Contacts" subtitle={`${rows.length} contacts across ${customers.length} accounts`} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, company, email, phone…"
            className="h-8 w-full max-w-80 pl-7 text-[13px] sm:w-80"
          />
        </div>
      </div>

      <div className="panel overflow-hidden">
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead>
              <tr>
                <th className={th}>Contact</th>
                <th className={th}>Company</th>
                <th className={th}>Email</th>
                <th className={th}>Phone</th>
                <th className={th}>Primary</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.customerId}-${r.contactId}`}
                  className="row-h cursor-pointer border-t border-border hover:bg-accent/60"
                  onClick={() => navigate({ to: "/contacts/$id", params: { id: r.contactId } })}
                >
                  <td className={td}>
                    <Link
                      to="/contacts/$id"
                      params={{ id: r.contactId }}
                      className="font-medium text-primary hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.name}
                    </Link>
                    {r.title && <span className="ml-1.5 text-muted-foreground">· {r.title}</span>}
                  </td>
                  <td className={td}>
                    <Link
                      to="/customers/$id"
                      params={{ id: r.customerId }}
                      className="hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {r.customerName}
                    </Link>
                  </td>
                  <td className={td + " text-muted-foreground"}>{r.email}</td>
                  <td className={td + " num text-muted-foreground"}>{r.phone}</td>
                  <td className={td}>{r.primary ? <PrimaryBadge /> : <span className="text-muted-foreground">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
