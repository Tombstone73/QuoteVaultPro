/** QuickBooks allows at most 21 characters in PaymentRefNum. The sequence is
 * allocated and persisted per tenant before any provider mutation. */
export const quickBooksPaymentReference = (sequence: string): string => {
  if (!/^[1-9]\d{0,16}$/.test(sequence)) throw new Error("QuickBooks Payment reference sequence is invalid.");
  return `PMT-${sequence}`;
};
