import assert from "node:assert/strict";
import { canMoveProductBuilderItem, moveProductBuilderItem } from "./ordering";

const optionA = { optionId: "option-a", selectionKey: "size" };
const optionB = { optionId: "option-b", selectionKey: "finish" };
const optionC = { optionId: "option-c", selectionKey: "proof" };
const original = [optionA, optionB, optionC] as const;
const reordered = moveProductBuilderItem(original, 2, 0);

assert.deepEqual(reordered.map((item) => item.optionId), ["option-c", "option-a", "option-b"]);
assert.equal(reordered[0], optionC, "reordering moves the existing stable object rather than recreating it");
assert.equal(reordered[0]?.selectionKey, "proof", "stable references survive a display-order change");
assert.equal(moveProductBuilderItem(original, -1, 0), original, "out-of-range moves leave the source collection untouched");
assert.equal(moveProductBuilderItem(original, 1, 1), original, "a no-op move preserves the original collection");
assert.equal(canMoveProductBuilderItem(original, 0, -1), false);
assert.equal(canMoveProductBuilderItem(original, 0, 1), true);
assert.equal(canMoveProductBuilderItem(original, 2, 1), false);

console.log("Product Builder persisted collection ordering tests passed.");
