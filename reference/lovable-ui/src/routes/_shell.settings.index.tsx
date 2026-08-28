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
  const connected = connections.filter((c) => c.status === "ready").length;
  const attention = connections.filter((c) => c.status === "error" || c.status === "reconnect").length;
  const notConfigured = connections.filter((c) => c.status === "not-configured" || c.status === "optional").length;

  const items: Readiness[] = ["ready", "ready", "attention", "ready", "attention", "ready", "attention"];
  const readyCount = items.filter((i) => i === "ready").length;

  return (
    <SettingsPage
      title="Settings"
      description="Configure your organization, team, communications, billing, and personal preferences."
    >
      <div className="panel flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">{readyCount} of {items.length} areas ready</div>
          <p className="text-[12px] text-muted-foreground">Three areas need attention before they stop blocking work.</p>
        </div>
        <div className="flex items-center gap-1.5" aria-hidden>
          {items.map((s, i) => (
            <span key={i} className={cn("h-1.5 w-8 rounded-full", s === "ready" ? "bg-ok" : "bg-warn")} />
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Card
          title="Business Profile"
          state="ready"
          lines={<>
            <div>{businessProfile.displayName} · {businessProfile.legalName}</div>
            <div>{businessProfile.address1}, {businessProfile.city}, {businessProfile.region} {businessProfile.postal}</div>
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
          state="ready"
          lines={<>
            <div>Next invoice {numbering[2]!.example} · next order {numbering[1]!.example}</div>
            <div>Default terms Net 30</div>
          </>}
          action={<div className="flex gap-2"><DeepLink to="/settings/numbering">Numbering</DeepLink><DeepLink to="/settings/invoice-defaults">Invoice defaults</DeepLink></div>}
        />

        <Card
          className="sm:col-span-2"
          title="Integrations"
          state="attention"
          lines={<>
            <div>{connected} connected · {attention} need attention · {notConfigured} not configured</div>
            <div>Accounting and payments are not connected yet. The local device bridge is offline.</div>
          </>}
          action={<div className="flex flex-wrap gap-2">
            <DeepLink to="/settings/accounting">Accounting</DeepLink>
            <DeepLink to="/settings/payments">Payments</DeepLink>
            <DeepLink to="/settings/production-connections">Production connections</DeepLink>
          </div>}
        />
      </div>

      <section className="panel p-3">
        <h2 className="text-[13px] font-semibold tracking-tight">What is blocking work right now</h2>
        <ul className="mt-2 divide-y divide-border">
          {[
            { what: "Quotes cannot be sent to shipped destinations until shipping tax is configured.", to: "/settings/sales-tax", label: "Open Sales Tax" },
            { what: "12 products cannot move from quote to order until they have production routing.", to: "/products", label: "Open Product Routing" },
            { what: "The local device bridge is offline, so RIP handoff is manual.", to: "/settings/production-connections", label: "Open Production Connections" },
          ].map((b) => (
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
