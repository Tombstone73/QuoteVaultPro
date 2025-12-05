import * as React from "react";
import { cn } from "@/lib/utils";

export type StatusVariant = "success" | "warning" | "error" | "info" | "muted" | "default";

export interface StatusPillProps {
  children: React.ReactNode;
  variant?: StatusVariant;
  className?: string;
}

const variantStyles: Record<StatusVariant, string> = {
  success: "bg-titan-success-bg text-titan-success",
  warning: "bg-titan-warning-bg text-titan-warning",
  error: "bg-titan-error-bg text-titan-error",
  info: "bg-titan-accent/15 text-titan-accent",
  muted: "bg-titan-bg-card-elevated text-titan-text-muted",
  default: "bg-titan-bg-card-elevated text-titan-text-muted",
};

export function StatusPill({ children, variant = "muted", className }: StatusPillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
        variantStyles[variant],
        className
      )}
    >
      {children}
    </span>
  );
}

// Helper to map common status strings to variants
export function getStatusVariant(status: string): StatusVariant {
  const statusLower = status.toLowerCase();
  
  // Success states
  if (["completed", "paid", "delivered", "approved", "active", "shipped"].includes(statusLower)) {
    return "success";
  }
  
  // Warning states
  if (["in_production", "pending", "open", "draft", "processing", "partially_paid", "scheduled"].includes(statusLower)) {
    return "warning";
  }
  
  // Error states
  if (["canceled", "cancelled", "overdue", "failed", "rejected", "on_hold"].includes(statusLower)) {
    return "error";
  }
  
  // Info states
  if (["sent", "new", "ready_for_pickup"].includes(statusLower)) {
    return "info";
  }
  
  return "muted";
}

export default StatusPill;
