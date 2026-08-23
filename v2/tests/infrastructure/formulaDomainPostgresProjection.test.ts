import { describe, expect, test } from "@jest/globals";
import type { OperationContext } from "../../src/application/operation";
import { FormulaDomainApplicationService } from "../../src/modules/pricing/formulaDomain";
import { PostgresFormulaDomainReads, PostgresFormulaDomainTransactionRunner } from "../../infrastructure/pricing/postgresFormulaDomain";

const organizationId = "tenant-formula";
const actorId = "staff-formula";
const context = (id: string): OperationContext => ({
  organizationId,
  operationId: id,
  businessRequest: { id, payloadFingerprint: id },
  principal: { kind: "staff", organizationId, userId: actorId, authority: { membershipId: "membership-formula", capabilities: ["pricing.configure"] } },
});

const definition = (expression: string) => ({
  expression,
  declaredInputs: [{ key: "rate", label: "Rate", type: "number" as const, required: true, minimum: 0, unit: "sq_ft" as const, authorable: true }],
  validationEvidence: { fixture: "postgres-projection" },
});

type Formula = { id: string; organizationId: string; name: string; description: string | null; visibility: "library" | "product_scoped"; status: "active"; currentRevisionId: string; createdAt: Date; updatedAt: Date };
type Revision = { id: string; organizationId: string; formulaId: string; revisionNumber: number; expression: string; declaredInputs: unknown; validationEvidence: unknown; createdAt: Date; createdByUserId: string | null };

/**
 * A deliberately projection-aware in-memory pg double.  It only returns
 * joined revision fields when the SQL actually selects them, matching the
 * Postgres row contract that exposed this regression.
 */
class FormulaDomainPoolDouble {
  readonly formulas: Formula[] = [];
  readonly revisions: Revision[] = [];
  private readonly requests = new Map<string, any>();
  private transactionSnapshot: { formulas: Formula[]; revisions: Revision[]; requests: Map<string, any> } | undefined;
  private nextId = 0;

  async connect(): Promise<any> { return this; }
  release(): void {}

