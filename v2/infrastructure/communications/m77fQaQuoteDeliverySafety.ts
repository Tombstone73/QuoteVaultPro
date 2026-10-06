import { isM77fQaDevTarget, M77F_QA_ORGANIZATION_ID } from "./m77fQaProofDeliverySafety.js";
import { V2ApplicationError } from "../../src/errors/applicationError.js";
import type { QuoteDeliverySuppression } from "../../src/modules/sales/contracts.js";
import { canonicalJson } from "../../src/modules/shared/commercialValues.js";
import { SUPPRESSED_DELIVERY_STATE } from "../../src/modules/shared/deliveryStates.js";

export const M77F_QUOTE_RECIPIENT = "quote-final-four@example.invalid";
export const QUOTE_SUPPRESSED_TRANSPORT = "dev_qa_suppressed";
const context = (organizationId: string, recipientEmail: string): QuoteDeliverySuppression => ({
  schemaVersion: 1, deliveryMode: SUPPRESSED_DELIVERY_STATE, providerCall: "not_attempted",
  environment: "dev_qa", scope: "m77f_qa_dev_only", organizationId, recipientEmail,
});

export const isAllowedQuoteSuppression = (organizationId: string, recipient: string, evidence: unknown): evidence is QuoteDeliverySuppression => {
  try {
    return isM77fQaDevTarget(organizationId) && recipient === M77F_QUOTE_RECIPIENT
      && !!evidence && canonicalJson(evidence) === canonicalJson(context(organizationId, recipient));
  } catch { return false; }
};

/** A reserved QA identity must never fall through to Gmail when its guard drifts. */
export const quoteDeliverySuppression = (organizationId: string, recipient: string): QuoteDeliverySuppression | undefined => {
  if (isM77fQaDevTarget(organizationId) && recipient === M77F_QUOTE_RECIPIENT) return context(organizationId, recipient);
  if (organizationId === M77F_QA_ORGANIZATION_ID || recipient.toLowerCase() === M77F_QUOTE_RECIPIENT)
    throw new V2ApplicationError("CONFLICT", "Quote QA delivery requires the exact DEV target and approved synthetic recipient. No email was attempted.");
  return undefined;
};

export const requireAllowedQuoteSuppression = (organizationId: string, recipient: string, evidence: unknown): void => {
  if (!isAllowedQuoteSuppression(organizationId, recipient, evidence))
    throw new V2ApplicationError("CONFLICT", "Suppressed Quote evidence is unavailable outside its exact DEV QA scope. No email was attempted.");
};
