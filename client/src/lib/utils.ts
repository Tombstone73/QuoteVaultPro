import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Helper: validate URL is a proper http(s) string
// Used to ensure we never use storage keys (fileUrl, thumbKey, previewKey) as URLs
export function isValidHttpUrl(v: unknown): v is string {
  return typeof v === "string" && (v.startsWith("http://") || v.startsWith("https://"));
}