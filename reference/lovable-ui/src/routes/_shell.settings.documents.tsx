import { createFileRoute } from "@tanstack/react-router";
import { Trash2, Upload } from "lucide-react";
import { AuditLine, DeepLink, Row, SaveBar, Section, SettingsPage } from "@/components/app/settings/shared";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { businessProfile, documentBranding } from "@/lib/mock/settings";

export const Route = createFileRoute("/_shell/settings/documents")({
  head: () => ({
    meta: [
      { title: "Documents & Branding — PrintersHero V2 Settings" },
      { name: "description", content: "Logo, document footer, payment instructions and remittance details used on customer-facing documents." },
      { property: "og:title", content: "Documents & Branding — PrintersHero V2 Settings" },
      { property: "og:description", content: "Control how your documents look without duplicating business identity." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DocumentsPage,
});

function DocumentsPage() {
  return (
    <SettingsPage
      title="Documents & Branding"
      description="Customer-facing document identity. Business details themselves come from Business Profile."
    >
      <div className="panel flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
        <div className="min-w-0 text-[12px] text-muted-foreground">
          <div className="text-[13px] font-medium text-foreground">{businessProfile.displayName}</div>
          {businessProfile.address1}, {businessProfile.city}, {businessProfile.region} {businessProfile.postal} · {businessProfile.phone}
          <div>Business identity comes from Business Profile.</div>
        </div>
        <DeepLink to="/settings/business-profile">Edit Business Profile</DeepLink>
      </div>

      <Section title="Logo">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex size-20 items-center justify-center rounded-lg border border-border bg-surface-2 text-xl font-bold">
            {documentBranding.logo}
          </div>
          <div className="space-y-2">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-8 gap-1.5 text-[12px]"><Upload className="size-3.5" /> Replace logo</Button>
              <Button size="sm" variant="ghost" className="h-8 gap-1.5 text-[12px] text-late hover:text-late"><Trash2 className="size-3.5" /> Remove</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">PNG or SVG, at least 400px wide. Removing the logo affects all future documents.</p>
          </div>
        </div>
      </Section>

      <Section title="Document footer" hint="Appears at the bottom of quotes, orders and invoices.">
        <Textarea className="min-h-[70px] text-[13px]" defaultValue={documentBranding.footer} />
      </Section>

      <Section title="Payment instructions" hint="Shown on documents that support payment instructions.">
        <Textarea className="min-h-[70px] text-[13px]" defaultValue={documentBranding.payment} />
      </Section>

      <Section title="Remittance information" hint="Used when payments are mailed somewhere other than the business address.">
        <Row label="Remit to"><Textarea className="min-h-[54px] text-[13px]" defaultValue={documentBranding.remitTo} /></Row>
      </Section>

      <Section title="Document preview" hint="Visual reference only — documents are not edited here.">
        <div className="panel mx-auto w-full max-w-md space-y-3 p-4">
          <div className="flex items-start justify-between gap-3 border-b border-border pb-3">
            <div className="flex items-center gap-2">
              <div className="flex size-9 items-center justify-center rounded bg-surface-2 text-[12px] font-bold">{documentBranding.logo}</div>
              <div className="text-[12px] leading-tight">
                <div className="font-semibold">{businessProfile.displayName}</div>
                <div className="text-muted-foreground">{businessProfile.city}, {businessProfile.region}</div>
              </div>
            </div>
            <div className="text-right text-[12px]">
              <div className="font-semibold">INVOICE</div>
              <div className="num text-muted-foreground">INV-5218</div>
            </div>
          </div>
          <div className="space-y-1 text-[11px] text-muted-foreground">
            <div className="flex justify-between"><span>Coroplast Yard Sign 18×24</span><span className="num">$412.00</span></div>
            <div className="flex justify-between"><span>Installation</span><span className="num">$120.00</span></div>
            <div className="flex justify-between border-t border-border pt-1 font-semibold text-foreground"><span>Balance due</span><span className="num">$532.00</span></div>
          </div>
          <p className="border-t border-border pt-2 text-[10px] leading-snug text-muted-foreground">{documentBranding.payment}</p>
          <p className="text-[10px] leading-snug text-muted-foreground">{documentBranding.footer}</p>
        </div>
      </Section>

      <AuditLine>Last changed by Dale Hensley · Jul 30, 2026</AuditLine>
      <SaveBar note="Changes apply to documents created after saving." />
    </SettingsPage>
  );
}
