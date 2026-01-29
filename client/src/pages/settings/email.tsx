import { TitanCard } from "@/components/titan";
import { EmailSettingsTab } from "@/components/admin-settings";

export function EmailSettings() {
  return (
    <TitanCard className="p-6">
      <div className="space-y-6">
        <div>
          <h2 className="text-titan-lg font-semibold text-titan-text-primary">Email Settings</h2>
          <p className="text-titan-sm text-titan-text-secondary mt-1">
            Configure email for sending invoices and quotes
          </p>
        </div>
        
        <div className="h-px bg-titan-border-subtle" />
        
        <div className="space-y-4">
          <EmailSettingsTab />
        </div>
      </div>
    </TitanCard>
  );
}

export default EmailSettings;
