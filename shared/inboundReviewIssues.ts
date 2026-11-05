import type { InboundOrderParsedDraft, InboundOrderReviewDraftPayload, InboundOrderReviewDraftSaveRequest } from './inboundOrdersApi';
import { inboundDecisionResolvedByCurrentDraft, inboundDecisionTarget, reviewedLineIndex } from './inboundOrderReadiness';

type Draft = InboundOrderReviewDraftPayload;
export type InboundReviewResolution = NonNullable<Draft['reviewResolutionsJson']>[number];
export type InboundReviewIssue = {
  id: string; field: string; label: string; reason: string; lineIndex: number | null;
  sourceValue: unknown; aiValue: unknown; currentValue: unknown; evidenceIdentity: string;
  sources: { label: string; sourceText?: string | null; sourceDocument?: string | null }[];
  status: 'open' | 'resolved'; resolution: InboundReviewResolution | null;
  canAcceptSource: boolean; disagreement: boolean;
};
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return JSON.stringify(value.map(item => JSON.parse(canonical(item))));
  if (value && typeof value === 'object') return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, JSON.parse(canonical(item))])));
  return JSON.stringify(value ?? null);
};
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export function inboundReviewField(field: string): { section: 'customer' | 'order' | 'line'; key: string; index: number | null } | null {
  let path = field.replace(/\[(\d+)\]/g, '.$1').replace(/^reviewedCustomerJson\./, 'customer.').replace(/^reviewedOrderJson\./, 'order.').replace(/^reviewedLineItemsJson\./, 'lineItems.').replace(/^(?:source|evidence)\./, '');
  const line = path.match(/^lineItems\.(\d+)\.(.+)$/i);
  const section = line ? 'line' : /^customer\./i.test(path) ? 'customer' : /^order\./i.test(path) ? 'order' : null;
  path = line?.[2] ?? path.replace(/^(?:customer|order)\./i, '');
  const aliases: Record<string, string> = { qty: 'quantity', product: 'selectedProductId', productName: 'selectedProductId', material: 'materialText', size: 'dimensions', width: 'dimensions', height: 'dimensions', finishedDimensions: 'dimensions', requestedDueDate: 'dueDate', requestedDeadline: 'deadlineJson', requestedShipMethod: 'shipMethod', shippingMethod: 'shipMethod', requestedPickup: 'fulfillmentType', options: 'optionSelectionsJson', artwork: 'artworkLinks', contact: 'selectedContactId', name: 'companyName' };
  let key = aliases[path] ?? path;
  const target = inboundDecisionTarget({ field: field.replace(/^(?:source|evidence)\./, '') });
  if (target) {
    const canonicalKey = ({ customer:'selectedCustomerId',contact:'selectedContactId',product:'selectedProductId',dimensions:'dimensions',quantity:'quantity',artwork:'artworkLinks','product-options':'optionSelectionsJson',dueDate:'dueDate',fulfillment:'shipMethod' } as const)[target];
    if (!['sourceName','sourceEmail','sourcePhone','companyName','fulfillmentType','deadlineJson'].includes(key)) key = canonicalKey;
  }
  const lineKeys = ['quantity','selectedProductId','dimensions','materialText','printSpecs','optionTexts','finishingTexts','optionSelectionsJson','artworkLinks','notes'];
  const orderKeys = ['poNumber','jobLabel','dueDate','deadlineJson','priority','shipMethod','fulfillmentType','internalNotes','customerNotes','intent'];
  const customerKeys = ['selectedCustomerId','selectedContactId','companyName','sourceName','sourceEmail','sourcePhone','notes'];
  if ((section === 'line' || !section) && lineKeys.includes(key)) return { section: 'line', key, index: line ? Number(line[1]) : reviewedLineIndex(field) };
  if ((section === 'customer' || !section) && customerKeys.includes(key)) return { section: 'customer', key, index: null };
  if ((section === 'order' || !section) && orderKeys.includes(key)) return { section: 'order', key, index: null };
  return null;
}
function currentValue(draft: Draft, field: NonNullable<ReturnType<typeof inboundReviewField>>) {
  if (field.section !== 'line') return ((field.section === 'order' ? draft.reviewedOrderJson : draft.reviewedCustomerJson) as unknown as Record<string,unknown>)[field.key] ?? null;
  const read = (line: Draft['reviewedLineItemsJson'][number]) => field.key === 'dimensions' ? { width: line.width, height: line.height, unit: line.dimensionsUnit ?? 'in' } : (line as unknown as Record<string, unknown>)[field.key] ?? null;
  return field.index == null ? draft.reviewedLineItemsJson.length === 1 ? read(draft.reviewedLineItemsJson[0]) : draft.reviewedLineItemsJson.map(read) : draft.reviewedLineItemsJson[field.index] ? read(draft.reviewedLineItemsJson[field.index]) : null;
}
function interpretation(parsed: InboundOrderParsedDraft | null, field: NonNullable<ReturnType<typeof inboundReviewField>>): unknown {
  if (field.section === 'line' && field.index == null && (parsed?.lineItems.length ?? 0) > 1) return parsed!.lineItems.map((_,index) => interpretation(parsed,{...field,index}));
  const line = parsed?.lineItems[field.index ?? 0];
  if (field.section === 'customer') return parsed?.customer[field.key as keyof InboundOrderParsedDraft['customer']] ?? null;
  if (field.section === 'order') {
    const key = ({ dueDate: 'requestedDueDate', shipMethod: 'requestedShipMethod', fulfillmentType: 'requestedPickup', internalNotes: 'notes' } as Record<string,string>)[field.key] ?? field.key;
    return (parsed?.order as unknown as Record<string,unknown> | undefined)?.[key] ?? null;
  }
  if (field.key === 'dimensions') return line ? { width: line.width, height: line.height, unit: line.dimensionsUnit ?? 'in' } : null;
  return (line as unknown as Record<string,unknown> | undefined)?.[field.key === 'selectedProductId' ? 'productName' : field.key] ?? null;
}
export function isReviewableInboundInterpretation(item: { field?: string | null; fieldPath?: string | null; label?: string; message?: string; reason?: string; code?: string }): boolean {
  // These are technical/business integrity gates, never dismissible AI opinions.
  const text = `${item.field ?? item.fieldPath} ${item.label ?? ''} ${item.reason ?? item.message ?? ''}`;
  return Boolean(inboundReviewField(item.field ?? item.fieldPath ?? ''))
    && !/ownership|linkage|quarantin|malware|unavailable|inaccessible|stale evidence|source evidence changed|credit hold|permission|approval required/i.test(text);
}
export function projectInboundReviewIssues(draft: Draft, parsed: InboundOrderParsedDraft | null): InboundReviewIssue[] {
  const candidates = [
    ...draft.missingDecisionsJson.map(item => ({ id: `decision:${item.field}:${item.label}`, ...item })),
    ...draft.warningsJson.filter(item => /conflict|disagree|mismatch/i.test(item.code) && !/artwork.*size|pdf.*size/i.test(item.code)).map(item => ({ id: `warning:${item.code}:${item.fieldPath ?? ''}`, field: item.fieldPath ?? '', label: item.message, reason: item.message, ...item })),
  ];
  const groups = new Map<string, typeof candidates>();
  for (const item of candidates.filter(isReviewableInboundInterpretation)) {
    const id = inboundReviewIssueId(item.field,draft);
    groups.set(id,[...(groups.get(id) ?? []),item]);
  }
  return Array.from(groups,([id,items]) => ({ ...items[0],id,reason:Array.from(new Set(items.map(item => item.reason))).sort().join(' / ') })).map(item => {
    const field = inboundReviewField(item.field)!;
    const aiValue = interpretation(parsed, field), staffValue = currentValue(draft, field);
    const reconciliationKey = ({ quantity: 'quantity', selectedProductId: 'product', dimensions: 'dimensions', materialText: 'material', dueDate: 'dueDate', priority: 'rushStatus', artworkLinks: 'artworkStatus' } as const)[field.key as 'quantity'];
    const evidence = (field.index == null || field.index === 0) && draft.reviewedLineItemsJson.length <= 1 && reconciliationKey ? parsed?.evidence.reconciliation?.[reconciliationKey] : null;
    const sources = evidence?.sources.map(({ label, sourceText, sourceDocument }) => ({ label, sourceText, sourceDocument })) ?? [];
    const sourceValue = evidence?.value ?? aiValue;
    // Compare canonical numbers, not rendered labels, indices, or a blanket text match.
    const agreeingQuantity = field.key === 'quantity' && Boolean(evidence?.sources.length) && evidence?.value != null && (field.index != null || draft.reviewedLineItemsJson.length === 1)
      && sourceValue != null && Number.isFinite(Number(sourceValue)) && Number(sourceValue) > 0
      && aiValue != null && Number(aiValue) === Number(sourceValue)
      && Number(sourceValue) === Number(staffValue) && evidence?.status !== 'conflict';
    const lineIdentity = field.section === 'line' ? (field.index == null ? draft.reviewedLineItemsJson : draft.reviewedLineItemsJson.slice(field.index,field.index+1))
      .map(line => ({ sourceLineItemId:line.sourceLineItemId,sourceText:line.sourceText })) : null;
    const evidenceIdentity = canonical({ field: item.field, lineIdentity, aiValue, sourceValue, sources, conflict: evidence?.conflicts ?? [], reason: item.reason });
    const resolution = [...(draft.reviewResolutionsJson ?? [])].reverse().find(row => row.issueId === item.id && row.evidenceIdentity === evidenceIdentity && equal(row.confirmedValue, staffValue)) ?? null;
    const disagreement = /conflict|disagree|differ|mismatch/i.test(`${item.reason} ${'code' in item ? item.code : ''}`);
    const acceptsScalar = field.key === 'quantity' && Number(sourceValue) > 0 || ['poNumber','jobLabel','dueDate','shipMethod','materialText','printSpecs','finishingTexts','optionTexts','notes','internalNotes','customerNotes'].includes(field.key) && sourceValue != null;
    return { id: item.id, field: item.field, label: item.label, reason: item.reason, lineIndex: field.index, aiValue, sourceValue, currentValue: staffValue, sources, evidenceIdentity, resolution,
      canAcceptSource: Boolean(acceptsScalar && evidence?.status !== 'conflict' && (field.section !== 'line' || field.index != null || draft.reviewedLineItemsJson.length === 1)),
      disagreement, status: resolution || agreeingQuantity && disagreement || 'status' in item && (item.status !== 'still_blocking' && !(draft.reviewResolutionsJson ?? []).some(row => row.issueId === item.id) || inboundDecisionResolvedByCurrentDraft(draft, item)) ? 'resolved' : 'open' };
  });
}
function inboundReviewIssueId(field: string, draft: Draft): string {
  const resolved = inboundReviewField(field);
  return resolved ? `field:${resolved.section}:${resolved.index ?? (resolved.section === 'line' && draft.reviewedLineItemsJson.length === 1 ? 0 : 'all')}:${resolved.key}` : field;
}
export function applyInboundReviewProjection(draft: Draft, parsed: InboundOrderParsedDraft | null): Draft {
  const issues = projectInboundReviewIssues(draft, parsed);
  return { ...draft,
    missingDecisionsJson: draft.missingDecisionsJson.map(item => {
      const issue = issues.find(issue => issue.id === inboundReviewIssueId(item.field,draft));
      if (issue?.status === 'open' && draft.reviewResolutionsJson?.some(row => row.issueId === issue.id)) return { ...item, status: 'still_blocking', resolutionNote: null };
      return issue?.status === 'resolved' && (issue.disagreement || issue.resolution) ? { ...item, status: 'resolved', resolutionNote: item.resolutionNote ?? 'Resolved against current field evidence or recorded staff review.' } : item;
    }),
    warningsJson: draft.warningsJson.map(item => issues.some(issue => issue.id === inboundReviewIssueId(item.fieldPath ?? '',draft) && issue.status === 'resolved') ? { ...item, acknowledged: true } : item),
  };
}
export function resolveInboundReviewIssue(input: { draft: Draft; parsed: InboundOrderParsedDraft | null; action: NonNullable<InboundOrderReviewDraftSaveRequest['reviewAction']>; actorUserId: string; evidenceFingerprint: string | null; requireReason: boolean; now?: string }): Draft {
  const issue = projectInboundReviewIssues(input.draft, input.parsed).find(issue => issue.id === input.action.issueId);
  if (!issue) throw new Error('This interpretation is no longer reviewable. Reload the draft; canonical validation cannot be dismissed.');
  const reason = input.action.reason?.trim() || null;
  const sourceAgreesWithAi = equal(issue.sourceValue,issue.aiValue) || inboundReviewField(issue.field)?.key === 'quantity' && issue.sourceValue != null && issue.aiValue != null && Number(issue.sourceValue) === Number(issue.aiValue);
  if (input.requireReason && issue.disagreement && (input.action.action !== 'accept_source' || !sourceAgreesWithAi) && !reason) throw new Error('Enter a correction reason required by your organization. Your draft edits are retained.');
  let draft = input.draft;
  if (input.action.action === 'accept_source') {
    if (!issue.canAcceptSource) throw new Error('Select the source value using the canonical field editor; it cannot be applied automatically.');
    const field = inboundReviewField(issue.field)!;
    if (field.section === 'line') draft = { ...draft, reviewedLineItemsJson: draft.reviewedLineItemsJson.map((line,index) => index === (field.index ?? 0) ? { ...line, [field.key]: issue.sourceValue, ...(field.key === 'quantity' ? { quantity: Number(issue.sourceValue), quantitySource: 'staff_selected' as const } : {}) } : line) };
    else draft = { ...draft, [field.section === 'order' ? 'reviewedOrderJson' : 'reviewedCustomerJson']: { ...(field.section === 'order' ? draft.reviewedOrderJson : draft.reviewedCustomerJson), [field.key]: issue.sourceValue } };
  }
  const field = inboundReviewField(issue.field)!;
  if (field.section === 'line') {
    const sourceKey = ({ quantity: 'quantitySource', dimensions: 'dimensionsSource', selectedProductId: 'selectedProductSource', materialText: 'materialSource', printSpecs: 'printSpecsSource', optionTexts: 'optionTextsSource', finishingTexts: 'finishingTextsSource' } as Record<string,string>)[field.key];
    if (sourceKey) draft = { ...draft, reviewedLineItemsJson: draft.reviewedLineItemsJson.map((line,index) => field.index == null || index === field.index ? { ...line, [sourceKey]: 'staff_selected' } : line) };
  }
  if (field.section === 'customer') draft = { ...draft, reviewedCustomerJson: { ...draft.reviewedCustomerJson,
    ...(field.key === 'selectedCustomerId' ? { selectedCustomerSource: 'staff_selected' as const } : {}),
    ...(field.key === 'selectedContactId' ? { selectedContactSource: 'staff_selected' as const } : {}),
  } };
  const confirmedValue = currentValue(draft, inboundReviewField(issue.field)!);
  const row: InboundReviewResolution = { issueId: issue.id, field: issue.field, evidenceIdentity: issue.evidenceIdentity, action: input.action.action, originalInterpretation: issue.aiValue, confirmedValue, evidenceFingerprint: input.evidenceFingerprint, actorUserId: input.actorUserId, createdAt: input.now ?? new Date().toISOString(), reason };
  return { ...draft, reviewResolutionsJson: [...(draft.reviewResolutionsJson ?? []), row] };
}
