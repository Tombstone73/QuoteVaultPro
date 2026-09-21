import assert from "node:assert/strict";
import { M78I_FIXTURE, M78I_FIXTURE_MUTATIONS, M78I_FIXTURE_PRODUCT_GENERAL, M78I_FIXTURE_PRODUCT_PRICING, M78I_FIXTURE_ROUTE_STEPS, assertFixtureReadiness, assertFixtureTenant, fixtureProductGeneralMatches, fixtureProductPricingMatches, fixtureProductRoutingMatches, manifestIsSecretFree, m78iFixtureBusinessRequestId, m78iFixtureBusinessRequestIdForVersion, planFixtureReconciliation, planFixtureRoute, resolveFixtureRoute, type FixtureManifest } from "../../src/qa/m78iFixtureBootstrap.js";

assert.equal(M78I_FIXTURE.organizationId, "b6f969b2-dda3-4133-9d75-c417dabb8f3a");
assert.doesNotThrow(() => assertFixtureReadiness({ route: "missing", product: "missing", customer: "valid", order: "historical", artwork: "missing" }));
assert.throws(() => assertFixtureReadiness({ route: "ready", product: "ambiguous", customer: "valid", order: "valid", artwork: "valid" }), /Ambiguous/);
assert.deepEqual(planFixtureReconciliation({ route: "missing", product: "missing", customer: "missing", order: "missing", artwork: "missing" }), { route: "create", product: "create", customer: "create", order: "create_current", artwork: "adopt" }, "first bootstrap creates only missing fixture nodes");
assert.deepEqual(planFixtureReconciliation({ route: "ready", product: "valid", customer: "valid", order: "valid", artwork: "valid" }), { route: "reuse", product: "reuse", customer: "reuse", order: "reuse", artwork: "reuse" }, "second bootstrap is a no-op");
assert.deepEqual(planFixtureReconciliation({ route: "ready", product: "valid", customer: "missing", order: "missing", artwork: "missing" }), { route: "reuse", product: "reuse", customer: "create", order: "create_current", artwork: "adopt" }, "an interrupted bootstrap resumes from the first missing canonical fixture");
assert.equal(planFixtureReconciliation({ route: "ready", product: "valid", customer: "valid", order: "historical", artwork: "missing" }).order, "create_current", "historical Order is preserved while a current Order is created");
assert.equal(planFixtureReconciliation({ route: "ready", product: "invalid", customer: "valid", order: "valid", artwork: "valid" }).product, "repair", "only an invalid fixture Product is eligible for canonical repair");
const requestIds = M78I_FIXTURE_MUTATIONS.map(m78iFixtureBusinessRequestId);
assert.equal(new Set(requestIds).size, requestIds.length, "every fixture mutation has its own business request ID");
assert.equal(m78iFixtureBusinessRequestId("product.create"), m78iFixtureBusinessRequestId("product.create"), "the same fixture version and mutation always use the same request ID");
assert.notEqual(m78iFixtureBusinessRequestId("product.create"), m78iFixtureBusinessRequestId("customer.create"), "Product and Customer creation cannot share a request ID");
assert.notEqual(m78iFixtureBusinessRequestId("customer.create"), m78iFixtureBusinessRequestId("order.create"), "Customer and Order creation cannot share a request ID");
assert.notEqual(m78iFixtureBusinessRequestIdForVersion("v1", "product.create"), m78iFixtureBusinessRequestIdForVersion("v2", "product.create"), "a fixture definition change requires an explicit schema-version change");
assert.equal(fixtureProductGeneralMatches(M78I_FIXTURE_PRODUCT_GENERAL), true, "the canonical Product general payload is recognized");
assert.equal(fixtureProductGeneralMatches({ ...M78I_FIXTURE_PRODUCT_GENERAL, description: "changed" }), false, "a changed Product general payload is not silently reused");
assert.equal(fixtureProductPricingMatches({ measurementMode: "dimensions_required", mode: "simple_base", editable: true, ...M78I_FIXTURE_PRODUCT_PRICING, flatFeeCents: null }), true, "the canonical Product pricing payload is recognized without a volatile draft revision");
assert.equal(fixtureProductPricingMatches({ measurementMode: "dimensions_required", mode: "simple_base", editable: true, ...M78I_FIXTURE_PRODUCT_PRICING, flatFeeCents: null, draftUpdatedAt: "volatile-but-ignored" } as never), true, "volatile read timestamps do not change the desired idempotent fixture payload");
assert.equal(fixtureProductRoutingMatches({ kind: "route_required", routeTemplateId: "route-1" }, "route-1"), true);
assert.equal(fixtureProductRoutingMatches({ kind: "route_required", routeTemplateId: "other" }, "route-1"), false);
const fixtureRoute = { id: "route-1", name: M78I_FIXTURE.route, active: true, revision: "1", steps: M78I_FIXTURE_ROUTE_STEPS };
assert.deepEqual(resolveFixtureRoute([]), { readiness: "missing" }, "zero marked routes is missing");
assert.equal(planFixtureRoute(resolveFixtureRoute([]), true), "create", "a missing route is created only with the existing route authority");
assert.equal(planFixtureRoute(resolveFixtureRoute([]), false), "fail", "a missing route does not silently expand authority");
assert.deepEqual(resolveFixtureRoute([fixtureRoute]), { readiness: "ready", route: fixtureRoute }, "one active exact fixture route is reused");
assert.deepEqual(planFixtureReconciliation({ route: "ready", product: "invalid", customer: "missing", order: "missing", artwork: "missing" }), { route: "reuse", product: "repair", customer: "create", order: "create_current", artwork: "adopt" }, "a partial Product resumes only after the dedicated route is ready");
assert.deepEqual(resolveFixtureRoute([
  { ...fixtureRoute, id: "flatbed-route", name: "M77E-C Flatbed Route", steps: [{ position: 0, kind: "prepress" }, { position: 1, kind: "production" }, { position: 2, kind: "fulfillment" }] },
  { ...fixtureRoute, id: "roll-route", name: "M77E-C Roll Route", steps: [{ position: 0, kind: "prepress" }, { position: 1, kind: "production" }, { position: 2, kind: "fulfillment" }] },
]), { readiness: "missing" }, "existing M77E-C routes are ignored and cannot satisfy or mutate the dedicated fixture route");
assert.deepEqual(resolveFixtureRoute([fixtureRoute, { ...fixtureRoute, id: "route-2" }]), { readiness: "ambiguous" }, "multiple marked fixture routes fail closed");
assert.deepEqual(resolveFixtureRoute([{ ...fixtureRoute, active: false }]), { readiness: "invalid", route: { ...fixtureRoute, active: false } }, "an inactive marked route is never selected");
assert.deepEqual(resolveFixtureRoute([{ ...fixtureRoute, steps: [{ position: 0, kind: "proofing" }, { position: 1, kind: "production" }] }]), { readiness: "invalid", route: { ...fixtureRoute, steps: [{ position: 0, kind: "proofing" }, { position: 1, kind: "production" }] } }, "the fixture route requires the exact M7.8I stage sequence");
assert.throws(() => assertFixtureTenant("wrong", M78I_FIXTURE.organizationName), /locked/);
assert.throws(() => assertFixtureTenant(M78I_FIXTURE.organizationId, "Titan Graphics"), /locked/);
assert.doesNotThrow(() => assertFixtureTenant(M78I_FIXTURE.organizationId, M78I_FIXTURE.organizationName));
const manifest: FixtureManifest = { organizationId: M78I_FIXTURE.organizationId, product: { id: "product", activeVersionId: "version", productionUnit: "front", requiresProductionJob: true }, order: { id: "order", orderNumber: "ORD-1", lineId: "line" } };
assert.equal(manifestIsSecretFree(manifest), true);
assert.equal(manifestIsSecretFree({ ...manifest, product: { ...manifest.product!, id: "password" } }), false);
console.log("[m78i-fixture] pure fixture guard tests passed.");
