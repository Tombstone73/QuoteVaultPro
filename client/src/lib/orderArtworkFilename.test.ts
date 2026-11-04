import { expect, test } from "@jest/globals";
import { orderArtworkFilename } from "./orderArtworkFilename";

test.each([
  ["artwork.pdf", "20937", "20937_artwork.pdf"],
  ["20937_artwork.pdf", "20937", "20937_artwork.pdf"],
  ["20937-artwork.pdf", "20937", "20937-artwork.pdf"],
  ["20937 artwork.pdf", "ORD-20937", "20937 artwork.pdf"],
  ["artwork.pdf", "ORD-20937", "ORD-20937_artwork.pdf"],
  ["artwork.pdf", null, "artwork.pdf"],
])("labels %s with canonical Order %s once", (filename, orderNumber, expected) => {
  expect(orderArtworkFilename(filename, orderNumber)).toBe(expected);
  expect(orderArtworkFilename(expected, orderNumber)).toBe(expected);
});
