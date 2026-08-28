import { describe, expect, test } from "@jest/globals";
import { completeDeferredProductLifecycle, isolateProductEditorLifecycleChange } from "./productEditorLifecycleSave";

describe("completeDeferredProductLifecycle", () => {
  test("keeps unchanged active availability out of an ordinary Draft save", () => {
    const result = isolateProductEditorLifecycleChange({
      isNewProduct: false,
      currentIsActive: true,
      payload: { name: "Banner", isActive: true },
    });

    expect(result).toEqual({
      productPayload: { name: "Banner" },
      deferredLifecycle: null,
    });
  });

  test("defers only an explicit availability transition", () => {
    const result = isolateProductEditorLifecycleChange({
      isNewProduct: false,
      currentIsActive: true,
      payload: { name: "Banner", isActive: false },
    });

    expect(result).toEqual({
      productPayload: { name: "Banner" },
      deferredLifecycle: { desiredIsActive: false },
    });
  });

  test("publishes an unpublished draft before activating the Product", async () => {
    const calls: string[] = [];

    await completeDeferredProductLifecycle({
      shouldApplyLifecycle: true,
      desiredIsActive: true,
      draftId: "draft_1",
      publishDraft: async ({ treeVersionId, activateProduct }) => {
        calls.push(`publish:${treeVersionId}:${activateProduct}`);
        return { productIsActive: true };
      },
      updateLifecycle: async () => calls.push("lifecycle"),
    });

    expect(calls).toEqual(["publish:draft_1:true"]);
  });

  test("does not activate when publication fails or warnings require confirmation", async () => {
    const lifecycle = jest.fn<() => Promise<void>>();

    await expect(completeDeferredProductLifecycle({
      shouldApplyLifecycle: true,
      desiredIsActive: true,
      draftId: "draft_1",
      publishDraft: async () => {
        throw new Error("PBV2 publish warnings require confirmation");
      },
      updateLifecycle: lifecycle,
    })).rejects.toThrow("warnings require confirmation");

    expect(lifecycle).not.toHaveBeenCalled();
  });

  test("uses the shared lifecycle operation for deactivation and legacy no-draft Products", async () => {
    const calls: string[] = [];
    const updateLifecycle = async (isActive: boolean) => calls.push(`lifecycle:${isActive}`);
    const publishDraft = async () => {
      calls.push("publish");
      return { productIsActive: true };
    };

    await completeDeferredProductLifecycle({ shouldApplyLifecycle: true, desiredIsActive: false, draftId: "draft_1", publishDraft, updateLifecycle });
    await completeDeferredProductLifecycle({ shouldApplyLifecycle: true, desiredIsActive: true, draftId: null, publishDraft, updateLifecycle });

    expect(calls).toEqual(["lifecycle:false", "lifecycle:true"]);
  });

  test("uses lifecycle after an already-published or auto-published draft remains inactive", async () => {
    const calls: string[] = [];
    await completeDeferredProductLifecycle({
      shouldApplyLifecycle: true,
      desiredIsActive: true,
      draftId: "draft_1",
      draftAlreadyPublished: true,
      publishDraft: async () => {
        calls.push("publish");
        return { productIsActive: false };
      },
      updateLifecycle: async (isActive) => calls.push(`lifecycle:${isActive}`),
    });

    expect(calls).toEqual(["lifecycle:true"]);
  });

  test("does not report completion when the final lifecycle transition fails", async () => {
    const calls: string[] = [];

    await expect(completeDeferredProductLifecycle({
      shouldApplyLifecycle: true,
      desiredIsActive: true,
      draftId: "draft_1",
      draftAlreadyPublished: true,
      publishDraft: async () => ({ productIsActive: false }),
      updateLifecycle: async () => {
        calls.push("lifecycle:true");
        throw new Error("PBV2_DRAFT_MUST_BE_PUBLISHED");
      },
    })).rejects.toThrow("PBV2_DRAFT_MUST_BE_PUBLISHED");

    expect(calls).toEqual(["lifecycle:true"]);
  });

  test("does nothing when lifecycle is unchanged", async () => {
    const publishDraft = jest.fn(async () => ({ productIsActive: true }));
    const updateLifecycle = jest.fn(async () => undefined);
    await completeDeferredProductLifecycle({ shouldApplyLifecycle: false, desiredIsActive: true, draftId: "draft_1", publishDraft, updateLifecycle });
    expect(publishDraft).not.toHaveBeenCalled();
    expect(updateLifecycle).not.toHaveBeenCalled();
  });
});
