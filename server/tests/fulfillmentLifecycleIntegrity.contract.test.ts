import { expect, test } from "@jest/globals";
import fs from "node:fs";
import path from "node:path";

const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

test("administrative fulfillment is durable and never reuses physical evidence", () => {
  const schema = source("shared/schema.ts");
  const migration = source("server/db/migrations_v2/0212_fulfillment_administrative_reconciliation.sql");
  const repository = source("server/services/fulfillment/repository.ts");
  expect(schema).toContain("fulfillmentAdministrativeReconciliations");
  expect(migration).toContain("reconciled_quantity integer NOT NULL CHECK (reconciled_quantity > 0)");
  expect(repository).toContain("reconcileAdministrativeFulfillment");
  expect(repository).toContain("backfillProvenLegacyCloseJobOverride");
  expect(repository).toContain("administrativelyReconciledQuantity");
});

test("the active fulfillment projection excludes zero-remaining and terminal orders once", () => {
  const repository = source("server/services/fulfillment/repository.ts");
  const eligibility = source("server/services/fulfillment/eligibility.ts");
  expect(repository).toContain("if (!isFulfillmentQueueEligibleOrder(order)) continue;");
  expect(repository).toContain("if (remaining <= 0) continue;");
  expect(repository).toContain("distinctActiveFulfillmentOrders: activeOrders.length");
  expect(eligibility).toContain("fulfillmentStatus}, '')) not in ('shipped', 'delivered')");
});

test("the audit CLI reports explicit native-pg scope and target inspection results", () => {
  const audit = source("scripts/audit-fulfillment-lifecycle-integrity.ts");
  const repository = source("server/services/fulfillment/repository.ts");
  expect(audit).toContain('drizzle-orm/node-postgres');
  expect(audit).toContain('organizationName: scope.name');
  expect(audit).toContain('baseOrders: audit.baseOrderCount');
  expect(audit).toContain('manualReviewCandidates: audit.manualReviewCandidates.length');
  expect(repository).toContain("reason: 'ORDER_NOT_FOUND_IN_SCOPE'");
  expect(repository).toContain('found: true as const');
  expect(repository).toContain('const activeProjectionRows = eligibilityRows.filter');
});

test("Close Job Override remains available only as an explicit staff exception for legacy contradictions", () => {
  const dialog = source("client/src/components/orders/CloseJobOverrideDialog.tsx");
  const service = source("server/services/fulfillment/service.ts");
  expect(dialog).toContain("isCloseJobOverrideEligible(previewQuery.data)");
  expect(dialog).toContain("useCloseJobOverrideEligibility");
  expect(service).toContain("canCloseJobOverrideFromCanonicalObligations");
});
