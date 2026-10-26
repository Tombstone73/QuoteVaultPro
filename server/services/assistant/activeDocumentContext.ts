type AttachmentMessage = { role: string; attachmentIds?: readonly string[] };

/** A later upload replaces the active document set. Clarifications after that
 * upload retain its evidence, while earlier document conclusions stay out of
 * the model's active history. Multiple files attached in one turn stay together. */
export function activeDocumentContext<T extends AttachmentMessage>(history: readonly T[], currentAttachmentIds: readonly string[]) {
  const sources = history.flatMap((message, index) => message.role === "user" && message.attachmentIds?.length
    ? [{ index, ids: [...message.attachmentIds] }] : []);
  const latest = sources.at(-1);
  const sameSet = (left: readonly string[], right: readonly string[]) => {
    if (left.length !== right.length) return false;
    const sortedRight = [...right].sort();
    return [...left].sort().every((id, index) => id === sortedRight[index]);
  };
  const priorSourceChanged = Boolean(latest && sources.some((source) => source.index < latest.index && !sameSet(source.ids, latest.ids)));
  if (currentAttachmentIds.length) {
    const replacesPrior = Boolean(latest && !sameSet(latest.ids, currentAttachmentIds));
    return { history: replacesPrior ? [] as T[] : priorSourceChanged ? history.slice(latest!.index) : [...history], priorAttachmentIds: [] as string[], activeAttachmentIds: [...currentAttachmentIds], replacesPrior, priorSourceChanged };
  }
  if (!latest) return { history: [...history], priorAttachmentIds: [] as string[], activeAttachmentIds: [] as string[], replacesPrior: false, priorSourceChanged: false };
  return {
    history: priorSourceChanged ? history.slice(latest.index) : [...history],
    priorAttachmentIds: latest.ids,
    activeAttachmentIds: latest.ids,
    replacesPrior: false,
    priorSourceChanged,
  };
}
