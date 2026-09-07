import { createFileRoute } from "@tanstack/react-router";
import { ReadyChip, SettingsPage, DeepLink } from "@/components/app/settings/shared";
import { Button } from "@/components/ui/button";
import { Link } from "@tanstack/react-router";
import {
  businessProfile, connections, emailDelivery, homeJurisdiction, numbering,
  productRoutingReadiness, settingsPermissionSets, staff, type Readiness,
} from "@/lib/mock/settings";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export const Route = createFileRoute("/_shell/settings/")({
  head: () => ({
    meta: [
      { title: "Settings Overview — PrintersHero V2" },
      { name: "description", content: "Operational readiness for your organization: business profile, team, tax, email delivery, billing and integrations." },
      { property: "og:title", content: "Settings Overview — PrintersHero V2" },
      { property: "og:description", content: "See what is configured, what needs attention and where to fix it." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OverviewPage,
});

function Card({
  title, state, stateLabel, lines, action, className,
}: { title: string; state: Readiness; stateLabel?: string | undefined; lines: ReactNode; action: ReactNode; className?: string | undefined }) {
  return (
    <div className={cn("panel flex flex-col gap-2 p-3", className)}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-[13px] font-semibold tracking-tight">{title}</h2>
        <ReadyChip state={state} label={stateLabel} />
      </div>
      <div className="flex-1 space-y-0.5 text-[12px] text-muted-foreground">{lines}</div>
      <div className="pt-0.5">{action}</div>
    </div>
  );
}
function OverviewPage() {
  const activeStaff = staff.filter((s) => s.state === "Active").length;
  const pending = staff.filter((s) => s.state === "Invitation pending").length;
  const optionalCount = connections.filter((c) => c.status !== "ready" && c.status !== "error" && c.status !== "reconnect").length;
  const integrationErrors = connections.filter((c) => c.status === "error" || c.status === "reconnect").length;

  const blocking = [
    { what: "Quotes and orders that ship or are delivered cannot resolve authoritative tax, so they cannot be sent.", to: "/settings/sales-tax", label: "Open Sales Tax" },
    { what: `${productRoutingReadiness.needsRouting} active products cannot move from quote to order until they have production routing.`, to: "/products", label: "Open Product Routing" },
  ];

  const attentionItems = [
    { what: "Invoice and purchase order numbering are compatibility managed until migration is completed.", to: "/settings/numbering", label: "Open Numbering" },
    { what: "External production integrations are not available yet, so RIP and device handoff stays manual.", to: "/settings/production-connections", label: "Open Production Connections" },
  ];

  return (
    <SettingsPage
      title="Settings"
      description="Configure your organization, team, communications, billing, and personal preferences."
    >
      <div className="panel flex flex-wrap items-center gap-x-6 gap-y-2 px-3 py-2.5">
        <div className="text-[13px] font-semibold">Settings status</div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[12px]">
          <span className="inline-flex items-center gap-1.5"><ReadyChip state="ready" label="3 areas ready" /></span>
          <span className="inline-flex items-center gap-1.5"><ReadyChip state="attention" label="2 need attention" /></span>
          <span className="inline-flex items-center gap-1.5"><ReadyChip state="migration" label="1 migration required" /></span>
          <span className="inline-flex items-center gap-1.5"><ReadyChip state="optional" label={`${optionalCount} optional integrations`} /></span>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card
          title="Business Profile"
          state="ready"
          lines={<>
            <div>{businessProfile.displayName} · {businessProfile.legalName}</div>
            <div>{businessProfile.address1}, {businessProfile.city}, {businessProfile.region} {businessProfile.postal}</div>
            <div>Customer pickup uses this address.</div>
          </>}
          action={<DeepLink to="/settings/business-profile">Configure</DeepLink>}
        />

        <Card
          title="Team & Access"
          state="ready"
          lines={<>
            <div>{activeStaff} staff members active{pending ? `, ${pending} invitation pending` : ""}</div>
            <div>{settingsPermissionSets.length} permission sets · 1 administrator</div>
          </>}
          action={<DeepLink to="/settings/staff">Manage</DeepLink>}
        />

        <Card
          title="Sales Tax"
          state="attention"
          lines={<>
            <div className="flex items-center gap-2"><ReadyChip state="ready" /> Pickup · {homeJurisdiction.name} {homeJurisdiction.rate}%</div>
            <div className="flex items-center gap-2"><ReadyChip state="not-configured" /> Shipping</div>
            <div className="flex items-center gap-2"><ReadyChip state="not-configured" /> Local delivery</div>
            <div className="text-[11px]">Documents that ship or are delivered cannot be sent until a destination jurisdiction is configured.</div>
          </>}
          action={<DeepLink to="/settings/sales-tax">Configure</DeepLink>}
        />

        <Card
          title="Email Delivery"
          state="ready"
          lines={<>
            <div>Connected as {emailDelivery.sender}</div>
            <div>Used to send customer documents such as quotes.</div>
          </>}
          action={<DeepLink to="/settings/email">Manage</DeepLink>}
        />

        <Card
          title="Products & Routing"
          state="attention"
          lines={<>
            <div>{productRoutingReadiness.routable} of {productRoutingReadiness.activeProducts} active products are routable</div>
            <div>{productRoutingReadiness.needsRouting} active products need production routing</div>
            <div className="text-[11px]">Routing is configured in Products, not in Settings.</div>
          </>}
          action={<DeepLink to="/products">Open Products / Routing</DeepLink>}
        />

        <Card
          title="Billing & Numbering"
          state="migration"
          lines={<>
            <div>Quote and order numbering ready · next order {numbering[1]!.example}</div>
            <div>Previous invoice / purchase order numbering migration still required</div>
            <div>Default terms {" "}Net 30</div>
          </>}
          action={<div className="flex gap-2"><DeepLink to="/settings/numbering">Numbering</DeepLink><DeepLink to="/settings/invoice-defaults">Invoice defaults</DeepLink></div>}
        />

        <Card
          className="sm:col-span-2"
          title="Integrations"
          state={integrationErrors ? "attention" : "optional"}
          stateLabel={integrationErrors ? undefined : "Optional"}
          lines={<>
            <div>{optionalCount} optional integrations are not connected{integrationErrors ? ` · ${integrationErrors} need attention` : ""}</div>
            <div>Accounting, payment providers, carriers and production connections are optional. Manual workflows continue to work without them.</div>
          </>}
          action={<div className="flex flex-wrap gap-2">
            <DeepLink to="/settings/accounting">Accounting</DeepLink>
            <DeepLink to="/settings/payments">Payments</DeepLink>
            <DeepLink to="/settings/shipping">Shipping</DeepLink>
            <DeepLink to="/settings/production-connections">Production connections</DeepLink>
          </div>}
        />
      </div>

      <section className="panel p-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-semibold tracking-tight">Blocking work</h2>
          <ReadyChip state="attention" label={`${blocking.length} items`} />
        </div>
        <p className="mt-0.5 text-[12px] text-muted-foreground">Work cannot proceed until these are resolved.</p>
        <ul className="mt-2 divide-y divide-border">
          {blocking.map((b) => (
            <li key={b.to} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12px]">
              <span>{b.what}</span>
              <Button asChild variant="outline" size="sm" className="h-7 text-[12px]">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <Link to={b.to as any}>{b.label}</Link>
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel p-3">
        <h2 className="text-[13px] font-semibold tracking-tight">Needs attention</h2>
        <p className="mt-0.5 text-[12px] text-muted-foreground">Work still gets done, but part of it is manual or awaiting migration.</p>
        <ul className="mt-2 divide-y divide-border">
          {attentionItems.map((b) => (
            <li key={b.to} className="flex flex-wrap items-center justify-between gap-2 py-2 text-[12px]">
              <span>{b.what}</span>
              <Button asChild variant="outline" size="sm" className="h-7 text-[12px]">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <Link to={b.to as any}>{b.label}</Link>
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </SettingsPage>
  );
}
