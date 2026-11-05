import { useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { InboundReviewIssue } from '@shared/inboundReviewIssues';
import type { InboundOrderReviewDraftSaveRequest } from '@shared/inboundOrdersApi';
const text = (value: unknown) => value == null ? 'Not supplied' : typeof value === 'object' ? JSON.stringify(value) : String(value);
export function InboundReviewIssuesPanel({ issues, blockerCount, requireReason, pending, onEdit, onResolve }: {
  issues: InboundReviewIssue[]; blockerCount: number; requireReason: boolean; pending: boolean;
  onEdit: (issue: InboundReviewIssue) => void;
  onResolve: (action: NonNullable<InboundOrderReviewDraftSaveRequest['reviewAction']>) => Promise<void>;
}) {
  const [reasons,setReasons] = useState<Record<string,string>>({}), [error,setError] = useState<string | null>(null);
  const unresolved = issues.filter(issue => issue.status === 'open'), resolved = issues.filter(issue => issue.status === 'resolved');
  async function resolve(issue: InboundReviewIssue, action: NonNullable<InboundOrderReviewDraftSaveRequest['reviewAction']>['action']) {
    setError(null);
    try { await onResolve({ issueId: issue.id, action, reason: reasons[issue.id]?.trim() || null }); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Correction was not saved. Your edits are retained.'); }
  }
  return <details className="my-2 rounded-md border bg-card text-card-foreground" data-testid="inbound-review-issues" data-clean-resolution-target="review">
    <summary className="cursor-pointer px-3 py-2 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
      AI review · {unresolved.length} unresolved · {blockerCount} actual blockers · {resolved.length} resolved
    </summary>
    <div className="max-h-80 space-y-3 overflow-y-auto border-t p-3">
      <p className="text-xs text-muted-foreground">Staff decisions resolve interpretations. Product, pricing, source reconciliation, safety and permission checks still apply.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {unresolved.map(issue => <section key={issue.id} className="rounded border p-2 text-xs">
        <button type="button" onClick={() => onEdit(issue)} className="flex items-start gap-2 text-left font-semibold underline focus-visible:outline focus-visible:outline-2"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />{issue.label}</button>
        <p className="mt-1 break-words">{issue.field} · {issue.reason}</p>
        <dl className="mt-2 grid gap-1 break-words"><div><dt className="inline font-medium">Source: </dt><dd className="inline">{text(issue.sourceValue)}</dd></div><div><dt className="inline font-medium">AI interpretation: </dt><dd className="inline">{text(issue.aiValue)}</dd></div><div><dt className="inline font-medium">Current staff value: </dt><dd className="inline">{text(issue.currentValue)}</dd></div></dl>
        {issue.sources.map((source,index) => <p key={index} className="mt-1 break-words text-muted-foreground">{source.sourceDocument || source.label}: {source.sourceText}</p>)}
        <Input className="mt-2 h-8" aria-label={`Correction reason: ${issue.label}`} placeholder={requireReason && issue.disagreement ? 'Reason required for confirmation' : 'Reason (optional)'} value={reasons[issue.id] ?? ''} onChange={event => setReasons(current => ({ ...current, [issue.id]: event.target.value }))} />
        <div className="mt-2 flex flex-wrap gap-1">
          <Button size="sm" variant="outline" type="button" onClick={() => onEdit(issue)}>Edit field</Button>
          {issue.canAcceptSource && <Button size="sm" variant="outline" type="button" disabled={pending} onClick={() => void resolve(issue,'accept_source')}>Accept source value</Button>}
          <Button size="sm" variant="outline" type="button" disabled={pending} onClick={() => void resolve(issue,'confirm_current')}>Confirm current value</Button>
          <Button size="sm" variant="ghost" type="button" disabled={pending} onClick={() => void resolve(issue,'interpretation_incorrect')}>Interpretation incorrect</Button>
          <Button size="sm" variant="ghost" type="button" disabled={pending} onClick={() => void resolve(issue,'dismiss')}>Dismiss inapplicable warning</Button>
        </div>
      </section>)}
      <details><summary className="cursor-pointer text-xs font-medium">Resolved interpretations and history ({resolved.length})</summary>
        <ul className="mt-2 space-y-2 text-xs">{resolved.map(issue => <li key={issue.id} className="break-words"><CheckCircle2 className="mr-1 inline h-4 w-4 text-green-700 dark:text-green-300" aria-hidden="true" />{issue.label} · {issue.resolution ? `${issue.resolution.action} by ${issue.resolution.actorUserId} at ${issue.resolution.createdAt}${issue.resolution.reason ? ` · ${issue.resolution.reason}` : ''}` : 'Current draft satisfies this observation.'}</li>)}</ul>
      </details>
    </div>
  </details>;
}
