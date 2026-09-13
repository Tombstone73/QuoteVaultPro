import assert from "node:assert/strict";
import { canCompleteProductionRun, runAllocationIsResolved, unusedRunReservationQuantity } from "../../src/modules/production/productionRuns.js";

type Disposition="successful"|"released"|"cancelled";
type Allocation={id:string;work:string;allocated:number;good:number;waste:number;released:boolean;disposition?:Disposition};
type Event={sequence:number;kind:string;allocationId?:string;reason?:string};

class RecoveryRun {
  state:"active"|"completed"|"cancelled"="active";
  readonly events:Event[]=[];
  private readonly replies=new Map<string,Readonly<{payload:string;value:void}>>();
  constructor(readonly allocations:Allocation[]){this.event("created");for(const allocation of allocations)this.event("allocation_reserved",allocation.id);this.event("ready");this.event("started");}
  private event(kind:string,allocationId?:string,reason?:string){this.events.push({sequence:this.events.length+1,kind,...(allocationId?{allocationId}:{}),...(reason?{reason}:{})});}
  command(id:string,payload:string,work:()=>void){const prior=this.replies.get(id);if(prior){if(prior.payload!==payload)throw Error("IDEMPOTENCY_CONFLICT");return;}work();this.replies.set(id,{payload,value:undefined});}
  output(id:string,allocationId:string,good:number,waste=0){this.command(id,`output:${allocationId}:${good}:${waste}`,()=>{if(this.state!=="active")throw Error("Run is not active");const allocation=this.must(allocationId);if(allocation.released)throw Error("Allocation reservation is released");if(good<0||waste<0||allocation.good+good>allocation.allocated)throw Error("Output exceeds allocation");allocation.good+=good;allocation.waste+=waste;if(good)this.event("good_output",allocationId);if(waste)this.event("waste_output",allocationId);});}
  release(id:string,allocationId:string,reason:string){this.command(id,`release:${allocationId}:${reason}`,()=>{if(this.state!=="active")throw Error("Run is not active");const allocation=this.must(allocationId);if(allocation.released||allocation.good>=allocation.allocated)throw Error("Allocation is not releasable");allocation.released=true;allocation.disposition="released";this.event("member_released",allocationId,reason);this.event("reservation_released",allocationId,reason);});}
  cancel(id:string,reason:string){this.command(id,`cancel:${reason}`,()=>{if(this.state!=="active")throw Error("Run is not active");for(const allocation of this.allocations)if(!runAllocationIsResolved({allocatedQuantity:allocation.allocated,goodQuantity:allocation.good,...(allocation.released?{releasedAt:"released"}:{})})){allocation.released=true;allocation.disposition="cancelled";this.event("member_released",allocation.id,reason);this.event("reservation_released",allocation.id,reason);}this.state="cancelled";this.event("cancelled",undefined,reason);});}
  complete(id:string){this.command(id,"complete",()=>{if(this.state!=="active")throw Error("Run is not active");const allocations=this.allocations.map(allocation=>({allocatedQuantity:allocation.allocated,goodQuantity:allocation.good,...(allocation.released?{releasedAt:"released"}:{})}));if(!canCompleteProductionRun(allocations))throw Error("Unresolved reservation blocks completion");for(const allocation of this.allocations)if(allocation.good>=allocation.allocated)allocation.disposition="successful";this.state="completed";this.event("completed");});}
  reserved(work:string){return this.allocations.filter(allocation=>allocation.work===work).reduce((total,allocation)=>total+unusedRunReservationQuantity(allocation.allocated,allocation.good,allocation.released),0);}
  private must(id:string){const allocation=this.allocations.find(candidate=>candidate.id===id);if(!allocation)throw Error("Allocation not found");return allocation;}
}

// A zero-output member release preserves its sibling reservation and leaves no completion credit.
const siblingRun=new RecoveryRun([{id:"a",work:"work-a",allocated:50,good:0,waste:0,released:false},{id:"b",work:"work-b",allocated:50,good:0,waste:0,released:false}]);
siblingRun.release("release-a","a","material damaged before print");
assert.deepEqual(siblingRun.allocations[0],{id:"a",work:"work-a",allocated:50,good:0,waste:0,released:true,disposition:"released"});
assert.equal(siblingRun.reserved("work-a"),0);
assert.equal(siblingRun.reserved("work-b"),50,"sibling allocation remains reserved and unchanged");
assert.throws(()=>siblingRun.complete("complete-blocked"),/Unresolved/);