  async query<T = any>(sql: string, values: readonly unknown[] = []): Promise<{ rows: T[] }> {
    const compact = sql.replace(/\s+/gu, " ").trim();
    if (compact === "BEGIN") {
      this.transactionSnapshot = { formulas: structuredClone(this.formulas), revisions: structuredClone(this.revisions), requests: new Map(this.requests) };
      return { rows: [] };
    }
    if (compact === "COMMIT") { this.transactionSnapshot = undefined; return { rows: [] }; }
    if (compact === "ROLLBACK") {
      if (this.transactionSnapshot) {
        this.formulas.splice(0, this.formulas.length, ...this.transactionSnapshot.formulas);
        this.revisions.splice(0, this.revisions.length, ...this.transactionSnapshot.revisions);
        this.requests.clear();
        for (const [key, value] of this.transactionSnapshot.requests) this.requests.set(key, value);
      }
      this.transactionSnapshot = undefined;
      return { rows: [] };
    }
    if (compact.includes("FROM v2_operation_requests") && compact.startsWith("SELECT *")) return { rows: [] };
    if (compact.startsWith("INSERT INTO v2_operation_requests")) {
      const id = `request-${++this.nextId}`;
      const [tenant, operation, businessRequestId, payloadFingerprint, principalKind, principalSubject, staffActorUserId] = values as string[];
      const row = { id, organization_id: tenant, operation, business_request_id: businessRequestId, payload_fingerprint: payloadFingerprint, status: "in_progress", result_resource_type: null, result_resource_id: null, result_json: null, initiated_principal_kind: principalKind, initiated_principal_subject: principalSubject, staff_actor_user_id: staffActorUserId, created_at: new Date("2026-08-24T00:00:00.000Z"), updated_at: new Date("2026-08-24T00:00:00.000Z"), completed_at: null };
      this.requests.set(id, row);
      return { rows: [row] as T[] };
    }
    if (compact.startsWith("UPDATE v2_operation_requests SET status = 'succeeded'")) {
      const row = this.requests.get(values[1] as string);
      if (!row) return { rows: [] };
      Object.assign(row, { status: "succeeded", result_resource_type: values[2], result_resource_id: values[3], result_json: JSON.parse(values[4] as string), completed_at: new Date(), updated_at: new Date() });
      return { rows: [row] as T[] };
    }
    if (compact.startsWith("INSERT INTO v2_principal_attributions") || compact.startsWith("INSERT INTO v2_audit_events")) return { rows: [] };
    if (compact.startsWith("INSERT INTO v2_formula_identities")) {
      const [id, tenant, name, _normalized, description, visibility] = values as [string, string, string, string, string | null, "library" | "product_scoped"];
      const now = new Date("2026-08-24T00:00:00.000Z");
      this.formulas.push({ id, organizationId: tenant, name, description, visibility, status: "active", currentRevisionId: "", createdAt: now, updatedAt: now });
      return { rows: [] };
    }
    if (compact.startsWith("INSERT INTO formula_revisions")) {
      const hasExplicitRevisionNumber = typeof values[3] === "number";
      const [id, tenant, formulaId] = values as [string, string, string];
      const revisionNumber = hasExplicitRevisionNumber ? values[3] as number : 1;
      const expression = values[hasExplicitRevisionNumber ? 4 : 3] as string;
      const declaredInputs = values[hasExplicitRevisionNumber ? 5 : 4] as string;
      const validationEvidence = values[hasExplicitRevisionNumber ? 6 : 5] as string;
      const createdByUserId = values[hasExplicitRevisionNumber ? 7 : 6] as string | null;
      this.revisions.push({ id, organizationId: tenant, formulaId, revisionNumber, expression, declaredInputs: JSON.parse(declaredInputs), validationEvidence: JSON.parse(validationEvidence), createdAt: new Date("2026-08-24T00:00:00.000Z"), createdByUserId });
      return { rows: [] };
    }
    if (compact.startsWith("SELECT COALESCE(max(revision_number)")) {
      const [tenant, formulaId] = values as string[];
      return { rows: [{ revision_number: Math.max(0, ...this.revisions.filter((candidate) => candidate.organizationId === tenant && candidate.formulaId === formulaId).map((candidate) => candidate.revisionNumber)) + 1 }] as T[] };
    }
    if (compact.startsWith("UPDATE v2_formula_identities SET current_revision_id=") && compact.includes("updated_at=now()")) {
      const [revisionId, _actor, tenant, formulaId] = values as string[];
      const formula = this.formulas.find((candidate) => candidate.organizationId === tenant && candidate.id === formulaId)!;
      formula.currentRevisionId = revisionId;
      formula.updatedAt = new Date("2026-08-24T00:01:00.000Z");
      return { rows: [] };
    }
    if (compact.startsWith("UPDATE v2_formula_identities SET current_revision_id=")) {
      const [revisionId, tenant, formulaId] = values as string[];
      const formula = this.formulas.find((candidate) => candidate.organizationId === tenant && candidate.id === formulaId)!;
      formula.currentRevisionId = revisionId;
      return { rows: [] };
    }
    if (compact.includes("FROM v2_formula_identities f") && compact.includes("JOIN formula_revisions r ON r.id=f.current_revision_id")) {
      const [tenant, requestedFormulaId] = values as string[];
      const formulas = this.formulas.filter((candidate) => candidate.organizationId === tenant && (!requestedFormulaId || candidate.id === requestedFormulaId));
      return { rows: formulas.map((formula) => this.detailRow(compact, formula)) as T[] };
    }
    if (compact.includes("FROM v2_formula_identities f") && compact.includes("FOR UPDATE")) {
      const [tenant, formulaId] = values as string[];
      const formula = this.formulas.find((candidate) => candidate.organizationId === tenant && candidate.id === formulaId);
      return { rows: formula ? [this.headerRow(formula)] as T[] : [] };
    }
    if (compact.includes("FROM formula_revisions r") && compact.includes("ORDER BY r.revision_number DESC")) {
      const [tenant, formulaId] = values as string[];
      return { rows: this.revisions.filter((candidate) => candidate.organizationId === tenant && candidate.formulaId === formulaId).sort((left, right) => right.revisionNumber - left.revisionNumber).map((candidate) => this.revisionRow(candidate)) as T[] };
    }
    throw new Error(`Unhandled Formula-domain query in test double: ${compact}`);
  }

