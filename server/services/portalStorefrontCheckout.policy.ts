/** Checkout policy shared by the portal session and transaction boundary. */
export function canPortalPlaceOrder(accessRole: string | null | undefined, staffPreview: boolean): boolean {
  return !staffPreview && (accessRole === 'BUYER' || accessRole === 'COMPANY_ADMIN');
}

export function isCurrentCartReview(input: {
  reviewToken: string;
  cartVersion: number;
  savedToken: string | null | undefined;
  savedVersion: number | null | undefined;
}): boolean {
  return input.reviewToken === input.savedToken && input.cartVersion === input.savedVersion;
}
