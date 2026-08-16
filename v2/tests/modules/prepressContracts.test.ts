import assert from "node:assert/strict";
import { capabilityIds } from "../../src/authorization/capabilities.js";
import { prepressUnitState, type PrepressUnit } from "../../src/modules/prepress/contracts.js";
import { brandedId } from "../../src/modules/shared/commercialValues.js";

const unit:PrepressUnit={prepressUnitId:brandedId<"PrepressUnitId">("unit"),organizationId:brandedId<"OrganizationId">("org"),orderId:brandedId<"OrderId">("order"),orderLineId:brandedId<"OrderLineId">("line"),artworkAssignmentId:brandedId<"ArtworkAssignmentId">("front"),artworkFileId:brandedId<"ArtworkFileId">("file"),side:"front",sourcePageIndex:0,layerKey:"ink",layerOrder:0,createdAt:"2026-08-16T00:00:00.000Z",createdPrincipalKind:"staff",createdPrincipalSubject:"staff"};
assert.equal(prepressUnitState(unit),"available");
assert.equal(prepressUnitState({...unit,startedAt:"2026-08-16T00:01:00.000Z",startedPrincipalKind:"staff",startedPrincipalSubject:"staff"}),"in_progress");
assert.equal(prepressUnitState({...unit,startedAt:"2026-08-16T00:01:00.000Z",startedPrincipalKind:"staff",startedPrincipalSubject:"staff",completedAt:"2026-08-16T00:02:00.000Z",completedPrincipalKind:"staff",completedPrincipalSubject:"staff"}),"completed");
assert.equal("routeState" in unit,false,"Routing remains the only owner of route position.");
assert.equal("proofApproved" in unit,false,"Proof approval remains a Proofing fact.");
assert.equal("productionStartedAt" in unit,false,"Production execution is not Prepress state.");
assert.deepEqual(["prepress.view","prepress.work","prepress.complete"].every((x)=>capabilityIds.includes(x as typeof capabilityIds[number])),true,"Prepress uses narrow Permission Set capabilities.");
console.log("[m2.2] Prepress contract tests passed (7 assertions).");
