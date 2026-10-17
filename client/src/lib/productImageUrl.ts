import { objectsUrl } from "@/lib/apiConfig";
import { isValidHttpUrl } from "@/lib/utils";

/** Stored Product image paths are served by the authenticated API, not Vercel. */
export function productImageDisplayUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("/objects/")) return objectsUrl(value);
  return isValidHttpUrl(value) ? value : null;
}
