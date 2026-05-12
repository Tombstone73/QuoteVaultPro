/**
 * ContactFlagPill
 *
 * Shared flag metadata and pill component used on:
 *   - Contact detail page header
 *   - Edit Contact dialog (flag checkboxes)
 *   - Customer/company detail contacts list
 *   - Contacts list page name cell
 */

import { cn } from "@/lib/utils";

export const CONTACT_FLAGS = [
  {
    value: "vip",
    label: "VIP",
    className: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  },
  {
    value: "billing_contact",
    label: "Billing",
    className: "bg-titan-accent/15 text-titan-accent border border-titan-accent/20",
  },
  {
    value: "artwork_contact",
    label: "Artwork",
    className: "bg-cyan-500/15 text-cyan-400 border border-cyan-500/20",
  },
  {
    value: "do_not_email",
    label: "Do Not Email",
    className: "bg-titan-error-bg text-titan-error border border-titan-error/20",
  },
  {
    value: "needs_follow_up",
    label: "Follow-up",
    className: "bg-titan-warning-bg text-titan-warning border border-titan-warning/20",
  },
  {
    value: "problem_contact",
    label: "Problem",
    className: "bg-titan-error-bg text-titan-error border border-titan-error/20",
  },
] as const;

export type ContactFlagValue = (typeof CONTACT_FLAGS)[number]["value"];

export function getFlagMeta(value: string) {
  return CONTACT_FLAGS.find((f) => f.value === value);
}

export function ContactFlagPill({ flag }: { flag: string }) {
  const meta = getFlagMeta(flag);
  if (!meta) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium",
        meta.className
      )}
    >
      {meta.label}
    </span>
  );
}
