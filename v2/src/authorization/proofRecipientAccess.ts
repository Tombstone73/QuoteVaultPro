/** Narrow Auth operation used only inside an authorized Proof issuance transaction.
 * It does not issue invitations, credentials, sessions, or define portal lifecycle policy.
 */
export type ProofRecipientAccessInput = Readonly<{
  organizationId: string;
  proofVersionId: string;
  recipientContactId: string;
  staffActorUserId?: string;
}>;

export type ProofRecipientAccessResult = Readonly<{
  portalAccessId: string;
  contactId: string;
  customerId: string;
  email: string;
  displayName: string;
}>;

export interface ProofRecipientAccess {
  ensureForProofIssue(input: ProofRecipientAccessInput): Promise<ProofRecipientAccessResult>;
}
