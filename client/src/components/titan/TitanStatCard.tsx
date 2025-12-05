import * as React from "react";
import { ArrowUpRight, ArrowDownRight, LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface TitanStatCardProps {
  label: string;
  value: string | number;
  icon?: LucideIcon;
  change?: number | null;
  changeLabel?: string;
  spark?: string[];
  className?: string;
  onClick?: () => void;
}

/**
 * TitanStatCard - Figma-inspired stat card for dashboard metrics
 * Uses TitanOS design tokens consistently
 */
export function TitanStatCard({
  label,
  value,
  icon: Icon,
  change,
  changeLabel,
  spark,
  className,
  onClick,
}: TitanStatCardProps) {
  const isPositive = change !== null && change !== undefined && change >= 0;
  const hasChange = change !== null && change !== undefined;

  return (
    <div
      className={cn(
        "bg-titan-bg-card border border-titan-border-subtle rounded-titan-lg p-4 shadow-titan-card",
        "transition-all hover:shadow-titan-md",
        onClick && "cursor-pointer hover:bg-titan-bg-card-elevated",
        className
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-2 text-titan-xs font-medium text-titan-text-muted mb-2">
        {Icon && <Icon className="w-3.5 h-3.5" />}
        {label}
      </div>
      <div className="text-titan-lg font-bold text-titan-text-primary">{value}</div>
      {hasChange && (
        <div className={cn(
          "flex items-center gap-1 text-titan-xs mt-1",
          isPositive ? "text-titan-success" : "text-titan-error"
        )}>
          {isPositive ? (
            <ArrowUpRight className="w-3 h-3" />
          ) : (
            <ArrowDownRight className="w-3 h-3" />
          )}
          <span>
            {Math.abs(change!).toFixed(1)}% {changeLabel || "vs prev month"}
          </span>
        </div>
      )}
      {!hasChange && changeLabel && (
        <p className="text-titan-xs text-titan-text-muted mt-1">{changeLabel}</p>
      )}
    </div>
  );
}

export default TitanStatCard;
