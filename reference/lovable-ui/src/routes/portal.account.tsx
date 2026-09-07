import { createFileRoute, Link } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyValue, PortalPage, Section } from "@/components/portal/ui";
import { account } from "@/lib/portal/data";

export const Route = createFileRoute("/portal/account")({
  head: () => ({
    meta: [
      { title: "Your Account — Hensley Print Co." },
      { name: "description", content: "Company details, your contact information, addresses and sign-in security." },
      { property: "og:title", content: "Your Account — Hensley Print Co." },
      { property: "og:description", content: "Keep your contact details and addresses current." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AccountPage,
});

function AccountPage() {
  return (
    <PortalPage title="Account" description="Your company details and sign-in settings.">
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Company">
          <dl className="grid grid-cols-2 gap-4">
            <KeyValue label="Company" className="col-span-2">{account.company}</KeyValue>
            <KeyValue label="Payment terms">{account.terms}</KeyValue>
            <KeyValue label="Account representative">{account.accountRep}</KeyValue>
          </dl>
          <p className="mt-4 text-[12px] text-muted-foreground">
            Need a change to your company details or terms? Contact your account representative.
          </p>
        </Section>

        <Section title="Signed in as">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input id="name" defaultValue={account.contactName} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" defaultValue={account.email} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" defaultValue={account.phone} />
            </div>
            <Button size="sm">Save changes</Button>
          </div>
        </Section>

        <Section title="Addresses">
          <div className="grid gap-3 sm:grid-cols-2">
            {account.addresses.map((a) => (
              <div key={a.label} className="rounded-lg border border-border p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{a.label}</p>
                <address className="mt-1 whitespace-pre-line text-[13px] not-italic">{a.lines.join("\n")}</address>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Security">
          <div className="space-y-3">
            <Button variant="outline" size="sm">Change password</Button>
            <p className="text-[12px] text-muted-foreground">
              For your protection we&apos;ll email you whenever your password changes.
            </p>
            <div className="border-t border-border pt-3">
              <Button variant="ghost" size="sm" asChild>
                <Link to="/portal-login">
                  <LogOut className="mr-2 size-4" />
                  Sign out
                </Link>
              </Button>
            </div>
          </div>
        </Section>
      </div>
    </PortalPage>
  );
}
