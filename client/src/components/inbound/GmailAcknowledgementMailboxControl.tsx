import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import type { InboundEmailMailboxView } from '@shared/inboundEmailMailboxes';
import type { GmailAcknowledgementOverview } from '@shared/inboundGmailAcknowledgement';

export function GmailAcknowledgementMailboxControl({ mailbox, disabled, onChange }: {
  mailbox: InboundEmailMailboxView; disabled: boolean; onChange: (enabled: boolean) => void;
}) {
  const overview = useQuery<GmailAcknowledgementOverview>({
    queryKey: ['/api/inbound-orders/gmail-acknowledgements/overview'],
    queryFn: async () => (await apiRequest('GET', '/api/inbound-orders/gmail-acknowledgements/overview')).json(),
    enabled: mailbox.provider === 'gmail', refetchInterval: 15_000, retry: false,
  });
  if (mailbox.provider !== 'gmail') return null;
  const rollout = overview.data?.rollout;
  const summary = overview.data?.mailboxes?.find(item => item.mailboxId === mailbox.id);
  const permission = mailbox.acknowledgementPermission === 'available';
  const enabled = permission && mailbox.enabled && mailbox.settings.gmailAcknowledgementEnabled && rollout?.enabled === true && !overview.isError;
  const status = !permission ? 'Permission Required' : enabled ? 'Enabled' : 'Paused';
  return <section className="mt-3 min-w-64 space-y-2 rounded-md border border-border bg-muted/30 p-3 text-foreground" aria-label={`Gmail acknowledgement for ${mailbox.emailAddress}`}>
    <label className="flex items-start gap-2 text-xs font-medium">
      <Switch checked={mailbox.settings.gmailAcknowledgementEnabled} disabled={disabled}
        aria-label={`Automatically acknowledge entered Orders in Gmail for ${mailbox.emailAddress}`} onCheckedChange={onChange} />
      Automatically acknowledge entered Orders in Gmail
    </label>
    <div role="status" className="space-y-1 text-xs">
      <Badge variant="outline" className="border-border bg-background text-foreground transition-none">{status}</Badge>
      <p>Authorization: {permission ? 'Gmail modify permission recorded; the active token and account are checked before every update.' : 'Reconnect this same mailbox with Gmail modify permission.'}</p>
      {rollout && !rollout.enabled && <p>{rollout.message}</p>}
      {!mailbox.enabled && <p>This mailbox is disabled. Enable it to allow its opted-in updates.</p>}
      {!mailbox.settings.gmailAcknowledgementEnabled && <p>This mailbox is paused by its tenant-controlled preference.</p>}
      {(!rollout || overview.isError) && <p>Operational activation status is unavailable. Refresh to check the safety locks; this preference cannot override them.</p>}
      <p>Pending: {overview.isSuccess ? summary?.pendingCount ?? 0 : 'Unavailable'} · Failed / needs attention: {overview.isSuccess ? summary?.failedCount ?? 0 : 'Unavailable'}</p>
      <p>Last successful acknowledgement: {summary?.lastSucceededAt ? new Date(summary.lastSucceededAt).toLocaleString() : overview.isSuccess ? 'None recorded' : 'Unavailable'}</p>
      {summary?.lastError && <p>{summary.lastError}</p>}
    </div>
    <p className="text-xs text-muted-foreground">Applies to future Order linkages and retained pending updates. Existing historical Orders are not automatically backfilled. Gmail changes only the covered messages after an Order is durably linked.</p>
    {rollout && !rollout.enabled && <details className="text-xs">
      <summary className="cursor-pointer font-medium focus-visible:outline focus-visible:outline-2">Operational activation requirement</summary>
      <p className="mt-1">An authorized operator must permit the Gmail acknowledgement worker and enroll this tenant. The global safety lock remains authoritative.</p>
      <p className="break-all">Tenant: {rollout.organizationId}</p>
      <p>Changing the global worker switch can affect other workers. Review their controls before operational activation.</p>
    </details>}
  </section>;
}
