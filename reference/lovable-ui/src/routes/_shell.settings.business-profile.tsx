import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AuditLine, ReadyChip, Row, SaveBar, Section, SettingsPage } from "@/components/app/settings/shared";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
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
  const [samePickup, setSamePickup] = useState(businessProfile.pickupSameAsBusiness);

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

      <Section
        title="Pickup location"
        hint="Pickup workflows and pickup tax use this location."
      >
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-2/50 px-3 py-2 text-[13px]">
            <span>Use the business address for customer pickup</span>
            <Switch checked={samePickup} onCheckedChange={setSamePickup} />
          </label>
          {!samePickup && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Row label="Pickup address" className="sm:col-span-2"><Input className={input} placeholder="Street address" /></Row>
              <Row label="City"><Input className={input} placeholder="City" /></Row>
              <Row label="State / region"><Input className={input} placeholder="State" /></Row>
              <Row label="Postal code"><Input className={`num ${input}`} placeholder="Postal code" /></Row>
              <Row label="Country"><Input className={input} defaultValue={businessProfile.country} /></Row>
            </div>
          )}
        </div>
      </Section>

      <Section title="Regional">
        <div className="grid gap-3 sm:grid-cols-3">
          <Row label="Timezone"><Input className={input} defaultValue={businessProfile.timezone} /></Row>
          <Row label="Locale"><Input className={input} defaultValue={businessProfile.locale} /></Row>
          <Row label="Currency"><Input className={input} defaultValue={businessProfile.currency} /></Row>
        </div>
      </Section>

      <AuditLine>Last changed by {businessProfile.updatedBy} · {businessProfile.updatedAt}</AuditLine>
      <SaveBar note="Changes apply to documents created after saving." />
    </SettingsPage>
  );
}
