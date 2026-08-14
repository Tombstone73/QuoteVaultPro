/** Thin interface adapters translate their local context into a typed principal.
 * They deliberately know neither repositories nor persistence mechanics. */
import type { Capability, DelegatedAiPrincipal, PortalPrincipal, Principal, ServicePrincipal, StaffPrincipal } from "../authorization/authorityPolicy";

export type StaffAuthority = StaffPrincipal;
export type PortalAuthority = PortalPrincipal;
export type ApiAuthority = ServicePrincipal;
export type OperationPort<C, R> = { execute(principal: Principal, command: C): Promise<R> };

export class StaffAdapter<C, R> {
  constructor(private readonly operation: OperationPort<C, R>) {}
  execute(authority: StaffAuthority, command: C) { return this.operation.execute(authority, command); }
}

/** Inbound owns only review/orchestration; an approved mutation is the reviewer. */
export class InboundAdapter<C, R> {
  constructor(private readonly operation: OperationPort<C, R>) {}
  approved(reviewer: StaffAuthority, command: C) { return this.operation.execute(reviewer, command); }
}

export class FutureApiAdapter<C, R> {
  constructor(private readonly operation: OperationPort<C, R>) {}
  execute(authority: ApiAuthority, command: C) { return this.operation.execute(authority, command); }
}

export class PortalAdapter<C, R> {
  constructor(private readonly operation: OperationPort<C, R>) {}
  execute(authority: PortalAuthority, command: C) { return this.operation.execute(authority, command); }
}

/** Plan/GO is adapter orchestration only. The application remains the mutation owner. */
export class AiOperatorAdapter<C, R> {
  private readonly plans = new Map<string, { staff: StaffAuthority; command: C; capability: Capability; used: boolean; fresh: boolean }>();
  constructor(private readonly operation: OperationPort<C, R>) {}
  plan(id: string, staff: StaffAuthority, command: C, capability: Capability) { this.plans.set(id, { staff, command, capability, used: false, fresh: true }); }
  expire(id: string) { const plan = this.plans.get(id); if (plan) plan.fresh = false; }
  async go(id: string, staff: StaffAuthority) {
    const plan = this.plans.get(id);
    if (!plan || plan.used || !plan.fresh || plan.staff.actorId !== staff.actorId || plan.staff.organizationId !== staff.organizationId) throw new Error("STALE_OR_FORBIDDEN_PLAN");
    plan.used = true;
    const principal: DelegatedAiPrincipal = { kind: "ai", staff, command: plan.capability, confirmed: true, fresh: true };
    return this.operation.execute(principal, plan.command);
  }
}
