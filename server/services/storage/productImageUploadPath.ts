export function signedUploadFolder(
  baseFolder: string,
  organizationId: string,
  uploadPurpose?: "product-image",
): string {
  if (uploadPurpose !== "product-image") return baseFolder;
  if (!/^[a-zA-Z0-9_-]+$/.test(organizationId)) {
    throw new Error("Invalid organization context for image upload.");
  }
  return `${baseFolder.replace(/\/+$/, "")}/product-images/${organizationId}`;
}
