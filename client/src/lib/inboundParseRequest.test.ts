import { boundedInboundParse } from './inboundParseRequest';
test('a transport that ignores abort still times out, and a late value has no success continuation',async()=>{
  let release!:(value:string)=>void;const success=jest.fn();
  const controller=new AbortController();
  const pending=boundedInboundParse(()=>new Promise<string>(resolve=>{release=resolve;}),controller,20).then(success);
  await expect(pending).rejects.toThrow('Parsing timed out');expect(controller.signal.aborted).toBe(true);
  release('late');await Promise.resolve();expect(success).not.toHaveBeenCalled();
});
test('explicit cancellation settles promptly and a new request can succeed',async()=>{
  const controller=new AbortController();const pending=boundedInboundParse(()=>new Promise(()=>{}),controller);
  controller.abort();await expect(pending).rejects.toThrow('Parsing cancelled');
  await expect(boundedInboundParse(async()=> 'confirmed')).resolves.toBe('confirmed');
});
