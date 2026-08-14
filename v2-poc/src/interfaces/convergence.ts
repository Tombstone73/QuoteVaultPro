/** Thin interface adapters depend only on these application-operation ports. */
export type StaffAuthority={kind:"staff";actorId:string;organizationId:string};
export type PortalAuthority={kind:"portal";organizationId:string;customerId:string;portalSubjectId:string};
export type ApiAuthority={kind:"api";organizationId:string;clientId:string;actorId:string};
export type ExecutionAuthority=StaffAuthority|PortalAuthority|ApiAuthority;
export type OperationPort<C,R>={execute(actorId:string,command:C):Promise<R>};
export class StaffAdapter<C,R>{constructor(private op:OperationPort<C,R>){}execute(a:StaffAuthority,c:C){return this.op.execute(a.actorId,c)}}
export class InboundAdapter<C,R>{constructor(private op:OperationPort<C,R>){}approved(a:StaffAuthority,c:C){return this.op.execute(a.actorId,c)}}
export class FutureApiAdapter<C,R>{constructor(private op:OperationPort<C,R>){}execute(a:ApiAuthority,c:C){return this.op.execute(a.actorId,c)}}
export class AiOperatorAdapter<C,R>{private plans=new Map<string,{a:StaffAuthority;c:C;used:boolean}>();constructor(private op:OperationPort<C,R>){}plan(id:string,a:StaffAuthority,c:C){this.plans.set(id,{a,c,used:false})}async go(id:string,a:StaffAuthority){const p=this.plans.get(id);if(!p||p.used||p.a.actorId!==a.actorId||p.a.organizationId!==a.organizationId)throw new Error("STALE_OR_FORBIDDEN_PLAN");p.used=true;return this.op.execute(a.actorId,p.c)}}
/** Portal authority is intentionally not coerced to a staff actor. Existing V2
 * staff-only ports must evolve a canonical policy boundary before this adapter
 * can invoke a customer-originated mutation. */
export class PortalAdapter<C,R>{constructor(private readonly unsupported:string){}execute(_a:PortalAuthority,_c:C):Promise<R>{return Promise.reject(new Error(`PORTAL_AUTHORITY_GAP:${this.unsupported}`))}}
