import { describe, expect, it, jest } from "@jest/globals";
import { orchestrateOrderSave, type OrderSaveStep } from "./orderSaveOrchestration";

const ok: OrderSaveStep = async () => ({ ok: true });
const fail = (error: string): OrderSaveStep => async () => ({ ok: false, error });

describe("orchestrateOrderSave", () => {
  it("saves the open dirty line item before order-level changes", async () => {
    const calls: string[] = [];
    const result = await orchestrateOrderSave({
      hasDirtyLineItem: true,
      saveDirtyLineItem: async () => {
        calls.push("lineItem");
        return { ok: true };
      },
      hasOrderLevelChanges: true,
      saveOrderLevelChanges: async () => {
        calls.push("order");
        return { ok: true };
      },
    });
    expect(calls).toEqual(["lineItem", "order"]);
    expect(result).toEqual({ ok: true });
  });

  it("stops and does NOT save order-level changes when the line item save fails", async () => {
    const saveOrderLevelChanges = jest.fn(ok);
    const result = await orchestrateOrderSave({
      hasDirtyLineItem: true,
      saveDirtyLineItem: fail("line item boom"),
      hasOrderLevelChanges: true,
      saveOrderLevelChanges,
    });
    expect(saveOrderLevelChanges).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, failedStep: "lineItem", error: "line item boom" });
  });

  it("saves order-level changes after the line item save succeeds", async () => {
    const saveOrderLevelChanges = jest.fn(ok);
    const result = await orchestrateOrderSave({
      hasDirtyLineItem: true,
      saveDirtyLineItem: ok,
      hasOrderLevelChanges: true,
      saveOrderLevelChanges,
    });
    expect(saveOrderLevelChanges).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
  });

  it("skips the line item save when no line item is dirty", async () => {
    const saveDirtyLineItem = jest.fn(ok);
    const result = await orchestrateOrderSave({
      hasDirtyLineItem: false,
      saveDirtyLineItem,
      hasOrderLevelChanges: true,
      saveOrderLevelChanges: ok,
    });
    expect(saveDirtyLineItem).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it("skips the order-level save when there are no order-level changes", async () => {
    const saveOrderLevelChanges = jest.fn(ok);
    const result = await orchestrateOrderSave({
      hasDirtyLineItem: true,
      saveDirtyLineItem: ok,
      hasOrderLevelChanges: false,
      saveOrderLevelChanges,
    });
    expect(saveOrderLevelChanges).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it("reports an order-step failure without re-running the (already saved) line item", async () => {
    const saveDirtyLineItem = jest.fn(ok);
    const result = await orchestrateOrderSave({
      hasDirtyLineItem: true,
      saveDirtyLineItem,
      hasOrderLevelChanges: true,
      saveOrderLevelChanges: fail("order boom"),
    });
    expect(saveDirtyLineItem).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, failedStep: "order", error: "order boom" });
  });

  it("succeeds as a no-op when nothing is dirty", async () => {
    const result = await orchestrateOrderSave({
      hasDirtyLineItem: false,
      saveDirtyLineItem: fail("should not run"),
      hasOrderLevelChanges: false,
      saveOrderLevelChanges: fail("should not run"),
    });
    expect(result).toEqual({ ok: true });
  });
});
