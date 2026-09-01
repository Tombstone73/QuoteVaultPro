/**
 * client/src/lib/api/platform.ts
 * Frontend API helpers for platform-admin endpoints and public invite endpoints.
 */
import { getApiUrl } from "@/lib/apiConfig";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReauthResult {
  success: boolean;
  code?: string;
  message?: string;
}

export interface CreateOrgPayload {
  name: string;
  slug?: string;
  ownerEmail: string; // always required; owner invite is always created
  seedConfiguration?: {
    enabled: boolean;
    sourceOrganizationId?: string;
  };
}

export interface ConfigurationCopyJobResult {
  copyJobId?: string;
  id?: string;
  sourceOrganizationId: string;
  destinationOrganizationId: string;
  status: "pending" | "copying" | "completed" | "failed";
  requestedByUserId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  failedAt?: string | null;
  entityCounts: Record<string, number>;
  warnings: string[];
  errorSummary?: string | null;
  errorDetails?: Record<string, unknown> | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PlatformSeedOrganization {
  id: string;
  name: string;
  slug: string;
  status?: string;
  deleteState: string;
  isArchived?: boolean;
  archivedAt?: string | null;
  archivedByUserId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CustomerContactMigrationBatch {
  id: string;
  organizationId: string;
  status: string;
  sourceLabel?: string | null;
  qbSourceLabel?: string | null;
  infoFloCompanyFilename?: string | null;
  infoFloContactsFilename?: string | null;
  summaryJson?: Record<string, unknown> | null;
  errorMessage?: string | null;
  createdAt?: string;
  updatedAt?: string;
  finalizedAt?: string | null;
}

export interface CustomerContactMigrationBatchDetail {
  batch: CustomerContactMigrationBatch;
  companyRows: Array<Record<string, any>>;
  contactRows: Array<Record<string, any>>;
  relationshipRows: Array<Record<string, any>>;
  reviewContext?: {
    companyCandidates?: Record<string, any>;
    contactCandidates?: Record<string, any>;
    searchableCompanyCandidates?: Array<Record<string, any>>;
  };
  finalizePreview?: {
    companiesToCreate: number;
    companiesToUpdate: number;
    contactsToCreate: number;
    contactsToUpdate: number;
    relationshipsToCreate: number;
    relationshipsToUpdate: number;
    remainingUnresolved: number;
  };
}

export interface CustomerContactQuickBooksSourceStatus {
  connected: boolean;
  state: "connected" | "refreshing" | "degraded" | "needs_reauth" | "disconnected";
  authState: "connected" | "not_connected" | "needs_reauth";
  healthState: "ok" | "transient_error";
  healthMessage?: string;
  lastErrorAt?: string;
  lastErrorCode?: string | null;
  lastErrorMessage?: string | null;
  lastErrorStage?: string | null;
  lastErrorHttpStatus?: number | null;
  lastOAuthError?: string | null;
  lastOAuthErrorDescription?: string | null;
  lastSuccessfulRefreshAt?: string | null;
  lastSuccessfulRequestAt?: string | null;
  consecutiveTransientFailureCount?: number;
  requiresUserAction?: boolean;
  connectedCompanyName?: string | null;
  quickBooksCompanyId?: string | null;
  connectedAt?: string | null;
  expiresAt?: string | null;
  lastSuccessfulSyncAt?: string | null;
}

export interface CustomerContactQuickBooksSourceSnapshot {
  id: string;
  organizationId: string;
  sourceMode: "live" | "upload";
  status: string;
  connectedCompanyName?: string | null;
  quickBooksCompanyId?: string | null;
  lastSuccessfulSyncAt?: string | null;
  retrievedCount: number;
  apiError?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ConfigurationCopyPreview {
  sourceOrganizationId: string;
  sourceOrganizationName: string;
  sourceOrganizationSlug: string;
  entityCounts: Record<string, number>;
  warnings: string[];
}

export interface CreateOrgResult {
  success: boolean;
  data?: {
    orgId: string;
    slug: string;
    inviteLink: string;
    ownerEmail: string;
    configurationCopy?: ConfigurationCopyJobResult | null;
  };
  code?: string;
  message?: string;
}

export interface InvitePreviewResult {
  success: boolean;
  status: "valid" | "invalid" | "expired" | "used" | "error";
  kind?: "org" | "portal";
  email?: string;
  orgName?: string;
  orgId?: string;
  customerName?: string;
  displayName?: string | null;
  emailAlreadyRegistered?: boolean;
  expiresAt?: string;
  message?: string;
}

export interface AcceptInviteResult {
  success: boolean;
  kind?: "org" | "portal";
  redirectTo?: string;
  data?: {
    orgId: string;
    userId: string;
    email: string;
  };
  code?: string;
  message?: string;
  email?: string; // returned alongside PASSWORD_REQUIRED for display
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(getApiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
}

async function readJsonEnvelope<T extends { success: boolean; message?: string; code?: string }>(res: Response, fallbackMessage: string): Promise<T> {
  try {
    return await res.json();
  } catch {
    return {
      success: false,
      message: fallbackMessage,
    } as T;
  }
}

// ─── Platform-admin API calls ─────────────────────────────────────────────────

/**
 * Submit password for step-up authentication.
 * Returns { success: true } on match, { success: false } on mismatch.
 */
export async function platformReauth(password: string): Promise<ReauthResult> {
  const res = await postJson("/api/platform/reauth", { password });
  return res.json();
}

/**
 * Create a new organization (platform-admin only + step-up required).
 * Returns 404 for non-platform-admins.
 * Returns 401 { code: 'STEP_UP_REQUIRED' } when step-up is needed.
 */
export async function createPlatformOrg(
  payload: CreateOrgPayload
): Promise<{ httpStatus: number; body: CreateOrgResult }> {
  const res = await postJson("/api/platform/orgs", payload);
  const body: CreateOrgResult = await res.json();
  return { httpStatus: res.status, body };
}

export async function listPlatformSeedOrganizations(): Promise<{
  httpStatus: number;
  body: { success: boolean; data?: PlatformSeedOrganization[]; message?: string };
}> {
  const res = await fetch(getApiUrl("/api/platform/orgs"), { credentials: "include" });
  const body = await res.json();
  return { httpStatus: res.status, body };
}

export async function previewConfigurationCopy(sourceOrganizationId: string): Promise<{
  httpStatus: number;
  body: { success: boolean; data?: ConfigurationCopyPreview; message?: string; code?: string };
}> {
  const res = await fetch(
    getApiUrl(`/api/platform/orgs/${encodeURIComponent(sourceOrganizationId)}/configuration-copy-preview`),
    { credentials: "include" }
  );
  const body = await res.json();
  return { httpStatus: res.status, body };
}

export async function listConfigurationCopyJobs(limit = 10): Promise<{
  httpStatus: number;
  body: { success: boolean; data?: ConfigurationCopyJobResult[]; message?: string };
}> {
  const res = await fetch(
    getApiUrl(`/api/platform/organization-copy-jobs?limit=${encodeURIComponent(String(limit))}`),
    { credentials: "include" }
  );
  const body = await res.json();
  return { httpStatus: res.status, body };
}

export async function retryConfigurationCopyJob(jobId: string): Promise<{
  httpStatus: number;
  body: { success: boolean; data?: ConfigurationCopyJobResult; message?: string; code?: string };
}> {
  const res = await postJson(`/api/platform/organization-copy-jobs/${encodeURIComponent(jobId)}/retry`, {});
  const body = await res.json();
  return { httpStatus: res.status, body };
}

export async function updatePlatformOrganization(
  organizationId: string,
  payload: { name?: string; slug?: string; isArchived?: boolean }
): Promise<{
  httpStatus: number;
  body: { success: boolean; data?: PlatformSeedOrganization; message?: string; code?: string; details?: Record<string, unknown> };
}> {
  const res = await fetch(getApiUrl(`/api/platform/orgs/${encodeURIComponent(organizationId)}`), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  return { httpStatus: res.status, body };
}

// ─── Public invite API calls ───────────────────────────────────────────────────

/**
 * Preview an invite token — returns status and metadata without consuming it.
 * Returns { status: 'valid'|'invalid'|'expired'|'used' }
 */
export async function createCustomerContactMigrationBatch(payload: {
  organizationId: string;
  sourceLabel?: string;
  quickBooksSourceSnapshotId?: string;
  qbSourceLabel?: string;
  quickBooksCustomers?: Array<Record<string, unknown>>;
  infoFloCompanyCsv?: string;
  infoFloCompanyFilename?: string;
  infoFloContactsCsv?: string;
  infoFloContactsFilename?: string;
}): Promise<{
  httpStatus: number;
  body: { success: boolean; data?: { batch: CustomerContactMigrationBatch; summary: Record<string, unknown> }; message?: string; details?: unknown };
}> {
  const res = await postJson("/api/platform/customer-contact-migrations", payload);
  const body = await res.json();
  return { httpStatus: res.status, body };
}

export async function getCustomerContactMigrationQuickBooksSourceStatus(organizationId: string): Promise<{
  httpStatus: number;
  body: { success: boolean; data?: CustomerContactQuickBooksSourceStatus; message?: string };
}> {
  const res = await fetch(
    getApiUrl(`/api/platform/customer-contact-migrations/qb-source/status?organizationId=${encodeURIComponent(organizationId)}`),
    { credentials: "include" }
  );
  const body = await res.json();
  return { httpStatus: res.status, body };
}

export async function retrieveCustomerContactMigrationQuickBooksSource(organizationId: string): Promise<{
  httpStatus: number;
  body: {
    success: boolean;
    data?: {
      snapshot: CustomerContactQuickBooksSourceSnapshot;
      status: CustomerContactQuickBooksSourceStatus;
      retrievedAt: string;
      customerCount: number;
    };
    message?: string;
  };
}> {
  const res = await postJson("/api/platform/customer-contact-migrations/qb-source/retrieve", { organizationId });
  const body = await res.json();
  return { httpStatus: res.status, body };
}

export async function uploadCustomerContactMigrationQuickBooksSource(payload: {
  organizationId: string;
  quickBooksCustomers: Array<Record<string, unknown>>;
}): Promise<{
  httpStatus: number;
  body: {
    success: boolean;
    data?: {
      snapshot: CustomerContactQuickBooksSourceSnapshot;
      status?: CustomerContactQuickBooksSourceStatus | null;
      retrievedAt: string;
      customerCount: number;
    };
    message?: string;
  };
}> {
  const res = await postJson("/api/platform/customer-contact-migrations/qb-source/upload", payload);
  const body = await res.json();
  return { httpStatus: res.status, body };
}

export async function listCustomerContactMigrationBatches(organizationId: string, limit = 25): Promise<{
  httpStatus: number;
  body: { success: boolean; data?: CustomerContactMigrationBatch[]; message?: string };
}> {
  const res = await fetch(
    getApiUrl(`/api/platform/customer-contact-migrations?organizationId=${encodeURIComponent(organizationId)}&limit=${encodeURIComponent(String(limit))}`),
    { credentials: "include" }
  );
  const body = await res.json();
  return { httpStatus: res.status, body };
}

export async function getCustomerContactMigrationBatch(organizationId: string, batchId: string): Promise<{
  httpStatus: number;
  body: { success: boolean; data?: CustomerContactMigrationBatchDetail; message?: string };
}> {
  const res = await fetch(
    getApiUrl(`/api/platform/customer-contact-migrations/${encodeURIComponent(batchId)}?organizationId=${encodeURIComponent(organizationId)}`),
    { credentials: "include" }
  );
  const body = await res.json();
  return { httpStatus: res.status, body };
}

export async function finalizeCustomerContactMigrationBatch(
  organizationId: string,
  batchId: string,
  allowUnresolvedSkips = false,
): Promise<{
  httpStatus: number;
  body: { success: boolean; data?: { batch: CustomerContactMigrationBatch; counts: Record<string, number> }; message?: string; code?: string };
}> {
  const res = await postJson(`/api/platform/customer-contact-migrations/${encodeURIComponent(batchId)}/finalize`, {
    organizationId,
    confirmation: "FINALIZE",
    allowUnresolvedSkips,
  });
  const body = await readJsonEnvelope<{ success: boolean; data?: { batch: CustomerContactMigrationBatch; counts: Record<string, number> }; message?: string; code?: string }>(
    res,
    "Finalize failed because the server returned an empty or invalid response.",
  );
  return { httpStatus: res.status, body };
}

export async function saveCustomerContactMigrationReviewDecision(payload: {
  organizationId: string;
  batchId: string;
  recordType: "company" | "contact";
  recordId: string;
  action: "accept_proposed" | "choose_existing" | "create_new" | "select_staged" | "consolidate_staged" | "link_company" | "ignore";
  selectedEntityId?: string;
  selectedEntityIds?: string[];
}): Promise<{
  httpStatus: number;
  body: { success: boolean; data?: CustomerContactMigrationBatchDetail; message?: string };
}> {
  const res = await postJson(`/api/platform/customer-contact-migrations/${encodeURIComponent(payload.batchId)}/review-decision`, {
    organizationId: payload.organizationId,
    recordType: payload.recordType,
    recordId: payload.recordId,
    action: payload.action,
    selectedEntityId: payload.selectedEntityId,
    selectedEntityIds: payload.selectedEntityIds,
  });
  const body = await res.json();
  return { httpStatus: res.status, body };
}

export function customerContactMigrationReportUrl(organizationId: string, batchId: string, kind: string): string {
  return getApiUrl(
    `/api/platform/customer-contact-migrations/${encodeURIComponent(batchId)}/report/${encodeURIComponent(kind)}?organizationId=${encodeURIComponent(organizationId)}`
  );
}

export async function previewInvite(token: string): Promise<{ httpStatus: number; body: InvitePreviewResult }> {
  const res = await fetch(
    getApiUrl(`/api/invites/preview?token=${encodeURIComponent(token)}`),
    { credentials: "include" }
  );
  const body: InvitePreviewResult = await res.json();
  return { httpStatus: res.status, body };
}

export async function previewPortalInvite(token: string): Promise<{ httpStatus: number; body: InvitePreviewResult }> {
  const res = await fetch(
    getApiUrl(`/api/customer-portal/invites/preview?token=${encodeURIComponent(token)}`),
    { credentials: "include" }
  );
  const body: InvitePreviewResult = await res.json();
  return { httpStatus: res.status, body };
}

/**
 * Accept an invite. Pass password only for new users (emailAlreadyRegistered=false).
 * On success, a session cookie is set and the user is logged in.
 */
export async function acceptInvite(
  token: string,
  password?: string
): Promise<{ httpStatus: number; body: AcceptInviteResult }> {
  const res = await postJson("/api/invites/accept", { token, password });
  const body: AcceptInviteResult = await res.json();
  return { httpStatus: res.status, body };
}

export async function acceptPortalInvite(
  token: string,
  password: string,
  returnTo?: string
): Promise<{ httpStatus: number; body: AcceptInviteResult }> {
  const res = await postJson("/api/customer-portal/invites/accept", { token, password, returnTo });
  const body: AcceptInviteResult = await res.json();
  return { httpStatus: res.status, body };
}
