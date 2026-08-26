import { assessMediaFit, getMediaFitWarning } from "../../mediaFit";

describe("media fit classification", () => {
  test("keeps valid rigid sizes unflagged and honors allowed rotation", () => {
    expect(assessMediaFit({ finishedWidthIn: 24, finishedHeightIn: 36, mediaType: "sheet", sheetWidthIn: 48, sheetHeightIn: 96 })).toMatchObject({ status: "fits_single_piece", fittingOrientation: "normal" });
    expect(assessMediaFit({ finishedWidthIn: 72, finishedHeightIn: 48, mediaType: "sheet", sheetWidthIn: 48, sheetHeightIn: 96, allowRotation: true })).toMatchObject({ status: "fits_single_piece", fittingOrientation: "rotated" });
  });

  test("marks oversized rigid items for paneling without treating their dimensions as invalid", () => {
    expect(assessMediaFit({ finishedWidthIn: 238, finishedHeightIn: 24, mediaType: "sheet", sheetWidthIn: 48, sheetHeightIn: 96, allowRotation: true })).toMatchObject({ status: "paneling_required" });
    expect(assessMediaFit({ finishedWidthIn: 72, finishedHeightIn: 48, mediaType: "sheet", sheetWidthIn: 48, sheetHeightIn: 96, allowRotation: false })).toMatchObject({ status: "paneling_required" });
  });

  test("uses roll printable width, not an invented roll length", () => {
    expect(assessMediaFit({ finishedWidthIn: 48, finishedHeightIn: 240, mediaType: "roll", printableWidthIn: 54 })).toMatchObject({ status: "fits_single_piece" });
    expect(assessMediaFit({ finishedWidthIn: 60, finishedHeightIn: 24, mediaType: "roll", printableWidthIn: 54, allowRotation: false })).toMatchObject({ status: "paneling_required" });
  });

  test("keeps malformed dimensions invalid and renders a non-blocking seam warning", () => {
    expect(assessMediaFit({ finishedWidthIn: 0, finishedHeightIn: 24, mediaType: "sheet", sheetWidthIn: 48, sheetHeightIn: 96 })).toMatchObject({ status: "invalid" });
    expect(getMediaFitWarning(assessMediaFit({ finishedWidthIn: 238, finishedHeightIn: 24, mediaType: "sheet", sheetWidthIn: 48, sheetHeightIn: 96 }))).toMatchObject({ title: "OVERSIZED FOR MEDIA" });
  });
});
