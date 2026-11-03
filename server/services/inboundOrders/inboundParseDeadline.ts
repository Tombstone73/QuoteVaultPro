import { randomUUID } from 'node:crypto';
import { INBOUND_PARSE_WORK_MS } from '@shared/inboundParseLifecycle';

export class InboundParseFailure extends Error {
  constructor(readonly code:string, message:string, readonly stage:string) {super(message);}
}
/** Races every external stage, including adapters that ignore AbortSignal. Late
 * values have no continuation into parse persistence. Never logs document data. */
export class InboundParseDeadline {
  readonly controller = new AbortController();
  readonly started = Date.now();
  private readonly expires:number;
  private readonly abort = () => this.controller.abort(this.external?.reason);
  constructor(private readonly identity:{organizationId:string;inboundRecordId:string}, readonly timeoutMs=INBOUND_PARSE_WORK_MS, private readonly external?:AbortSignal, readonly id:string=randomUUID()) {
    this.expires=this.started+timeoutMs;
    external?.addEventListener('abort',this.abort,{once:true});
    if(external?.aborted)this.abort();
  }
  get signal(){return this.controller.signal;}
  async run<T>(stage:string, work:()=>Promise<T>, limitMs=this.timeoutMs, attachmentId?:string):Promise<T>{
    const duration=Math.max(0,Math.min(limitMs,this.expires-Date.now()));
    const start=Date.now();let timer:ReturnType<typeof setTimeout>|undefined;
    let onAbort:()=>void=()=>{};
    const cancelled=()=>this.signal.reason instanceof InboundParseFailure ? this.signal.reason : new InboundParseFailure('parse_cancelled','Parsing cancelled. Staff edits are retained. Review the latest attempt before Retry Parse.',stage);
    console.info('[InboundParse]',{...this.identity,parseAttemptId:this.id,...(attachmentId ? {attachmentId} : {}),stage,event:'started'});
    try{
      if(this.signal.aborted)throw cancelled();
      if(!duration)throw new InboundParseFailure('parse_timeout',`Parsing timed out during ${stage.replace(/_/g,' ')}. Staff edits are retained. Retry Parse.`,stage);
      const stopped=new Promise<never>((_,reject)=>{
        onAbort=()=>reject(cancelled());this.signal.addEventListener('abort',onAbort,{once:true});
        timer=setTimeout(()=>{const error=new InboundParseFailure('parse_timeout',`Parsing timed out during ${stage.replace(/_/g,' ')}. Staff edits are retained. Retry Parse.`,stage);reject(error);this.controller.abort(error);},duration);
      });
      return await Promise.race([Promise.resolve().then(work),stopped]);
    }catch(error){
      console.warn('[InboundParse]',{...this.identity,parseAttemptId:this.id,...(attachmentId ? {attachmentId} : {}),stage,event:'failed',durationMs:Date.now()-start,category:error instanceof InboundParseFailure?error.code:'stage_failed'});
      throw error;
    }finally{if(timer)clearTimeout(timer);this.signal.removeEventListener('abort',onAbort);console.info('[InboundParse]',{...this.identity,parseAttemptId:this.id,...(attachmentId ? {attachmentId} : {}),stage,event:'settled',durationMs:Date.now()-start});}
  }
  dispose(){this.external?.removeEventListener('abort',this.abort);}
}
