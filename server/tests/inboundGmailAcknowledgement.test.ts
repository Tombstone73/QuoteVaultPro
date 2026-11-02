import { describe, expect, jest, test } from '@jest/globals';
import { GmailAcknowledgementAdapter } from '../services/inboundOrders/InboundGmailAcknowledgementWorker';
import { GMAIL_MODIFY_SCOPE } from '@shared/inboundGmailAcknowledgement';
import { planInboundGmailMailboxConnection } from '../services/inboundEmailMailboxSettingsService';
import { inboundEmailMessageManifest } from '@shared/inboundEmailMessageManifest';

const mailbox:any={id:'mailbox',organizationId:'tenant',provider:'gmail',emailAddress:'synthetic@example.invalid',authJson:{scope:GMAIL_MODIFY_SCOPE}};
function provider(existing=true){
  let labels:any[]=existing?[{id:'entered-label',name:'Entered',type:'user'}]:[];
  const list=jest.fn(async()=>({data:{labels}}));
  const create=jest.fn(async()=>{labels=[{id:'entered-label',name:'Entered',type:'user'}];return {data:{id:'entered-label'}};});
  const modify=jest.fn(async()=>({}));
  const scope=jest.fn(async()=>({scopes:[GMAIL_MODIFY_SCOPE]}));
  const profile=jest.fn(async()=>({data:{emailAddress:mailbox.emailAddress}}));
  const factory=()=>({auth:{getAccessToken:async()=>({token:'synthetic'}),getTokenInfo:scope},gmail:{users:{getProfile:profile,labels:{list,create},messages:{batchModify:modify}}}});
  return {adapter:new GmailAcknowledgementAdapter(factory as any),list,create,modify,scope,profile};
}
describe('message-level Gmail acknowledgement boundary',()=>{
  test('existing Entered label modifies exactly frozen messages and only UNREAD/Entered labels',async()=>{
    const p=provider(),guard=jest.fn(async()=>undefined);await p.adapter.acknowledge(mailbox,['reviewed-1','reviewed-2'],guard);
    expect(p.create).not.toHaveBeenCalled();expect(p.modify).toHaveBeenCalledWith({userId:'me',requestBody:{ids:['reviewed-1','reviewed-2'],addLabelIds:['entered-label'],removeLabelIds:['UNREAD']}});expect(guard).toHaveBeenCalledTimes(1);
  });
  test('missing label is created once and a repeated update reuses it',async()=>{
    const p=provider(false);await p.adapter.acknowledge(mailbox,['reviewed'],async()=>{});await p.adapter.acknowledge(mailbox,['reviewed'],async()=>{});
    expect(p.create).toHaveBeenCalledTimes(1);expect(p.modify).toHaveBeenCalledTimes(2);
  });
  test('lost label-create response re-lists the remotely committed label instead of inventing a duplicate',async()=>{
    const p=provider(false);p.create.mockImplementationOnce(async()=>{p.list.mockResolvedValue({data:{labels:[{id:'remote-created',name:'Entered',type:'user'}]}});throw new Error('Lost response');});
    await p.adapter.acknowledge(mailbox,['covered'],async()=>{});expect(p.create).toHaveBeenCalledTimes(1);
    expect(p.modify).toHaveBeenCalledWith(expect.objectContaining({requestBody:expect.objectContaining({addLabelIds:['remote-created']})}));
  });
  test('a lost modify response can safely repeat the same monotonic message operation',async()=>{
    const p=provider();p.modify.mockRejectedValueOnce(new Error('Response lost after remote commit'));
    await expect(p.adapter.acknowledge(mailbox,['covered'],async()=>{})).rejects.toThrow();await p.adapter.acknowledge(mailbox,['covered'],async()=>{});
    expect(p.modify.mock.calls[0]).toEqual(p.modify.mock.calls[1]);
  });
  test('actual refreshed-token scope and provider account must match before any write',async()=>{
    const p=provider(false);p.scope.mockResolvedValueOnce({scopes:['https://www.googleapis.com/auth/gmail.readonly']});
    await expect(p.adapter.acknowledge(mailbox,['covered'],async()=>{})).rejects.toMatchObject({ackStatus:'reconnect_required'});
    p.profile.mockResolvedValueOnce({data:{emailAddress:'other@example.invalid'}});
    await expect(p.adapter.acknowledge(mailbox,['covered'],async()=>{})).rejects.toMatchObject({ackStatus:'needs_attention'});
    expect(p.create).not.toHaveBeenCalled();expect(p.modify).not.toHaveBeenCalled();
  });
  test('a fence failure prevents label creation or modification',async()=>{
    const p=provider(false);await expect(p.adapter.acknowledge(mailbox,['covered'],async()=>{throw new Error('Lease lost');})).rejects.toThrow('Lease lost');
    expect(p.create).not.toHaveBeenCalled();expect(p.modify).not.toHaveBeenCalled();
  });
  test('manifest identity is stable, bounded by persisted evidence, and does not expand a thread',()=>{
    const a:any={sourceType:'email',sourceMessageId:'one',rawPayloadJson:{provider:'gmail',mailbox:{id:'m',emailAddress:'TEST@example.invalid'},messageId:'one',thread:{messages:[{messageId:'two'},{messageId:'one'}]}}};
    const first=inboundEmailMessageManifest(a);a.rawPayloadJson.thread.messages.reverse();expect(inboundEmailMessageManifest(a)).toEqual(first);expect(first?.messageIds).toEqual(['one','two']);
    expect(inboundEmailMessageManifest({sourceType:'manual'})).toBeNull();
  });
});
describe('refresh credential continuity',()=>{
  const previous={id:'existing',name:'Inbox',emailAddress:'same@example.invalid',enabled:false,isDefault:true,authJson:{refreshToken:'retained-token',scope:'readonly',connectedEmail:'same@example.invalid'}};
  test('same verified account may omit replacement refresh credentials',()=>{
    const plan=planInboundGmailMailboxConnection({currentMailboxes:[previous],emailAddress:'same@example.invalid',reconnectMailboxId:previous.id,authJson:{refreshToken:undefined,scope:GMAIL_MODIFY_SCOPE}});
    expect(plan.values.authJson).toMatchObject({refreshToken:'retained-token',scope:GMAIL_MODIFY_SCOPE});expect((plan.values as any).enabled).toBeUndefined();
  });
  test('different account cannot inherit the previous refresh token',()=>{
    expect(()=>planInboundGmailMailboxConnection({currentMailboxes:[previous],emailAddress:'different@example.invalid',reconnectMailboxId:previous.id,authJson:{refreshToken:undefined}})).toThrow('No reusable');
    expect(previous.authJson.refreshToken).toBe('retained-token');
  });
  test('new account without refresh credentials fails closed',()=>{
    expect(()=>planInboundGmailMailboxConnection({currentMailboxes:[],emailAddress:'new@example.invalid',authJson:{}})).toThrow('No reusable');
  });
  test('replacement refresh token does not retain a legacy OAuth client configuration',()=>{
    const existing={...previous,authJson:{...previous.authJson,clientId:'legacy-client',clientSecret:'legacy-client-secret'}};
    const plan=planInboundGmailMailboxConnection({currentMailboxes:[existing],emailAddress:existing.emailAddress,reconnectMailboxId:existing.id,authJson:{refreshToken:'replacement',scope:GMAIL_MODIFY_SCOPE}});
    expect(plan.values.authJson).toEqual({refreshToken:'replacement',scope:GMAIL_MODIFY_SCOPE});
  });
});
