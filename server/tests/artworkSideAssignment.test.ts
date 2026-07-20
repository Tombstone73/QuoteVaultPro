import {
  applyArtworkSideAssignmentToSpecs,
  removeArtworkFileReferencesFromSpecs,
} from "@shared/artworkSideAssignment";

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

describe("applyArtworkSideAssignmentToSpecs", () => {
  it("persists a stable Both assignment without replacing unrelated specs", () => {
    expect(applyArtworkSideAssignmentToSpecs({
      specsJson: { notes: "Keep me", artworkSideAssignment: { frontFileId: "old-front" } },
      fileId: "attachment-1",
      fileRecordId: "record-1",
      side: "both",
    })).toEqual({
      notes: "Keep me",
      artworkSideAssignment: {
        useSameArtworkBothSides: true,
        bothFileId: "record-1",
        sharedFileId: "record-1",
      },
    });
  });

  it("turns off shared intent when separate Front or Back art is assigned", () => {
    expect(applyArtworkSideAssignmentToSpecs({
      specsJson: {
        artworkSideAssignment: {
          useSameArtworkBothSides: true,
          bothFileId: "record-shared",
          sharedFileId: "record-shared",
          backFileId: "record-back",
        },
      },
      fileId: "attachment-front",
      fileRecordId: "record-front",
      side: "front",
    })).toEqual({
      artworkSideAssignment: {
        useSameArtworkBothSides: false,
        backFileId: "record-back",
        frontFileId: "record-front",
      },
    });
  });
});
