// Transport budget leaves time for the server to persist a bounded failure.
export const INBOUND_PARSE_WORK_MS = 90_000;
export const INBOUND_PARSE_PERSIST_MS = 15_000;
export const INBOUND_PARSE_REQUEST_MS = 120_000;

export type InboundParseOperation = {
  id: string;
  expiresAt: number;
  automaticClaimHash?: string;
  automaticJobId?: string;
};

export function readInboundParseOperation(value: unknown): InboundParseOperation | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || typeof candidate.expiresAt !== 'number' || !Number.isFinite(candidate.expiresAt)) return null;
  return {
    id: candidate.id,
    expiresAt: candidate.expiresAt,
    ...(typeof candidate.automaticClaimHash === 'string' ? { automaticClaimHash: candidate.automaticClaimHash } : {}),
    ...(typeof candidate.automaticJobId === 'string' ? { automaticJobId: candidate.automaticJobId } : {}),
  };
}
