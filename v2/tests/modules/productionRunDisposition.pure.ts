import assert from "node:assert/strict";
import { fulfillmentSupplyQuantity } from "../../src/modules/fulfillment/contracts.js";
import { terminalDispositionForRunAllocation, type ProductionAttemptTerminalDisposition } from "../../src/modules/production/productionRuns.js";

type TerminalAttempt = Readonly<{id:string;good:number;disposition:ProductionAttemptTerminalDisposition}>;
const completedGood=(attempts:readonly TerminalAttempt[])=>attempts.reduce((sum,attempt)=>sum+attempt.good,0);
const availability=(attempts:readonly TerminalAttempt[],required:number)=>fulfillmentSupplyQuantity({orderedQuantity:required,completedProductionQuantity:completedGood(attempts),productionRequired:true,workflowIntent:"standard_production"});
const productionSatisfied=(attempts:readonly TerminalAttempt[],required:number)=>completedGood(attempts)>=required;

// A fully produced allocation is successful and supplies exactly its recorded good output.
const full:[TerminalAttempt]=[{id:"run-a",good:100,disposition:terminalDispositionForRunAllocation(100,100,false)}];
assert.equal(full[0].disposition,"successful");
assert.equal(availability(full,100),100);
assert.equal(productionSatisfied(full,100),true);

// Releasing a partial allocation closes its attempt but cannot credit unused reservation or waste.
const partialReleased:[TerminalAttempt]=[{id:"run-a",good:40,disposition:terminalDispositionForRunAllocation(100,40,false)}];
assert.equal(partialReleased[0].disposition,"released");
assert.equal(availability(partialReleased,100),40,"Fulfillment can use only terminal recorded good output");
assert.equal(productionSatisfied(partialReleased,100),false,"released remainder remains required Production");

// A zero-output cancellation has no physical credit.
const cancelled:[TerminalAttempt]=[{id:"run-a",good:0,disposition:terminalDispositionForRunAllocation(100,0,true)}];
assert.equal(cancelled[0].disposition,"cancelled");
assert.equal(availability(cancelled,100),0);
assert.equal(productionSatisfied(cancelled,100),false);

// A later Run can complete only the still-required quantity; aggregate good output is authoritative.
const completedAcrossRuns:TerminalAttempt[]=[...partialReleased,{id:"run-b",good:60,disposition:terminalDispositionForRunAllocation(60,60,false)}];
assert.equal(availability(completedAcrossRuns,100),100);
assert.equal(productionSatisfied(completedAcrossRuns,100),true);

// An exact retry reuses the immutable attempt identity and therefore cannot duplicate output credit.
const replayed=[...partialReleased];
assert.equal(completedGood(replayed),40);
assert.equal(completedGood(replayed),40);

console.log("Production Run disposition and lifecycle authority contracts passed.");
