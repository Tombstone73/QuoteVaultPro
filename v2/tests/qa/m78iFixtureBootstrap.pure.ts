import assert from "node:assert/strict";
import { M78I_FIXTURE, assertFixtureReadiness, assertFixtureTenant, manifestIsSecretFree, planFixtureReconciliation, type FixtureManifest } from "../../src/qa/m78iFixtureBootstrap.js";

assert.equal(M78I_FIXTURE.organizationId, "b6f969b2-dda3-4133-9d75-c417dabb8f3a");
assert.doesNotThrow(() => assertFixtureReadiness({ product: "missing", customer: "valid", order: "historical", artwork: "missing" }));
assert.throws(() => assertFixtureReadiness({ product: "ambiguous", customer: "valid", order: "valid", artwork: "valid" }), /Ambiguous/);
assert.deepEqual(planFixtureReconciliation({ product: "missing", customer: "missing", order: "missing", artwork: "missing" }), { product: "create", customer: "create", order: "create_current", artwork: "adopt" }, "first bootstrap creates only missing fixture nodes");
assert.deepEqual(planFixtureReconciliation({ product: "valid", customer: "valid", order: "valid", artwork: "valid" }), { product: "reuse", customer: "reuse", order: "reuse", artwork: "reuse" }, "second bootstrap is a no-op");
assert.equal(planFixtureReconciliation({ product: "valid", customer: "valid", order: "historical", artwork: "missing" }).order, "create_current", "historical Order is preserved while a current Order is created");
assert.equal(planFixtureReconciliation({ product: "invalid", customer: "valid", order: "valid", artwork: "valid" }).product, "repair", "only an invalid fixture Product is eligible for canonical repair");
assert.throws(() => assertFixtureTenant("wrong", M78I_FIXTURE.organizationName), /locked/);
assert.throws(() => assertFixtureTenant(M78I_FIXTURE.organizationId, "Titan Graphics"), /locked/);
assert.doesNotThrow(() => assertFixtureTenant(M78I_FIXTURE.organizationId, M78I_FIXTURE.organizationName));
const manifest: FixtureManifest = { organizationId: M78I_FIXTURE.organizationId, product: { id: "product", activeVersionId: "version", productionUnit: "front", requiresProductionJob: true }, order: { id: "order", orderNumber: "ORD-1", lineId: "line" } };
assert.equal(manifestIsSecretFree(manifest), true);
assert.equal(manifestIsSecretFree({ ...manifest, product: { ...manifest.product!, id: "password" } }), false);
console.log("[m78i-fixture] pure fixture guard tests passed.");
