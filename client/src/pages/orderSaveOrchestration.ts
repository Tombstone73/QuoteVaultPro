/**
 * Save Order orchestration.
 *
 * Save Order is the "save all dirty work on this page" action. It persists, in
 * strict order:
 *   1. the open dirty line item
 *   2. order-level field edits
 *
 * A failure at step 1 aborts before any order-level write, so the order can
 * never be saved on top of an unsaved line item draft.
 */

export type OrderSaveStepResult = { ok: boolean; error?: string };
export type OrderSaveStep = () => Promise<OrderSaveStepResult>;

export type OrchestrateOrderSaveResult =
  | { ok: true }
  | { ok: false; failedStep: "lineItem" | "order"; error?: string };

export async function orchestrateOrderSave(input: {
  hasDirtyLineItem: boolean;
  saveDirtyLineItem: OrderSaveStep;
  hasOrderLevelChanges: boolean;
  saveOrderLevelChanges: OrderSaveStep;
}): Promise<OrchestrateOrderSaveResult> {
  const { hasDirtyLineItem, saveDirtyLineItem, hasOrderLevelChanges, saveOrderLevelChanges } = input;

  // Step 1 — open dirty line item first.
  if (hasDirtyLineItem) {
    const result = await saveDirtyLineItem();
    if (!result.ok) {
      // Abort: do not touch order-level fields, keep all dirty state.
      return { ok: false, failedStep: "lineItem", error: result.error };
    }
  }

  // Step 2 — order-level field edits, only after the line item succeeded.
  if (hasOrderLevelChanges) {
    const result = await saveOrderLevelChanges();
    if (!result.ok) {
      return { ok: false, failedStep: "order", error: result.error };
    }
  }

  return { ok: true };
}
