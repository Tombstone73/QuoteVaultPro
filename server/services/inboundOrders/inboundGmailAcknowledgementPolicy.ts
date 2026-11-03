import { isWorkerEnabled } from '../../workers/workerGates';
import type { GmailAcknowledgementRollout } from '@shared/inboundGmailAcknowledgement';

export const acknowledgementOrganizations = () => [...new Set((process.env.INBOUND_GMAIL_ACK_ORGANIZATION_IDS ?? '').split(',').map(s => s.trim()).filter(s => s && s !== '*'))];
export const isGmailAcknowledgementEnabled = (organizationId?: string) => isWorkerEnabled('INBOUND_GMAIL_ACK', false)
  && acknowledgementOrganizations().length > 0 && (!organizationId || acknowledgementOrganizations().includes(organizationId));

/** Explain the same enforcement gates without exposing other tenants or credentials. */
export function gmailAcknowledgementRollout(organizationId: string): GmailAcknowledgementRollout {
  const enabled = isGmailAcknowledgementEnabled(organizationId);
  const global = process.env.WORKERS_ENABLED;
  const reason = enabled ? null : global !== undefined && global !== '' && global.toLowerCase() !== 'true'
    ? 'global_pause' : !isWorkerEnabled('INBOUND_GMAIL_ACK', false) ? 'worker_pause' : 'tenant_not_enrolled';
  const message = reason === 'global_pause' ? 'Gmail writes are paused by the global worker safety lock. Mailbox settings cannot override it.'
    : reason === 'worker_pause' ? 'Gmail writes are paused because the Gmail acknowledgement worker is disabled. An operator must activate this worker.'
    : reason === 'tenant_not_enrolled' ? 'Gmail writes are paused because this tenant is not enrolled in the operational rollout. Mailbox settings cannot enroll a tenant.'
    : 'Gmail acknowledgement is operationally enabled for this tenant. Each mailbox still requires explicit opt-in and Gmail modify authorization.';
  return { enabled, reason, message, organizationId };
}
