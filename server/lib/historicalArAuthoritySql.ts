import { sql } from 'drizzle-orm';
import { invoices } from '@shared/schema';

/** Mirrors the shared authority resolver in database-side balance filters. */
export const approvedImportedArSql = sql`(
  ${invoices.historicalArState} = 'historical_open_ar_reconciled'
  and ${invoices.historicalArSourceBalanceCents} > 0
  and ${invoices.historicalArApprovedAt} is not null
  and ${invoices.historicalArApprovedByUserId} is not null
  and ${invoices.historicalArApprovalEvidence} is not null
  and jsonb_typeof(${invoices.historicalArApprovalEvidence}) = 'object'
  and ${invoices.historicalArApprovalEvidence} ?& array['sourceInvoiceId','customerId','sourceStatus','sourceDate','paymentEvidence','originalCents','remainingCents']
  and ${invoices.historicalArApprovalEvidence} ->> 'sourceInvoiceId' <> ''
  and ${invoices.historicalArApprovalEvidence} ->> 'customerId' <> ''
  and ${invoices.historicalArApprovalEvidence} ->> 'sourceStatus' <> ''
  and ${invoices.historicalArApprovalEvidence} ->> 'sourceDate' <> ''
  and ${invoices.historicalArApprovalEvidence} ->> 'paymentEvidence' <> ''
  and ${invoices.historicalArApprovalEvidence} ->> 'customerId' = ${invoices.customerId}
  and ${invoices.historicalArApprovalEvidence} ->> 'sourceInvoiceId' = coalesce(${invoices.externalAccountingId}, ${invoices.qbInvoiceId})
  and case when jsonb_typeof(${invoices.historicalArApprovalEvidence} -> 'remainingCents') = 'number'
    then (${invoices.historicalArApprovalEvidence} ->> 'remainingCents')::numeric = ${invoices.historicalArSourceBalanceCents}
    else false end
  and case when jsonb_typeof(${invoices.historicalArApprovalEvidence} -> 'originalCents') = 'number'
    then (${invoices.historicalArApprovalEvidence} ->> 'originalCents')::numeric = ${invoices.totalCents}
      and (${invoices.historicalArApprovalEvidence} ->> 'originalCents')::numeric >= ${invoices.historicalArSourceBalanceCents}
      and mod((${invoices.historicalArApprovalEvidence} ->> 'originalCents')::numeric, 1) = 0
    else false end
)`;

export const importedHistoricalInvoiceSql = sql`(
  nullif(trim(coalesce(${invoices.importSource}, '')), '') is not null
  or ${invoices.importedAt} is not null
  or coalesce(${invoices.isHistorical}, false)
  or ${invoices.historicalArState} is not null
)`;