// Partial member release preserves good/waste and makes only the unused reservation available.
const partial=new RecoveryRun([{id:"a",work:"work",allocated:60,good:0,waste:0,released:false}]);
partial.output("good-40","a",40,3);
partial.release("release-partial","a","remaining sheet not required");
assert.equal(partial.allocations[0]!.good,40);assert.equal(partial.allocations[0]!.waste,3);assert.equal(partial.reserved("work"),0);
assert.equal(partial.allocations[0]!.disposition,"released");
partial.complete("complete-partial");assert.equal(partial.state,"completed");

// Cancellation releases every unresolved member but never reverses physical output.
const noOutputCancel=new RecoveryRun([{id:"a",work:"work-a",allocated:25,good:0,waste:0,released:false}]);
noOutputCancel.cancel("cancel-empty","operator cancelled");
assert.equal(noOutputCancel.allocations[0]!.good,0);assert.equal(noOutputCancel.allocations[0]!.disposition,"cancelled");
const partialCancel=new RecoveryRun([{id:"a",work:"work-a",allocated:25,good:0,waste:0,released:false}]);
partialCancel.output("good-10","a",10,2);partialCancel.cancel("cancel-partial","machine fault");
assert.deepEqual(partialCancel.allocations[0],{id:"a",work:"work-a",allocated:25,good:10,waste:2,released:true,disposition:"cancelled"});

// Run A releases only its unused 20. Normal Run creation can reserve the remaining 60, and only real good output completes the work.
const required=100;
const runA=new RecoveryRun([{id:"run-a",work:"canonical-work",allocated:60,good:0,waste:0,released:false}]);
runA.output("a-good-40","run-a",40);runA.release("a-release-20","run-a","remaining moved to successor Run");
const goodAfterA=runA.allocations[0]!.good;
const availableAfterA=required-goodAfterA-runA.reserved("canonical-work");
assert.equal(goodAfterA,40);assert.equal(availableAfterA,60);
const runB=new RecoveryRun([{id:"run-b",work:"canonical-work",allocated:availableAfterA,good:0,waste:0,released:false}]);
assert.equal(runA.reserved("canonical-work")+runB.reserved("canonical-work"),60,"released capacity is not double-reserved");
runB.output("b-good-60","run-b",60);runB.complete("b-complete");
assert.equal(goodAfterA+runB.allocations[0]!.good,100);assert.equal(runB.allocations[0]!.disposition,"successful");

// Exact retries replay without duplicate output or events; changed payload conflicts.
const eventCount=runB.events.length;runB.output("b-good-60","run-b",60);assert.equal(runB.events.length,eventCount);assert.equal(runB.allocations[0]!.good,60);
assert.throws(()=>runB.command("b-good-60","output:run-b:59:0",()=>{}),/IDEMPOTENCY_CONFLICT/);
assert.deepEqual(runB.events.map(event=>event.sequence),runB.events.map((_,index)=>index+1),"events are deterministic chronological history");
for(const kind of ["created","allocation_reserved","ready","started","good_output","completed"])assert.ok(runB.events.some(event=>event.kind===kind));
for(const kind of ["member_released","reservation_released","cancelled"])assert.ok(noOutputCancel.events.some(event=>event.kind===kind));

// A transaction serializes competing commands: once release/cancel wins, later output is rejected with no new physical credit.
const releaseRace=new RecoveryRun([{id:"a",work:"race",allocated:10,good:0,waste:0,released:false}]);
releaseRace.release("release-wins","a","operator release");assert.throws(()=>releaseRace.output("late-output","a",1),/released/);assert.equal(releaseRace.allocations[0]!.good,0);
const cancelRace=new RecoveryRun([{id:"a",work:"race",allocated:10,good:0,waste:0,released:false}]);
cancelRace.cancel("cancel-wins","operator cancel");assert.throws(()=>cancelRace.output("late-output","a",1),/not active/);assert.equal(cancelRace.allocations[0]!.good,0);

console.log("Production Run recovery and durable-event contracts passed.");
