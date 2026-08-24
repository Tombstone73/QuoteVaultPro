import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowLeft, Building2, Mail, MapPin, Phone, ShieldCheck } from "lucide-react";
import { PageHeader, Panel, Status } from "@/components/app/primitives";
import { Button } from "@/components/ui/button";
import { customers } from "@/lib/mock/data";
import { PrimaryBadge, allContacts } from "./_shell.contacts.index";

export const Route = createFileRoute("/_shell/contacts/$id")({
  head: () => ({
    meta: [
      { title: "Contact — PrintersHero V2" },
      { name: "description", content: "Contact detail: company relationship, email, phone, primary status and account address." },
      { property: "og:title", content: "Contact — PrintersHero V2" },
      { property: "og:description", content: "Contact detail with company relationship, email, phone and primary status." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ContactDetail,
});

function Line({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2 py-1.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
        <div className="mt-0.5 break-words text-[15px] leading-snug">{value}</div>
      </div>
    </div>
  );
}

function ContactDetail() {
  const { id } = Route.useParams();
  const row = allContacts().find((r) => r.contactId === id);
  if (!row) return <div className="p-8 text-sm text-muted-foreground">Contact not found.</div>;
  const account = customers.find((c) => c.id === row.customerId)!;
  const raw = account.contacts.find((c) => c.id === id)!;

  return (
    <div className="w-full space-y-3 p-4">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {row.name}
            {row.primary && <PrimaryBadge />}
          </span>
        }
        subtitle={row.title ?? undefined}
        meta={
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px]">
            <Link to="/customers/$id" params={{ id: account.id }} className="font-medium text-primary hover:underline">
              {account.name}
            </Link>
            <Status value={account.status} />
          </div>
        }
        actions={
          <>
            <Button asChild size="sm" variant="outline" className="h-8 gap-1.5">
              <Link to="/contacts">
                <ArrowLeft className="size-4" />
                All Contacts
              </Link>
            </Button>
            <Button asChild size="sm" className="h-8 gap-1.5">
              <Link to="/customers/$id" params={{ id: account.id }}>
                <Building2 className="size-4" />
                Open Customer
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Contact Details" section className="lg:col-span-2">
          <div className="grid gap-x-6 sm:grid-cols-2">
            <Line icon={Mail} label="Email" value={<a href={`mailto:${row.email}`} className="text-primary hover:underline">{row.email}</a>} />
            <Line icon={Phone} label="Phone" value={<a href={`tel:${row.phone}`} className="num hover:underline">{row.phone}</a>} />
            <Line icon={Building2} label="Company" value={<Link to="/customers/$id" params={{ id: account.id }} className="text-primary hover:underline">{account.name}</Link>} />
            <Line icon={MapPin} label="Address" value={account.address} />
            {raw.portalAccess && <Line icon={ShieldCheck} label="Portal Access" value={raw.portalAccess} />}
            <Line icon={ShieldCheck} label="Primary Contact" value={row.primary ? "Yes" : "No"} />
          </div>
        </Panel>

        <Panel title="Account" section>
          <div className="grid gap-x-6 sm:grid-cols-2 lg:grid-cols-1">
            <Line icon={Building2} label="Terms" value={account.terms} />
            <Line icon={Building2} label="Other Contacts" value={
              account.contacts.length > 1 ? (
                <span className="flex flex-col gap-0.5">
                  {account.contacts.filter((c) => c.id !== id).map((c) => (
                    <Link key={c.id} to="/contacts/$id" params={{ id: c.id }} className="text-primary hover:underline">
                      {c.name}
                    </Link>
                  ))}
                </span>
              ) : (
                <span className="text-muted-foreground">None</span>
              )
            } />
          </div>
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title="Recent Documents" section>
          <p className="py-6 text-center text-[13px] text-muted-foreground">No documents linked to this contact yet.</p>
        </Panel>
        <Panel title="Communication" section>
          <p className="py-6 text-center text-[13px] text-muted-foreground">No communication recorded for this contact yet.</p>
        </Panel>
      </div>
    </div>
  );
}
