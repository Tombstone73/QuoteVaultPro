import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { principalSubject, staffActorId, type Principal } from "../../src/authorization/principals.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import {
  businessProfileReadiness,
  type BusinessProfile,
  type DocumentsBranding,
  type OrganizationAddress,
  type OrganizationSettings,
  type OrganizationSettingsSaveTrace,
  type SaveBusinessProfile,
  type SaveDocumentsBranding,
} from "../../src/modules/organization/businessProfile.js";
import { PostgresOperationRequestRepository } from "../persistence/postgresOperationRequests.js";

type AddressRecord = Readonly<{ line1?: unknown; line2?: unknown; city?: unknown; state?: unknown; region?: unknown; postalCode?: unknown; country?: unknown; enabled?: unknown }>;
type OrganizationRow = Readonly<{ id: string; name: string; settings: unknown; updated_at: Date }>;
type SettingsRow = Readonly<{
  id: string; company_name: string; company_display_name: string | null; legal_company_name: string | null; address: string | null;
  physical_address: unknown; remittance_address: unknown; phone: string | null; email: string | null; website: string | null;
  invoice_logo_asset_id: string | null; invoice_logo_url: string | null; logo_url: string | null; invoice_payment_instructions: string | null;
  invoice_footer_note: string | null; checks_payable_to: string | null; updated_at: Date;
}>;

