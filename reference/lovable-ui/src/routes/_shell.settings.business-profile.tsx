import { createFileRoute } from "@tanstack/react-router";
import { AuditLine, ReadyChip, Row, SaveBar, Section, SettingsPage } from "@/components/app/settings/shared";
import { Input } from "@/components/ui/input";
import { businessProfile } from "@/lib/mock/settings";

export const Route = createFileRoute("/_shell/settings/business-profile")({
  head: () => ({
    meta: [
      { title: "Business Profile — PrintersHero V2 Settings" },
      { name: "description", content: "Canonical business identity, contact details, address, pickup location and regional defaults for your print shop." },
      { property: "og:title", content: "Business Profile — PrintersHero V2 Settings" },
      { property: "og:description", content: "The organization identity used on every customer document." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BusinessProfilePage,
});

const input = "h-8 text-[13px]";

function BusinessProfilePage() {


  return (
    <SettingsPage
      title="Business Profile"
      description="This is the single source of business identity. Quotes, orders and invoices all use these details."
      actions={<ReadyChip state="ready" />}
    >
      <Section title="Business identity">
        <div className="grid gap-3 sm:grid-cols-2">
          <Row label="Business / display name" hint="Shown to customers on documents and the portal.">
            <Input className={input} defaultValue={businessProfile.displayName} />
          </Row>
          <Row label="Legal name" hint="Used where a legal entity name is required.">
            <Input className={input} defaultValue={businessProfile.legalName} />
          </Row>
        </div>
      </Section>

      <Section title="Contact">
        <div className="grid gap-3 sm:grid-cols-3">
          <Row label="Business phone"><Input className={`num ${input}`} defaultValue={businessProfile.phone} /></Row>
          <Row label="Business email"><Input className={input} defaultValue={businessProfile.email} /></Row>
          <Row label="Website"><Input className={input} defaultValue={businessProfile.website} /></Row>
        </div>
      </Section>

      <Section title="Business address">
        <div className="grid gap-3 sm:grid-cols-2">
          <Row label="Address" className="sm:col-span-2"><Input className={input} defaultValue={businessProfile.address1} /></Row>
          <Row label="Address line 2" className="sm:col-span-2"><Input className={input} defaultValue={businessProfile.address2} /></Row>
          <Row label="City"><Input className={input} defaultValue={businessProfile.city} /></Row>
          <Row label="State / region"><Input className={input} defaultValue={businessProfile.region} /></Row>
          <Row label="Postal code"><Input className={`num ${input}`} defaultValue={businessProfile.postal} /></Row>
          <Row label="Country"><Input className={input} defaultValue={businessProfile.country} /></Row>
        </div>
      </Section>

      <Section title="Pickup location" hint="Pickup workflows and pickup tax use this location.">
        <div className="panel p-3 text-[13px]">
          <p className="text-muted-foreground">Customer pickup currently uses your business address.</p>
          <div className="mt-2 leading-relaxed">
            <div className="font-medium">{businessProfile.displayName}</div>
            <div>{businessProfile.address1}{businessProfile.address2 ? `, ${businessProfile.address2}` : ""}</div>
            <div>{businessProfile.city}, {businessProfile.region} {businessProfile.postal}</div>
            <div>{businessProfile.country}</div>
          </div>
        </div>
      </Section>

      <Section title="Regional">
        <div className="grid gap-3 sm:grid-cols-2">
          <Row label="Timezone"><Input className={input} defaultValue={businessProfile.timezone} /></Row>
          <Row label="Currency"><Input className={input} defaultValue={businessProfile.currency} /></Row>
        </div>
      </Section>


      <AuditLine>Last changed by {businessProfile.updatedBy} · {businessProfile.updatedAt}</AuditLine>
      <SaveBar note="Changes apply to documents created after saving." />
    </SettingsPage>
  );
}
