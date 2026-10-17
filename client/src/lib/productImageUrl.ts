import { apiUrl } from "@/lib/apiConfig";
import { isValidHttpUrl } from "@/lib/utils";

/** Product images require the API session cookie; the separate objects host does not receive it. */
export function productImageDisplayUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("/objects/")) return apiUrl(value);
  return isValidHttpUrl(value) ? value : null;
}
