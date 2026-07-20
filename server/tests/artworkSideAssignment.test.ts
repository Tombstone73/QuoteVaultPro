import { removeArtworkFileReferencesFromSpecs } from "@shared/artworkSideAssignment";

describe("removeArtworkFileReferencesFromSpecs", () => {
  it("clears Front/Back/Both references while preserving unrelated specs", () => {
    expect(removeArtworkFileReferencesFromSpecs({
      specsJson: {
        notes: "Keep me",
        artworkSideAssignment: {
          frontFileId: "front-1",
          backFileId: "back-1",
          bothFileId: "both-1",
          useSameArtworkBothSides: true,
        },
      },
      fileIds: ["both-1"],
      removedSide: "both",
    })).toEqual({
      notes: "Keep me",
      artworkSideAssignment: {
        frontFileId: "front-1",
        backFileId: "back-1",
        useSameArtworkBothSides: false,
      },
    });
  });

  it("clears same-artwork intent when the removed Both row has no stored file-id reference", () => {
    expect(removeArtworkFileReferencesFromSpecs({
      specsJson: { artworkSideAssignment: { useSameArtworkBothSides: true } },
      fileIds: ["attachment-1"],
      removedSide: "both",
    })).toEqual({ artworkSideAssignment: { useSameArtworkBothSides: false } });
  });
});
