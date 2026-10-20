import { isCommerciallyRemovedLine } from "../lineItemBundles";

type PreviewAttachment = {
  orderId: string;
  orderLineItemId: string | null;
  linkedLineItemId: string | null;
  linkedLineStatus: string | null;
  fileRecordId: string | null;
};

/** Retain Order-level files and files with a current line association only. */
export function selectCurrentOrderPreviewAttachments<T extends PreviewAttachment>(attachments: T[]): T[] {
  const seenFiles = new Set<string>();
  return attachments.filter((attachment) => {
    if (attachment.orderLineItemId && (
      !attachment.linkedLineItemId ||
      isCommerciallyRemovedLine({ status: attachment.linkedLineStatus })
    )) return false;

    if (!attachment.fileRecordId) return true;
    const identity = `${attachment.orderId}:${attachment.fileRecordId}`;
    if (seenFiles.has(identity)) return false;
    seenFiles.add(identity);
    return true;
  });
}
