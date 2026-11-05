import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, jest, test } from '@jest/globals';
import { InboundReviewIssuesPanel } from './InboundReviewIssuesPanel';
import type { InboundReviewIssue } from '@shared/inboundReviewIssues';
let host:HTMLDivElement,root:Root;
const issue:InboundReviewIssue={ id:'quantity',field:'lineItems.0.quantity',label:'Confirm quantity',reason:'Email quantity differs from interpretation.',lineIndex:0,
  aiValue:3,sourceValue:5,currentValue:3,evidenceIdentity:'field-v1',sources:[{label:'Email',sourceText:'Please quote five.'}],status:'open',resolution:null,canAcceptSource:true,disagreement:true };
beforeEach(()=>{Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(()=>{act(()=>root.unmount());host.remove();});
test('compact disclosure separates actual blockers, unresolved interpretations and resolved history',()=>{
  const edit=jest.fn();act(()=>root.render(<InboundReviewIssuesPanel issues={[issue,{...issue,id:'resolved',status:'resolved'}]} blockerCount={2} pending={false} requireReason={false} onEdit={edit} onResolve={async()=>{}}/>));
  expect(host.querySelector('details')?.open).toBe(false);expect(host.querySelector('summary')?.textContent).toContain('1 unresolved · 2 actual blockers · 1 resolved');
  expect(host.querySelector('.overflow-y-auto')?.className).toContain('max-h-80');
  const editButton=Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Edit field')!;act(()=>editButton.click());expect(edit).toHaveBeenCalledWith(issue);
  expect(host.textContent).toContain('Source: 5');expect(host.textContent).toContain('AI interpretation: 3');expect(host.textContent).toContain('Current staff value: 3');
});
test('a failed correction leaves the current field and reason visible with a specific retryable error',async()=>{
  const save=jest.fn<()=>Promise<void>>(async()=>{throw new Error('Saved draft changed. Reload before confirming.');});
  act(()=>root.render(<InboundReviewIssuesPanel issues={[issue]} blockerCount={1} pending={false} requireReason onEdit={()=>{}} onResolve={save}/>));
  expect(host.querySelector('input')?.placeholder).toContain('required');
  await act(async()=>Array.from(host.querySelectorAll('button')).find(button=>button.textContent==='Confirm current value')!.click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Saved draft changed');expect(host.textContent).toContain('Current staff value: 3');
  expect(save).toHaveBeenCalledWith({issueId:'quantity',action:'confirm_current',reason:null});
});
test('resolving and background updates do not expand the disclosure',()=>{
  const render=(issues:InboundReviewIssue[])=>act(()=>root.render(<InboundReviewIssuesPanel issues={issues} blockerCount={0} pending={false} requireReason={false} onEdit={()=>{}} onResolve={async()=>{}}/>));
  render([issue]);render([{...issue,status:'resolved'}]);expect(host.querySelector('summary')?.textContent).toContain('0 unresolved');expect(host.querySelector('details')?.open).toBe(false);
});
