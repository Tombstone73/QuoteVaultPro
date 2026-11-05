import { apiRequest } from '@/lib/queryClient';

export class CloseJobOverrideTimeout extends Error {
  constructor() { super('The request timed out. It may have completed on the server. Refresh the live preview before retrying; do not assume it rolled back.'); }
}

/** A network timeout is an unknown outcome, never permission to replay silently. */
export async function closeJobOverrideRequest(method: string, path: string, body?: unknown, timeoutMs=45_000) {
  const controller=new AbortController();
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_resolve,reject)=>{
    timer=setTimeout(()=>{reject(new CloseJobOverrideTimeout());controller.abort();},timeoutMs);
  });
  try {
    return await Promise.race([timeout,(async()=>{
      const response=await apiRequest(method,path,body,{signal:controller.signal});
      const payload=await response.json();
      if(payload?.success!==true) throw new Error(payload?.message || 'The server did not confirm this operation. Refresh the live preview before retrying.');
      return payload;
    })()]);
  } finally {if(timer)clearTimeout(timer);}
}
