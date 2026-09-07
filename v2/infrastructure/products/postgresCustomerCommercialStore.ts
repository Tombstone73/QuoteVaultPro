import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import { brandedId, currencyCode, type CustomerId, type OrganizationId, type ProductId } from "../../src/modules/shared/commercialValues.js";
import type { CustomerCommercialActor, CustomerCommercialStore, CustomerPricingAgreement, CustomerProductEntitlement, ReplaceCustomerPricingAgreement } from "../../src/modules/products/customerCommercial.js";

type Client = Pick<PoolClient, "query">;
type Row = Readonly<Record<string, unknown>>;
const date = (value: unknown): string => value instanceof Date ? value.toISOString() : String(value);

const entitlement = (row: Row): CustomerProductEntitlement => ({
  organizationId: brandedId<"OrganizationId">(String(row.organization_id)),
  customerId: brandedId<"CustomerId">(String(row.customer_id)),
  productId: brandedId<"ProductId">(String(row.product_id)),
  enabled: Boolean(row.enabled),
  updatedAt: date(row.updated_at),
});
const agreement = (row: Row): CustomerPricingAgreement => ({
  id: String(row.id),
  organizationId: brandedId<"OrganizationId">(String(row.organization_id)),
  customerId: brandedId<"CustomerId">(String(row.customer_id)),
  productId: brandedId<"ProductId">(String(row.product_id)),
  ...(row.product_version_id ? { productVersionId: String(row.product_version_id) } : {}),
  currency: currencyCode(String(row.currency)),
  mode: String(row.pricing_mode) as CustomerPricingAgreement["mode"],
  value: Number(row.pricing_value),
  active: Boolean(row.active),
  effectiveFrom: date(row.effective_from),
  createdAt: date(row.created_at),
});

/** PostgreSQL implementation keeps current selection rows small and appends a durable event for every decision. */
export class PostgresCustomerCommercialStore implements CustomerCommercialStore {
  /** A Pool owns mutations; a caller-owned PoolClient is safe for Sales reads. */
  constructor(private readonly database: Pool | PoolClient) {}

