import { documentNumberMatchesSearch, parseLegacyJobNumberBase } from './documentNumbering';

type SearchableProductionJob = {
  id?: unknown; orderNumber?: unknown; displayNumber?: unknown; numberCore?: unknown;
  jobDescription?: unknown; media?: unknown; mediaLabel?: unknown; poNumber?: unknown;
  productionNotes?: unknown; internalNotes?: unknown;
  notes?: ReadonlyArray<{ text?: unknown }>;
  artwork?: ReadonlyArray<{ fileName?: unknown }>;
  order?: {
    orderNumber?: unknown; displayNumber?: unknown; numberCore?: unknown; customerName?: unknown; poNumber?: unknown;
    artwork?: ReadonlyArray<{ fileName?: unknown }>;
    lineItems?: { primary?: { description?: unknown; productFormalName?: unknown; materialName?: unknown } | null };
  };
};
/** Same read-only matching for the full authorized station response and API search callers. */
export function productionJobMatchesSearch(job: SearchableProductionJob, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return documentNumberMatchesSearch({ query: search, displayNumber: job.order?.displayNumber ?? job.displayNumber,
    numberCore: job.order?.numberCore ?? job.numberCore ?? parseLegacyJobNumberBase("order", job.order?.orderNumber ?? job.orderNumber), legacyNumber: job.order?.orderNumber ?? job.orderNumber }) || [
    job.id, job.order?.orderNumber ?? job.orderNumber, job.order?.customerName,
    job.order?.poNumber ?? job.poNumber, job.order?.lineItems?.primary?.description ?? job.jobDescription,
    job.order?.lineItems?.primary?.productFormalName,
    job.media ?? job.mediaLabel ?? job.order?.lineItems?.primary?.materialName,
    job.productionNotes, job.internalNotes, ...(job.notes ?? []).map(note => note.text),
    ...(job.artwork ?? []).map(file => file.fileName), ...(job.order?.artwork ?? []).map(file => file.fileName),
  ].some(value => String(value ?? '').toLowerCase().includes(query));
}
