import { EmailSettingsTab } from "@/components/admin-settings";
import { TitanCard } from "@/components/titan";

export default function EmailProviderSettings() {
  return (
    <TitanCard className="p-6">
      <div className="space-y-6">
        <div>
          <h2 className="text-titan-lg font-semibold text-titan-text-primary">
            Email Provider
          </h2>
          <p className="text-titan-sm text-titan-text-secondary mt-1">
            Configure email sending via Gmail OAuth or SMTP
          </p>
        </div>
        <div className="h-px bg-titan-border-subtle" />
        <EmailSettingsTab />
      </div>
    </TitanCard>
  );
}
