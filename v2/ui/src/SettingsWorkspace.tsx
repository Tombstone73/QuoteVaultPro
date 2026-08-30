import React, { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronRight, CircleHelp, Mail, Settings2, ShieldCheck } from "lucide-react";

type Section = "overview" | "business-profile" | "documents" | "numbering" | "staff" | "permission-sets" | "portal-access" | "sales-tax" | "email" | "invoice-defaults" | "payments" | "accounting" | "shipping" | "production-connections" | "preferences" | "notifications";
type Item = Readonly<{ id: Section; label: string }>;
const groups: readonly Readonly<{ label: string; items: readonly Item[] }>[] = [
  { label: "", items: [{ id: "overview", label: "Overview" }] },
  { label: "Organization", items: [{ id: "business-profile", label: "Business Profile" }, { id: "documents", label: "Documents & Branding" }, { id: "numbering", label: "Numbering" }] },
  { label: "Team & Access", items: [{ id: "staff", label: "Staff & Users" }, { id: "permission-sets", label: "Permission Sets" }, { id: "portal-access", label: "Customer Portal Access" }] },
  { label: "Sales", items: [{ id: "sales-tax", label: "Sales Tax" }] },
  { label: "Communications", items: [{ id: "email", label: "Email Delivery" }] },
  { label: "Billing & Payments", items: [{ id: "invoice-defaults", label: "Invoice Defaults" }, { id: "payments", label: "Payments" }] },
  { label: "Integrations", items: [{ id: "accounting", label: "Accounting" }, { id: "shipping", label: "Shipping & Carriers" }, { id: "production-connections", label: "Production Connections" }] },
  { label: "My Preferences", items: [{ id: "preferences", label: "Appearance" }, { id: "notifications", label: "Notifications" }] },
];
const all = groups.flatMap((group) => group.items);
const sectionFromUrl = (): Section => {
  const value = new URLSearchParams(window.location.search).get("section");
  return all.some((item) => item.id === value) ? value as Section : "overview";
};
const go = (section: Section) => {
  const url = new URL(window.location.href); url.searchParams.set("section", section);
  window.history.pushState({}, "", `${url.pathname}?${url.searchParams}`); window.dispatchEvent(new PopStateEvent("popstate"));
};
const Chip = ({ tone, children }: Readonly<{ tone: "ready" | "attention" | "migration" | "optional" | "unavailable"; children: ReactNode }>) => <span className={`v2-settings-chip is-${tone}`}>{children}</span>;
const Future = ({ title }: Readonly<{ title: string }>) => <section className="v2-settings-panel v2-settings-future"><CircleHelp aria-hidden /><div><h2>{title}</h2><p>This approved Settings surface is retained while its V2 editor is not yet mounted here. It does not create browser-local configuration or a parallel persistence path.</p></div></section>;

export const SettingsWorkspace = ({ salesTax, email, accounting, businessProfile, documents, numbering, staff, permissionSets, portalAccess }: Readonly<{ salesTax: ReactNode; email: ReactNode; accounting: ReactNode; businessProfile: ReactNode; documents: ReactNode; numbering: ReactNode; staff: ReactNode; permissionSets: ReactNode; portalAccess: ReactNode }>) => {
  const [section, setSection] = useState<Section>(() => typeof window === "undefined" ? "overview" : sectionFromUrl());
  useEffect(() => { const sync = () => setSection(sectionFromUrl()); window.addEventListener("popstate", sync); return () => window.removeEventListener("popstate", sync); }, []);
  const select = (next: Section) => { setSection(next); go(next); };
  const content = section === "overview" ? <Overview select={select} /> : section === "sales-tax" ? salesTax : section === "email" ? email : section === "accounting" ? accounting : section === "business-profile" ? businessProfile : section === "documents" ? documents : section === "numbering" ? numbering : section === "staff" ? staff : section === "permission-sets" ? permissionSets : section === "portal-access" ? portalAccess : <Future title={all.find((item) => item.id === section)?.label ?? "Settings"} />;
  return <main className="v2-settings-workspace">
    <aside className="v2-settings-nav" aria-label="Settings navigation">
      {groups.map((group) => <div className="v2-settings-nav-group" key={group.label || "root"}>{group.label && <h2>{group.label}</h2>}{group.items.map((item) => <button type="button" key={item.id} aria-current={section === item.id ? "page" : undefined} className={section === item.id ? "is-active" : ""} onClick={() => select(item.id)}>{item.label}</button>)}</div>)}
    </aside>
    <section className="v2-settings-content">{content}</section>
  </main>;
};

const Overview = ({ select }: Readonly<{ select: (section: Section) => void }>) => <>
  <header className="v2-settings-header"><div><p>SETTINGS</p><h1>Settings</h1><span>Configure your organization, team, communications, billing, and personal preferences.</span></div><Settings2 aria-hidden /></header>
  <div className="v2-settings-status"><strong>Settings status</strong><Chip tone="optional">Open a section to view canonical readiness</Chip><Chip tone="optional">Optional integrations</Chip></div>
  <div className="v2-settings-cards">
    <Card title="Business Profile" tone="optional" detail="Organization identity and customer pickup context." action="Configure" onClick={() => select("business-profile")} />
    <Card title="Team & Access" tone="optional" detail="Staff, permission sets, and customer portal authority." action="Manage" onClick={() => select("staff")} />
    <Card title="Sales Tax" tone="optional" detail="Pickup, Shipping, and Local Delivery coverage is independently reported." action="Configure" onClick={() => select("sales-tax")} />
    <Card title="Email Delivery" tone="optional" detail="Tenant Gmail readiness for customer-document delivery." action="Manage" onClick={() => select("email")} />
    <Card title="Billing & Numbering" tone="optional" detail="Native V2 Quote and Order numbering is managed separately from historical documents." action="Numbering" onClick={() => select("numbering")} />
    <Card title="Integrations" tone="optional" detail="Accounting, payments, carriers, and production connections remain independently optional." action="Open integrations" onClick={() => select("accounting")} />
  </div>
  <section className="v2-settings-panel v2-settings-attention"><AlertTriangle aria-hidden /><div><h2>Readiness is server-authoritative</h2><p>Sales Tax, Email Delivery, Organization, Numbering, and Team & Access each load their own canonical readiness and permissions.</p><button type="button" onClick={() => select("sales-tax")}>Open Sales Tax <ChevronRight aria-hidden /></button></div></section>
</>;
const Card = ({ title, tone, detail, action, onClick }: Readonly<{ title: string; tone: "ready" | "attention" | "migration" | "optional"; detail: string; action: string; onClick: () => void }>) => <article className="v2-settings-card"><div><h2>{title}</h2><Chip tone={tone}>{tone === "ready" ? "Ready" : tone === "attention" ? "Needs attention" : tone === "migration" ? "Migration required" : "Optional"}</Chip></div><p>{detail}</p><button type="button" onClick={onClick}>{action} <ChevronRight aria-hidden /></button></article>;
