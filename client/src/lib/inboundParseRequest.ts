import { INBOUND_PARSE_REQUEST_MS } from '@shared/inboundParseLifecycle';
/** Bound headers AND body consumption, even when a transport ignores cancellation. */
export async function boundedInboundParse<T>(work:(signal:AbortSignal)=>Promise<T>,controller=new AbortController(),timeoutMs=INBOUND_PARSE_REQUEST_MS):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;let abort:()=>void=()=>{};
  try{
    if(controller.signal.aborted)throw new Error('Parsing cancelled. Staff edits are retained. Review the latest attempt before Retry Parse.');
    const stopped=new Promise<never>((_,reject)=>{
      abort=()=>reject(new Error('Parsing cancelled. Staff edits are retained. Review the latest attempt before Retry Parse.'));
      controller.signal.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>{reject(new Error('Parsing timed out. Staff edits are retained. Review the latest attempt, then Retry Parse; an active server attempt may need a few seconds to expire.'));controller.abort();},timeoutMs);
    });
    return await Promise.race([Promise.resolve().then(()=>work(controller.signal)),stopped]);
  }finally{if(timer)clearTimeout(timer);controller.signal.removeEventListener('abort',abort);}
}
