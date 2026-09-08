import type { Pool } from "pg";
import type { OrganizationId } from "../../src/modules/shared/commercialValues.js";

/**
 * A deliberately small staff action projection.  It reports only canonical,
 * currently actionable domain facts; it is neither a replacement workflow nor
 * a client-side aggregation of several workspace lists.
 */
export const actionCenterKinds = ["inbound", "proofs", "prepress", "production", "invoices"] as const;
export type ActionCenterKind = (typeof actionCenterKinds)[number];
export type ActionCenterItem = Readonly<{
  kind: ActionCenterKind;
  label: string;
  count: number;
  href: string;
}>;

const definitions: Readonly<Record<ActionCenterKind, Readonly<{ label: string; href: string; sql: string }>>> = {
  inbound: {
    label: "Inbound needs review",
    href: "/inbound-orders",
    sql: `SELECT count(*)::text AS count FROM v2_inbound_intakes
          WHERE organization_id=$1 AND intake_state IN ('needs_review','failed','action_required')`,
  },
  proofs: {
    label: "Proof revisions requested",
    href: "/proofing",
    sql: `SELECT count(*)::text AS count
          FROM v2_proof_works w
          JOIN LATERAL (
            SELECT id FROM v2_proof_versions
            WHERE organization_id=w.organization_id AND proof_work_id=w.id
            ORDER BY sequence DESC LIMIT 1
          ) latest ON true
          JOIN v2_proof_responses r ON r.organization_id=w.organization_id AND r.proof_version_id=latest.id
          WHERE w.organization_id=$1 AND r.outcome='revision_requested'`,
  },
  prepress: {
    label: "Prepress pending",
    href: "/prepress",
    sql: `SELECT count(*)::text AS count FROM v2_prepress_units
          WHERE organization_id=$1 AND completed_at IS NULL`,
  },
  production: {
    label: "Production remaining",
    href: "/production",
    sql: `SELECT count(*)::text AS count FROM v2_production_works w
          WHERE w.organization_id=$1
            AND COALESCE((SELECT sum(a.good_quantity) FROM v2_production_attempts a
              WHERE a.organization_id=w.organization_id AND a.production_work_id=w.id
                AND a.completed_at IS NOT NULL),0) < w.ordered_quantity`,
  },
  invoices: {
    label: "Open invoice balances",
    href: "/invoices",
    sql: `WITH payments AS (
            SELECT invoice_id,sum(amount_cents)::bigint AS amount FROM v2_billing_payment_allocations
            WHERE organization_id=$1 GROUP BY invoice_id
          ), refunds AS (
            SELECT invoice_id,sum(amount_cents)::bigint AS amount FROM v2_billing_refund_allocation_evidence
            WHERE organization_id=$1 GROUP BY invoice_id
          )
          SELECT count(*)::text AS count FROM v2_billing_invoices i
          LEFT JOIN payments p ON p.invoice_id=i.id
          LEFT JOIN refunds r ON r.invoice_id=i.id
          WHERE i.organization_id=$1 AND i.invoice_state <> 'void'
            AND (i.total_cents-COALESCE(p.amount,0)+COALESCE(r.amount,0)) > 0`,
  },
};

export class PostgresActionCenterReader {
  constructor(private readonly pool: Pick<Pool, "query">) {}

  async summary(organizationId: OrganizationId, visible: readonly ActionCenterKind[]): Promise<readonly ActionCenterItem[]> {
    const unique = actionCenterKinds.filter((kind) => visible.includes(kind));
    if (!unique.length) return [];
    // Each subquery is static source code, not request text.  A single round
    // trip avoids the usual shell-page N-query count fanout.
    const statement = unique.map((kind) =>
      `SELECT '${kind}'::text AS kind, (${definitions[kind].sql})::text AS count`,
    ).join(" UNION ALL ");
    const result = await this.pool.query<{ kind: ActionCenterKind; count: string }>(statement, [organizationId]);
    const counts = new Map(result.rows.map((row) => [row.kind, Number(row.count)]));
    return unique.map((kind) => ({
      kind,
      label: definitions[kind].label,
      href: definitions[kind].href,
      count: counts.get(kind) ?? 0,
    }));
  }
}
