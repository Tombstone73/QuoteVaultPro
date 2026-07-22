import crypto from "node:crypto";
import { customerSafeReportDefinition, reportDefinitionSchema, type ReportDefinition } from "@shared/aiReportingContracts";
import {
  AssistantReportsRepository,
  sanitizeCustomerSafeSnapshot,
  type AssistantReportRecord,
  type AssistantReportShareRecord,
  type AssistantReportViewRecord,
  type PublicSharedReportRecord,
} from "../../storage/assistantReports.repo";

const DEFAULT_SHARE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_SHARE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export interface ReportShareRepository {
  get(organizationId: string, reportId: string): Promise<AssistantReportRecord | null>;
  createShare(input: {
    organizationId: string;
    reportId: string;
    tokenHash: string;
    audience: "shared_link" | "customer_safe";
    expiresAt: Date;
    downloadAllowed: boolean;
    createdByUserId: string;
  }): Promise<AssistantReportShareRecord | null>;
  revokeShare(organizationId: string, reportId: string, shareId: string, now?: Date): Promise<boolean>;
  resolveActiveShare(tokenHash: string, now?: Date): Promise<PublicSharedReportRecord | null>;
  recordShareView(input: { organizationId: string; reportId: string; shareId: string; viewerHash?: string | null; viewedAt?: Date }): Promise<AssistantReportViewRecord>;
}

export interface ReportShareServiceDependencies {
  repository?: ReportShareRepository;
  now?: () => Date;
  generateToken?: () => string;
}

export type IssueReportShareResult =
  | { kind: "issued"; token: string; shareId: string; expiresAt: string; downloadAllowed: boolean }
  | { kind: "not_found" | "forbidden" | "not_customer_safe" | "invalid_expiration" };

export type ResolvePublicReportResult =
  | { kind: "available"; report: PublicReportRenderModel }
  | { kind: "unavailable" };

/** The only shape a public route should serialize. It deliberately omits IDs,
 * source links, query plans, diagnostics, and the raw analytical dataset. */
export interface PublicReportRenderModel {
  title: string;
  description: string | null;
  definition: ReportDefinition;
  dataSnapshotAt: string;
  expiresAt: string;
  downloadAllowed: boolean;
}

export function hashReportShareToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export function generateOpaqueReportShareToken(): string {
  // 256 bits of entropy, URL-safe and opaque. Only its SHA-256 digest is stored.
  return crypto.randomBytes(32).toString("base64url");
}

function isOpaqueToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(value);
}

function publicDefinition(definition: ReportDefinition): ReportDefinition {
  // Parsing again protects the public boundary from legacy malformed JSON.
  return customerSafeReportDefinition(reportDefinitionSchema.parse(definition));
}

export class ReportSharingService {
  private readonly repository: ReportShareRepository;
  private readonly now: () => Date;
  private readonly generateToken: () => string;

  constructor(deps: ReportShareServiceDependencies = {}) {
    this.repository = deps.repository ?? new AssistantReportsRepository();
    this.now = deps.now ?? (() => new Date());
    this.generateToken = deps.generateToken ?? generateOpaqueReportShareToken;
  }

  async issue(input: {
    organizationId: string;
    reportId: string;
    actorUserId: string;
    canManageOrganizationReports?: boolean;
    expiresAt?: Date;
    downloadAllowed?: boolean;
  }): Promise<IssueReportShareResult> {
    const report = await this.repository.get(input.organizationId, input.reportId);
    if (!report || report.archivedAt || report.status !== "ready") return { kind: "not_found" };
    if (report.ownerUserId !== input.actorUserId && !input.canManageOrganizationReports) return { kind: "forbidden" };

    // A public link is only issued for a customer-safe persisted variant. This
    // prevents publishing an internal report and attempting redaction at view time.
    if (report.audience !== "customer_safe" || report.definition.audience !== "customer_safe") {
      return { kind: "not_customer_safe" };
    }
    const now = this.now();
    const expiresAt = input.expiresAt ?? new Date(now.getTime() + DEFAULT_SHARE_TTL_MS);
    if (expiresAt.getTime() <= now.getTime() || expiresAt.getTime() - now.getTime() > MAX_SHARE_TTL_MS) {
      return { kind: "invalid_expiration" };
    }

    // The uniqueness index is a final guard. Retrying makes an astronomically
    // unlikely token collision harmless without ever persisting plaintext.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = this.generateToken();
      if (!isOpaqueToken(token)) throw new Error("Report share token generator returned an unsafe token.");
      const share = await this.repository.createShare({
        organizationId: input.organizationId, reportId: report.id, tokenHash: hashReportShareToken(token),
        audience: "customer_safe", expiresAt, downloadAllowed: input.downloadAllowed === true,
        createdByUserId: input.actorUserId,
      });
      if (share) return { kind: "issued", token, shareId: share.id, expiresAt: share.expiresAt.toISOString(), downloadAllowed: share.downloadAllowed };
    }
    throw new Error("Unable to issue a secure report share link.");
  }

  async revoke(input: { organizationId: string; reportId: string; shareId: string; actorUserId: string; canManageOrganizationReports?: boolean }): Promise<"revoked" | "not_found" | "forbidden"> {
    const report = await this.repository.get(input.organizationId, input.reportId);
    if (!report) return "not_found";
    if (report.ownerUserId !== input.actorUserId && !input.canManageOrganizationReports) return "forbidden";
    return (await this.repository.revokeShare(input.organizationId, input.reportId, input.shareId, this.now())) ? "revoked" : "not_found";
  }

  async resolvePublic(token: string, anonymousViewerId?: string | null): Promise<ResolvePublicReportResult> {
    // Do not reveal whether a malformed, expired, revoked, or unknown token exists.
    if (!isOpaqueToken(token)) return { kind: "unavailable" };
    const resolved = await this.repository.resolveActiveShare(hashReportShareToken(token), this.now());
    if (!resolved || resolved.share.audience !== "customer_safe" || resolved.report.audience !== "customer_safe") return { kind: "unavailable" };

    // The raw snapshot is intentionally touched only as a defensive redaction
    // check. Public rendering receives the validated persisted definition, not
    // arbitrary report data or live query results.
    sanitizeCustomerSafeSnapshot(resolved.report.dataSnapshot);
    // Auditing must never make a valid public report unavailable. The caller
    // supplies an optional anonymous/session value; only its hash is persisted.
    try {
      await this.repository.recordShareView({
        organizationId: resolved.share.organizationId,
        reportId: resolved.report.id,
        shareId: resolved.share.id,
        viewerHash: anonymousViewerId ? hashReportShareToken(anonymousViewerId) : null,
        viewedAt: this.now(),
      });
    } catch {
      // Deliberately fail soft: public rendering is independent from telemetry.
    }
    return {
      kind: "available",
      report: {
        title: resolved.report.title,
        description: resolved.report.description,
        definition: publicDefinition(resolved.report.definition),
        dataSnapshotAt: resolved.report.dataSnapshotAt.toISOString(),
        expiresAt: resolved.share.expiresAt.toISOString(),
        downloadAllowed: resolved.share.downloadAllowed,
      },
    };
  }
}

export const reportSharingService = new ReportSharingService();
