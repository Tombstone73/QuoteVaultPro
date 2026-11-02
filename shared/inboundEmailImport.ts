export type InboundEmailImportStatus = 'waiting' | 'importing' | 'retrying' | 'complete' | 'needs_attention' | 'failed' | 'skipped';
export const inboundEmailImportLabels: Record<InboundEmailImportStatus, string> = {
  waiting: 'Waiting to import', importing: 'Importing email evidence', retrying: 'Import retry scheduled',
  complete: 'Email evidence imported', needs_attention: 'Import needs attention', failed: 'Import failed', skipped: 'Excluded by intake policy',
};
export const INBOUND_IMPORT_LEASE_MS = 5 * 60_000;
export const INBOUND_IMPORT_MAX_ATTEMPTS = 3;
export type InboundEmailImportView = {
  workKind: 'message' | 'discovery';
  id: string; mailboxId: string; inboundRecordId: string | null; status: InboundEmailImportStatus;
  attempts: number; nextAttemptAt: string; errorCode: string | null; message: string | null; canRetry: boolean;
};
