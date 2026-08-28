import { createFileRoute } from "@tanstack/react-router";
import { Mail, Plus, Users } from "lucide-react";
import { EmptyBlock, ReadyChip, SettingsPage, Unavailable } from "@/components/app/settings/shared";
import { Button } from "@/components/ui/button";
import { portalAccess } from "@/lib/mock/settings";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_shell/settings/portal-access")({
  head: () => ({
    meta: [
      { title: "Customer Portal Access — PrintersHero V2 Settings" },
      { name: "description", content: "Manage which customer contacts can reach the customer portal and what they can do there." },
      { property: "og:title", content: "Customer Portal Access — PrintersHero V2 Settings" },
      { property: "og:description", content: "External customer access, kept separate from staff." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PortalAccessPage,
});

const stateCls: Record<string, string> = {
  Active: "text-ok border-ok bg-ok/20",
  "Invitation pending": "text-warn border-warn bg-warn/20",
  Disabled: "text-muted-foreground border-border bg-transparent",
};

function PortalAccessPage() {
  return (
    <SettingsPage
      title="Customer Portal Access"
      description="These are customers, not employees. Portal access never grants access to your shop's internal workspace."
      actions={<Button size="sm" className="h-8 gap-1.5 text-[12px]"><Plus className="size-3.5" /> Invite customer contact</Button>}
    >
      <div className="flex items-start gap-2 rounded-lg border border-info/40 bg-info/10 px-3 py-2.5 text-[12px]">
        <Users className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <span>Customer contacts are owned by Customers. Portal access only controls whether an existing contact can sign in to the portal.</span>
      </div>

      <div className="panel overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Contact</th>
              <th className="hidden px-3 py-2 sm:table-cell">Access</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {portalAccess.map((p) => (
              <tr key={p.id} className="text-[13px]">
                <td className="px-3 py-2 font-medium">{p.customer}</td>
                <td className="px-3 py-2">
                  <div>{p.contact}</div>
                  <div className="text-[11px] text-muted-foreground">{p.email}</div>
                </td>
                <td className="hidden px-3 py-2 sm:table-cell">{p.access}</td>
                <td className="px-3 py-2">
                  <span className={cn("inline-flex whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium", stateCls[p.state])}>
                    {p.state}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-1.5">
                    {p.state === "Invitation pending" && (
                      <Button size="sm" variant="outline" className="h-7 gap-1 text-[12px]"><Mail className="size-3.5" /> Resend</Button>
                    )}
                    <Button size="sm" variant="outline" className="h-7 text-[12px]">Edit access</Button>
                    {p.state !== "Disabled"
                      ? <Button size="sm" variant="ghost" className="h-7 text-[12px] text-late hover:text-late">Revoke</Button>
                      : <Button size="sm" variant="ghost" className="h-7 text-[12px]">Restore</Button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Unavailable>
        Detailed portal capabilities are still being finalized. Today access is either full portal or view only; more granular
        portal permissions will appear here when they are supported.
      </Unavailable>

      <EmptyBlock
        title="No customer contacts have portal access"
        body="Portal access lets a customer see their quotes, approve proofs and view invoices without calling the shop. Invite a contact from an existing customer record to get started."
        action={<div className="flex gap-2"><ReadyChip state="optional" label="Optional" /><Button size="sm" variant="outline" className="h-8 text-[12px]">Invite customer contact</Button></div>}
      />
    </SettingsPage>
  );
}
