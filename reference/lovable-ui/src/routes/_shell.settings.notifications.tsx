import { createFileRoute } from "@tanstack/react-router";
import { User } from "lucide-react";
import { ReadyChip, Section, SettingsPage, Unavailable } from "@/components/app/settings/shared";
import { Switch } from "@/components/ui/switch";
import { notificationGroups } from "@/lib/mock/settings";

export const Route = createFileRoute("/_shell/settings/notifications")({
  head: () => ({
    meta: [
      { title: "My Notifications — PrintersHero V2 Settings" },
      { name: "description", content: "Preview of the workflow alerts, assignments and due-date reminders you will be able to control from your account." },
      { property: "og:title", content: "My Notifications — PrintersHero V2 Settings" },
      { property: "og:description", content: "Personal notification preferences." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: NotificationsPage,
});

function NotificationsPage() {
  return (
    <SettingsPage
      title="My Preferences · Notifications"
      description="These settings will apply only to you."
      actions={<ReadyChip state="not-configured" label="Not available yet" />}
    >
      <Unavailable>
        Preview — notification preferences are not available yet. The structure below shows what you will be able to control;
        nothing here is saved.
      </Unavailable>

      <div className="flex items-start gap-2 rounded-lg border border-info/40 bg-info/10 px-3 py-2.5 text-[12px]">
        <User className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <span>Notifications never change who can see a record — only whether you are told about it.</span>
      </div>

      {notificationGroups.map((g) => (
        <Section key={g.group} title={g.group}>
          <div className="panel overflow-hidden opacity-70">
            <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-border bg-surface-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span>Alert</span><span className="w-14 text-center">In app</span><span className="w-14 text-center">Email</span>
            </div>
            <ul className="divide-y divide-border">
              {g.items.map((i) => (
                <li key={i.label} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-[13px]">{i.label}</div>
                    <div className="text-[11px] text-muted-foreground">{i.hint}</div>
                  </div>
                  <div className="flex w-14 justify-center"><Switch checked disabled /></div>
                  <div className="flex w-14 justify-center"><Switch checked={false} disabled /></div>
                </li>
              ))}
            </ul>
          </div>
        </Section>
      ))}
    </SettingsPage>
  );
}