  private headerRow(formula: Formula) {
    return { id: formula.id, organization_id: formula.organizationId, name: formula.name, description: formula.description, visibility: formula.visibility, status: formula.status, current_revision_id: formula.currentRevisionId, created_at: formula.createdAt, updated_at: formula.updatedAt, usage_count: "0" };
  }
  private revisionRow(revision: Revision) {
    return { id: revision.id, organization_id: revision.organizationId, formula_id: revision.formulaId, revision_number: revision.revisionNumber, expression: revision.expression, declared_inputs: revision.declaredInputs, validation_evidence: revision.validationEvidence, created_at: revision.createdAt, created_by_user_id: revision.createdByUserId };
  }
  private detailRow(sql: string, formula: Formula) {
    const revision = this.revisions.find((candidate) => candidate.id === formula.currentRevisionId)!;
    const row: Record<string, unknown> = this.headerRow(formula);
    // The formula mapper validates these fields, so all detail/list/create
    // queries must explicitly project them from the joined revision.
    if (/\br\.id\s+formula_revision_id\b/u.test(sql)) row.formula_revision_id = revision.id;
    if (/\br\.organization_id\s+formula_revision_organization_id\b/u.test(sql)) row.formula_revision_organization_id = revision.organizationId;
    if (/\br\.formula_id\s+formula_revision_formula_id\b/u.test(sql)) row.formula_revision_formula_id = revision.formulaId;
    if (/\br\.revision_number\s+formula_revision_number\b/u.test(sql)) row.formula_revision_number = revision.revisionNumber;
    if (/\br\.expression\s+formula_revision_expression\b/u.test(sql)) row.formula_revision_expression = revision.expression;
    if (/\br\.declared_inputs\s+formula_revision_declared_inputs\b/u.test(sql)) row.formula_revision_declared_inputs = revision.declaredInputs;
    if (/\br\.validation_evidence\s+formula_revision_validation_evidence\b/u.test(sql)) row.formula_revision_validation_evidence = revision.validationEvidence;
    if (/\br\.created_at\s+formula_revision_created_at\b/u.test(sql)) row.formula_revision_created_at = revision.createdAt;
    if (/\br\.created_by_user_id\s+formula_revision_created_by_user_id\b/u.test(sql)) row.formula_revision_created_by_user_id = revision.createdByUserId;
    return row;
  }
}

describe("Postgres Formula-domain detail projection", () => {
  test("create and revise return full current FormulaRevision projections without mutating revision 1", async () => {
    const pool = new FormulaDomainPoolDouble();
    const service = new FormulaDomainApplicationService(new PostgresFormulaDomainTransactionRunner(pool as any));

    const created = await service.create(context("postgres-create"), { businessRequestId: "postgres-create", name: "Area formula", visibility: "library", definition: definition("ceil(sqft) * rate") });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error.publicMessage);
    expect(created).toMatchObject({ ok: true, value: { name: "Area formula", currentRevisionId: expect.any(String), revision: { revisionNumber: 1, expression: "ceil(sqft) * rate", declaredInputs: definition("x").declaredInputs } } });
    const revisionOne = structuredClone(created.value.revision);

    const revised = await service.revise(context("postgres-revise"), { businessRequestId: "postgres-revise", formulaId: created.value.formulaId, expectedCurrentRevisionId: created.value.currentRevisionId, definition: definition("ceil(sqft) * (rate + 1)") });
    expect(revised).toMatchObject({ ok: true, value: { currentRevisionId: expect.any(String), revision: { revisionNumber: 2, expression: "ceil(sqft) * (rate + 1)", declaredInputs: definition("x").declaredInputs } } });
    expect(pool.revisions).toHaveLength(2);
    expect(pool.revisions[0]?.expression).toBe(revisionOne.expression);
    expect(pool.revisions[0]?.declaredInputs).toEqual(revisionOne.declaredInputs);
  });

  test("detail, list, and revisions preserve the mapper contract and tenant isolation", async () => {
    const pool = new FormulaDomainPoolDouble();
    const service = new FormulaDomainApplicationService(new PostgresFormulaDomainTransactionRunner(pool as any));
    const created = await service.create(context("postgres-detail-create"), { businessRequestId: "postgres-detail-create", name: "Detail formula", visibility: "product_scoped", definition: definition("sqft * rate") });
    if (!created.ok) throw new Error(created.error.publicMessage);
    const reads = new PostgresFormulaDomainReads(pool as any);
    await expect(reads.get(organizationId, created.value.formulaId)).resolves.toMatchObject({ formulaId: created.value.formulaId, revision: { formulaRevisionId: created.value.currentRevisionId, expression: "sqft * rate", declaredInputs: definition("x").declaredInputs } });
    await expect(reads.list(organizationId)).resolves.toEqual([expect.objectContaining({ formulaId: created.value.formulaId, revision: expect.objectContaining({ expression: "sqft * rate" }) })]);
    await expect(reads.revisions(organizationId, created.value.formulaId)).resolves.toEqual([expect.objectContaining({ formulaRevisionId: created.value.currentRevisionId, revisionNumber: 1, expression: "sqft * rate" })]);
    await expect(reads.get("tenant-other", created.value.formulaId)).resolves.toBeNull();
  });

  test("an invalid definition rolls back before Formula-domain rows persist", async () => {
    const pool = new FormulaDomainPoolDouble();
    const service = new FormulaDomainApplicationService(new PostgresFormulaDomainTransactionRunner(pool as any));
    const result = await service.create(context("postgres-invalid"), { businessRequestId: "postgres-invalid", name: "Invalid", visibility: "library", definition: { ...definition(""), expression: "" } });
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(pool.formulas).toEqual([]);
    expect(pool.revisions).toEqual([]);
  });
});
