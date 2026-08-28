import { createFileRoute } from "@tanstack/react-router";
import { AuditLine, DeepLink, ReadyChip, Row, SaveBar, Section, SettingsPage } from "@/components/app/settings/shared";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { invoiceDefaults, numbering } from "@/lib/mock/settings";

export const Route = createFileRoute("/_shell/settings/invoice-defaults")({
  head: () => ({
    meta: [
      { title: "Invoice Defaults — PrintersHero V2 Settings" },
      { name: "description", content: "Default payment terms, due behavior and customer-facing instructions applied to new invoices." },
      { property: "og:title", content: "Invoice Defaults — PrintersHero V2 Settings" },
      { property: "og:description", content: "Durable invoice defaults, separate from invoice workflow." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: InvoiceDefaultsPage,
});

function InvoiceDefaultsPage() {
  return (
    <SettingsPage
      title="Invoice Defaults"
      description="These defaults are applied when a new invoice is created. Existing invoices keep the values they were issued with."
      actions={<ReadyChip state="ready" />}
    >
      <div className="panel grid gap-3 p-3 sm:grid-cols-3">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Next invoice number</div>
          <div className="num text-[13px] font-semibold">{numbering[2]!.example}</div>
        </div>
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Document identity</div>
          <div className="text-[13px]">From Business Profile</div>
        </div>
        <div className="flex items-end justify-start gap-2 sm:justify-end">
          <DeepLink to="/settings/numbering">Numbering</DeepLink>
          <DeepLink to="/settings/documents">Branding</DeepLink>
        </div>
      </div>

      <Section title="Payment terms">
        <div className="grid gap-3 sm:grid-cols-2">
          <Row label="Default payment terms" hint="Applied to new invoices unless the customer has their own terms.">
            <Input className="h-8 text-[13px]" defaultValue={invoiceDefaults.terms} />
          </Row>
          <Row label="Due date behavior">
            <select className="h-8 rounded-md border border-border bg-surface px-2 text-[13px]" defaultValue={invoiceDefaults.dueBehavior}>
              <option>Due on terms from issue date</option>
              <option>Due on receipt</option>
              <option>Due at end of following month</option>
            </select>
          </Row>
        </div>
      </Section>

      <Section title="Customer-facing instructions" hint="Shown on invoices below the totals.">
        <Textarea className="min-h-[80px] text-[13px]" defaultValue={invoiceDefaults.instructions} />
      </Section>

      <AuditLine>Last changed {invoiceDefaults.updated}</AuditLine>
      <SaveBar note="Applies to invoices created after saving." />
    </SettingsPage>
  );
}