const text = (value: unknown): string | undefined => typeof value === "string" && value.trim() ? value.trim() : undefined;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const address = (value: unknown): OrganizationAddress => {
  const source = value as AddressRecord | null;
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const region = text(source.region) ?? text(source.state);
  return {
    ...(text(source.line1) ? { line1: text(source.line1)! } : {}), ...(text(source.line2) ? { line2: text(source.line2)! } : {}),
    ...(text(source.city) ? { city: text(source.city)! } : {}), ...(region ? { region } : {}),
    ...(text(source.postalCode) ? { postalCode: text(source.postalCode)! } : {}), ...(text(source.country) ? { country: text(source.country)! } : {}),
  };
};
const formatAddress = (input: OrganizationAddress): string | undefined => {
  const locality = [input.city, [input.region, input.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const result = [input.line1, input.line2, locality, input.country].filter(Boolean).join("\n").trim();
  return result || undefined;
};
const revision = (organization: OrganizationRow, settings: SettingsRow | undefined) => `${organization.updated_at.toISOString()}:${settings?.updated_at.toISOString() ?? "none"}`;
const settingsValue = (organization: OrganizationRow, company: SettingsRow | undefined): OrganizationSettings => {
  const values = record(organization.settings);
  const profile: BusinessProfile = {
    displayName: text(company?.company_display_name) ?? text(company?.company_name) ?? organization.name,
    ...(text(company?.legal_company_name) ? { legalName: text(company?.legal_company_name)! } : {}),
    ...(text(company?.phone) ? { phone: text(company?.phone)! } : {}), ...(text(company?.email) ? { email: text(company?.email)! } : {}), ...(text(company?.website) ? { website: text(company?.website)! } : {}),
    businessAddress: Object.keys(address(company?.physical_address)).length ? address(company?.physical_address) : {},
    pickupAddressSource: "business_address",
    ...(text(values.timezone) ? { timeZone: text(values.timezone)! } : {}), ...(text(values.currency) ? { currency: text(values.currency)! } : {}),
  };
  const remittance = address(company?.remittance_address);
  const documentsBranding: DocumentsBranding = {
    logo: { status: text(company?.invoice_logo_asset_id) || text(company?.invoice_logo_url) || text(company?.logo_url) ? "configured" : "not_configured" },
    ...(text(company?.invoice_footer_note) ? { footerNote: text(company?.invoice_footer_note)! } : {}),
    ...(text(company?.invoice_payment_instructions) ? { paymentInstructions: text(company?.invoice_payment_instructions)! } : {}),
    ...(text(company?.checks_payable_to) ? { checksPayableTo: text(company?.checks_payable_to)! } : {}),
    ...(Object.keys(remittance).length ? { remittanceAddress: remittance } : {}),
  };
  return { businessProfile: profile, documentsBranding, readiness: businessProfileReadiness(profile), revision: revision(organization, company) };
};

/** V2 adopts the existing tenant-owned company_settings row. It does not create another profile authority. */
export class PostgresOrganizationSettings {
  private readonly requests = new PostgresOperationRequestRepository();
  constructor(private readonly pool: Pool) {}

  async read(organizationId: string): Promise<OrganizationSettings> {
    const client = this.pool;
    const organization = await this.organization(client, organizationId, false);
    const company = await this.company(client, organizationId, false);
    return settingsValue(organization, company ?? undefined);
  }

  async saveBusinessProfile(organizationId: string, input: SaveBusinessProfile, principal: Principal, requestId: string, trace?: OrganizationSettingsSaveTrace): Promise<OrganizationSettings> {
    return this.save(organizationId, input, principal, requestId, "organization.business_profile.configure.v1", "business_profile_updated", trace, async (client, organization, company) => {
      const prior = settingsValue(organization, company ?? undefined);
      this.assertRevision(prior, input.expectedRevision);
      const organizationSettings = { ...record(organization.settings), ...(input.timeZone ? { timezone: input.timeZone } : {}), ...(input.currency ? { currency: input.currency } : {}) };
      await client.query("UPDATE organizations SET settings=$2::jsonb,updated_at=now() WHERE id=$1", [organizationId, JSON.stringify(organizationSettings)]);
      const dbAddress = { line1: input.businessAddress.line1 ?? null, line2: input.businessAddress.line2 ?? null, city: input.businessAddress.city ?? null, state: input.businessAddress.region ?? null, postalCode: input.businessAddress.postalCode ?? null, country: input.businessAddress.country ?? null };
      if (company) await client.query("UPDATE company_settings SET company_name=$3,company_display_name=$3,legal_company_name=$4,address=$5,physical_address=$6::jsonb,phone=$7,email=$8,website=$9,updated_at=now() WHERE organization_id=$1 AND id=$2", [organizationId, company.id, input.displayName, input.legalName ?? null, formatAddress(input.businessAddress) ?? null, JSON.stringify(dbAddress), input.phone ?? null, input.email ?? null, input.website ?? null]);
      else await client.query("INSERT INTO company_settings(organization_id,company_name,company_display_name,legal_company_name,address,physical_address,phone,email,website) VALUES($1,$2,$2,$3,$4,$5::jsonb,$6,$7,$8)", [organizationId, input.displayName, input.legalName ?? null, formatAddress(input.businessAddress) ?? null, JSON.stringify(dbAddress), input.phone ?? null, input.email ?? null, input.website ?? null]);
      const afterOrganization = await this.organization(client, organizationId, true);
      const afterCompany = await this.company(client, organizationId, true);
      return { before: prior, after: settingsValue(afterOrganization, afterCompany ?? undefined) };
    });
  }

  async saveDocumentsBranding(organizationId: string, input: SaveDocumentsBranding, principal: Principal, requestId: string, trace?: OrganizationSettingsSaveTrace): Promise<OrganizationSettings> {
    return this.save(organizationId, input, principal, requestId, "organization.documents_branding.configure.v1", "documents_branding_updated", trace, async (client, organization, company) => {
      const prior = settingsValue(organization, company ?? undefined);
      this.assertRevision(prior, input.expectedRevision);
      const remit = input.remittanceAddress ? { line1: input.remittanceAddress.line1 ?? null, line2: input.remittanceAddress.line2 ?? null, city: input.remittanceAddress.city ?? null, state: input.remittanceAddress.region ?? null, postalCode: input.remittanceAddress.postalCode ?? null, country: input.remittanceAddress.country ?? null, enabled: true } : null;
      if (company) await client.query("UPDATE company_settings SET invoice_footer_note=$3,invoice_payment_instructions=$4,checks_payable_to=$5,remittance_address=$6::jsonb,updated_at=now() WHERE organization_id=$1 AND id=$2", [organizationId, company.id, input.footerNote ?? null, input.paymentInstructions ?? null, input.checksPayableTo ?? null, JSON.stringify(remit)]);
      else await client.query("INSERT INTO company_settings(organization_id,company_name,invoice_footer_note,invoice_payment_instructions,checks_payable_to,remittance_address) VALUES($1,$2,$3,$4,$5,$6::jsonb)", [organizationId, organization.name, input.footerNote ?? null, input.paymentInstructions ?? null, input.checksPayableTo ?? null, JSON.stringify(remit)]);
      const afterOrganization = await this.organization(client, organizationId, true);
      const afterCompany = await this.company(client, organizationId, true);
      return { before: prior, after: settingsValue(afterOrganization, afterCompany ?? undefined) };
    });
  }

  private async save<T extends { expectedRevision: string }>(organizationId: string, input: T, principal: Principal, requestId: string, operation: string, eventType: string, trace: OrganizationSettingsSaveTrace | undefined, work: (client: PoolClient, organization: OrganizationRow, company: SettingsRow | null) => Promise<Readonly<{ before: OrganizationSettings; after: OrganizationSettings }>>): Promise<OrganizationSettings> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN"); trace?.("repository_transaction_started");
      const reservation = await this.requests.reserve(client, { organizationId, operation, businessRequestId: requestId, payloadFingerprint: createHash("sha256").update(JSON.stringify(input)).digest("hex"), principalKind: principal.kind, principalSubject: principalSubject(principal), staffActorUserId: staffActorId(principal) });
      if (reservation.kind === "replay") { await client.query("COMMIT"); trace?.("durable_request_replayed"); trace?.("transaction_committed"); return reservation.request.resultJson as OrganizationSettings; }
      trace?.("durable_request_started");
      const organization = await this.organization(client, organizationId, true);
      const company = await this.company(client, organizationId, true);
      trace?.("settings_locked");
      const changed = await work(client, organization, company);
      trace?.("settings_updated");
      await this.requests.recordAttribution(client, { organizationId, operationRequestId: reservation.request.id, operation, resourceType: "organization_settings", resourceId: organizationId, principalKind: principal.kind, principalSubject: principalSubject(principal), staffActorUserId: staffActorId(principal) });
      await client.query("INSERT INTO v2_audit_events(organization_id,operation_request_id,operation,event_type,resource_type,resource_id,principal_kind,principal_subject,staff_actor_user_id,changes) VALUES($1,$2,$3,$4,'organization_settings',$5,$6,$7,$8,$9::jsonb)", [organizationId, reservation.request.id, operation, eventType, organizationId, principal.kind, principalSubject(principal), staffActorId(principal) ?? null, JSON.stringify([{ kind: operation, before: changed.before, after: changed.after }])]);
      trace?.("audit_written");
      await this.requests.succeed(client, organizationId, reservation.request.id, { resourceType: "organization_settings", resourceId: organizationId, resultJson: changed.after });
      trace?.("durable_request_completed"); await client.query("COMMIT"); trace?.("transaction_committed"); return changed.after;
    } catch (cause) { await client.query("ROLLBACK"); const errorCode = cause instanceof V2ApplicationError ? cause.code : "INTERNAL_ERROR"; trace?.("repository_failed", { errorCode }); trace?.("transaction_rolled_back", { errorCode }); throw cause; } finally { client.release(); }
  }

  private assertRevision(current: OrganizationSettings, expected: string) { if (current.revision !== expected) throw new V2ApplicationError("STALE_STATE", "Organization settings were changed by another request. Reload and try again."); }
  private async organization(client: Pool | PoolClient, organizationId: string, lock: boolean): Promise<OrganizationRow> { const result = await client.query<OrganizationRow>(`SELECT id,name,settings,updated_at FROM organizations WHERE id=$1${lock ? " FOR UPDATE" : ""}`, [organizationId]); if (!result.rows[0]) throw new V2ApplicationError("NOT_FOUND", "Organization was not found."); return result.rows[0]; }
  private async company(client: Pool | PoolClient, organizationId: string, lock: boolean): Promise<SettingsRow | null> { const result = await client.query<SettingsRow>(`SELECT id,company_name,company_display_name,legal_company_name,address,physical_address,remittance_address,phone,email,website,invoice_logo_asset_id,invoice_logo_url,logo_url,invoice_payment_instructions,invoice_footer_note,checks_payable_to,updated_at FROM company_settings WHERE organization_id=$1 ORDER BY created_at,id LIMIT 1${lock ? " FOR UPDATE" : ""}`, [organizationId]); return result.rows[0] ?? null; }
}
