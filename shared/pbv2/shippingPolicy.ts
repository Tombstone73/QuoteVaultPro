export function isPbv2PickupOnly(tree: unknown): boolean {
  const meta = (tree as { meta?: { shippingConfig?: { shippingPolicy?: string }; productIntake?: unknown } } | null)?.meta;
  // Intake opens with Pickup Only until staff choose a shipping policy.
  const policy = meta?.shippingConfig?.shippingPolicy ?? (meta?.productIntake ? "pickup_only" : null);
  return policy === "pickup_only";
}
