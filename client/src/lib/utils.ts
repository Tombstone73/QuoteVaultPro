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

// Phone number utilities
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/\D/g, "");
}

export function formatPhoneForDisplay(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = normalizePhone(raw);
  
  // Format as (###) ###-#### for 10-digit US numbers
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  
  // Otherwise return trimmed original
  return raw.trim();
}

export function phoneToTelHref(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = normalizePhone(raw);
  
  // Add +1 country code for 10-digit US numbers
  if (digits.length === 10) {
    return `tel:+1${digits}`;
  }
  
  // Otherwise use digits-only
  return `tel:${digits}`;
}