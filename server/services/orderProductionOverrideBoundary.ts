import { and, eq, sql } from 'drizzle-orm';
import { orderLineItems, orders } from '@shared/schema';

/** Match canonical production's line-before-parent order. Never hold the
 * parent while waiting for a line whose current owner needs that parent. */
export async function lockOrderProductionOverrideLines(tx: any, organizationId: string, orderId: string) {
  await tx.execute(sql`select set_config('lock_timeout', '3s', true), set_config('statement_timeout', '15s', true)`);
  await tx.select({id:orderLineItems.id}).from(orderLineItems)
    .innerJoin(orders,eq(orders.id,orderLineItems.orderId))
    .where(and(eq(orders.organizationId,organizationId),eq(orders.id,orderId)))
    .orderBy(orderLineItems.id).for('update',{of:orderLineItems});
}

export function productionOverrideRetryError(error: unknown) {
  let cause=error;
  for(let depth=0;depth<6 && cause && typeof cause==='object';depth++) {
    const code='code' in cause ? cause.code : null;
    if(code==='55P03' || code==='40P01' || code==='57014') return {
      status:409,code:code==='57014'?'PRODUCTION_OVERRIDE_TIMED_OUT':'PRODUCTION_OVERRIDE_BUSY',retryable:true,committed:false,
      message:'Production completion was rolled back because the job was busy or exceeded its processing limit. Refresh the live preview, then retry. No production changes from this attempt were committed.',
    };
    cause='cause' in cause ? cause.cause : null;
  }
  return null;
}

type Stage='preview'|'transaction'|'workflow_locks'|'bootstrap'|'job_completion'|'handoff'|'billing_projection';
/** Fixed stage names and aggregate counters only: no SQL, notes or customer data. */
export function productionOverrideTiming() {
  const started=performance.now(), stages:Partial<Record<Stage,{calls:number;durationMs:number}>>={};
  return {
    async run<T>(stage:Stage,operation:()=>Promise<T>):Promise<T> {
      const begin=performance.now();
      try{return await operation();}finally{
        const previous=stages[stage]??{calls:0,durationMs:0};
        stages[stage]={calls:previous.calls+1,durationMs:previous.durationMs+Math.round(performance.now()-begin)};
      }
    },
    finish(context:{organizationId?:string;orderId?:string;status:number}) {
      const safeId=(value:string|undefined)=>value && /^[A-Za-z0-9_-]{1,128}$/.test(value)?value:undefined;
      console.info('[OrderProductionOverrideTiming]',{organizationId:safeId(context.organizationId),orderId:safeId(context.orderId),status:context.status,durationMs:Math.round(performance.now()-started),stages});
    },
  };
}