  async isEntitled(organizationId: OrganizationId, customerId: CustomerId, productId: ProductId): Promise<boolean> {
    const result = await this.database.query<{ exists: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM v2_customer_product_entitlements WHERE organization_id=$1 AND customer_id=$2 AND product_id=$3 AND enabled=true) AS exists",
      [organizationId, customerId, productId],
    );
    return result.rows[0]?.exists === true;
  }

  async resolveAgreement(input: Readonly<{ organizationId: OrganizationId; customerId: CustomerId; productId: ProductId; productVersionId: string; effectiveAt: string }>): Promise<CustomerPricingAgreement | null> {
    const result = await this.database.query<Row>(
      `SELECT * FROM v2_customer_product_pricing_agreements
       WHERE organization_id=$1 AND customer_id=$2 AND product_id=$3 AND active=true
         AND effective_from <= $5::timestamptz
         AND (product_version_id=$4 OR product_version_id IS NULL)
       ORDER BY CASE WHEN product_version_id=$4 THEN 0 ELSE 1 END, effective_from DESC, created_at DESC LIMIT 1`,
      [input.organizationId, input.customerId, input.productId, input.productVersionId, input.effectiveAt],
    );
    return result.rows[0] ? agreement(result.rows[0]) : null;
  }

  async setEntitlement(input: CustomerProductEntitlement, actor: CustomerCommercialActor): Promise<CustomerProductEntitlement> {
    return this.transaction(async (client) => {
      const customer = await client.query("SELECT 1 FROM customers WHERE organization_id=$1 AND id=$2 FOR KEY SHARE", [input.organizationId, input.customerId]);
      const product = await client.query("SELECT 1 FROM products WHERE organization_id=$1 AND id=$2 FOR KEY SHARE", [input.organizationId, input.productId]);
      if (customer.rowCount !== 1 || product.rowCount !== 1) throw new V2ApplicationError("NOT_FOUND", "Scoped customer or Product was not found.");
      const saved = await client.query<Row>(
        `INSERT INTO v2_customer_product_entitlements(organization_id,customer_id,product_id,enabled,updated_at)
         VALUES($1,$2,$3,$4,now()) ON CONFLICT(organization_id,customer_id,product_id)
         DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=now() RETURNING *`,
        [input.organizationId, input.customerId, input.productId, input.enabled],
      );
      await this.event(client, input.organizationId, input.customerId, input.productId, "entitlement_set", { enabled: input.enabled }, actor);
      return entitlement(saved.rows[0]!);
    });
  }

  async replaceAgreement(input: ReplaceCustomerPricingAgreement, actor: CustomerCommercialActor): Promise<CustomerPricingAgreement> {
    return this.transaction(async (client) => {
      const customer = await client.query("SELECT 1 FROM customers WHERE organization_id=$1 AND id=$2 FOR KEY SHARE", [input.organizationId, input.customerId]);
      const product = await client.query("SELECT 1 FROM products WHERE organization_id=$1 AND id=$2 FOR KEY SHARE", [input.organizationId, input.productId]);
      if (customer.rowCount !== 1 || product.rowCount !== 1) throw new V2ApplicationError("NOT_FOUND", "Scoped customer or Product was not found.");
      if (input.productVersionId) {
        const version = await client.query("SELECT 1 FROM pbv2_tree_versions WHERE organization_id=$1 AND product_id=$2 AND id=$3 AND status='ACTIVE' FOR KEY SHARE", [input.organizationId, input.productId, input.productVersionId]);
        if (version.rowCount !== 1) throw new V2ApplicationError("NOT_FOUND", "The scoped active ProductVersion was not found.");
      }
      // Serialize a replacement independently of its version specificity; this
      // prevents two concurrent staff edits from leaving competing agreements.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", [`${input.organizationId}:${input.customerId}`, input.productId]);
      await client.query(
        `UPDATE v2_customer_product_pricing_agreements SET active=false, superseded_at=now()
         WHERE organization_id=$1 AND customer_id=$2 AND product_id=$3 AND active=true
           AND product_version_id IS NOT DISTINCT FROM $4`,
        [input.organizationId, input.customerId, input.productId, input.productVersionId ?? null],
      );
      const inserted = await client.query<Row>(
        `INSERT INTO v2_customer_product_pricing_agreements(id,organization_id,customer_id,product_id,product_version_id,currency,pricing_mode,pricing_value,effective_from,active,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),true,now()) RETURNING *`,
        [randomUUID(), input.organizationId, input.customerId, input.productId, input.productVersionId ?? null, input.currency, input.mode, input.value],
      );
      const created = agreement(inserted.rows[0]!);
      await this.event(client, input.organizationId, input.customerId, input.productId, "pricing_agreement_replaced", { agreementId: created.id, productVersionId: input.productVersionId, mode: input.mode, value: input.value, currency: input.currency, effectiveFrom: created.effectiveFrom }, actor);
      return created;
    });
  }

  async listEntitlements(organizationId: OrganizationId, customerId: CustomerId): Promise<readonly CustomerProductEntitlement[]> {
    const result = await this.database.query<Row>("SELECT * FROM v2_customer_product_entitlements WHERE organization_id=$1 AND customer_id=$2 ORDER BY updated_at DESC,product_id", [organizationId, customerId]);
    return result.rows.map(entitlement);
  }

  private async event(client: Client, organizationId: OrganizationId, customerId: CustomerId, productId: ProductId, type: string, detail: Record<string, unknown>, actor: CustomerCommercialActor) {
    await client.query(
      `INSERT INTO v2_customer_product_commercial_events(id,organization_id,customer_id,product_id,event_type,event_detail,principal_kind,principal_subject,staff_actor_user_id,operation_id)
       VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10)`,
      [randomUUID(), organizationId, customerId, productId, type, JSON.stringify(detail), actor.principalKind, actor.principalSubject, actor.staffActorUserId ?? null, actor.operationId],
    );
  }

  private async transaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!(this.database instanceof Pool))
      throw new Error("Customer commercial mutations require a transaction-owning Pool.");
    const client = await this.database.connect();
    try { await client.query("BEGIN"); const result = await action(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}
