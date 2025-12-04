import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
 * Based on CustomerDetailPanel pattern with uniform styling
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
    <Card
      className={cn(
        "bg-card/50 border-border/60 backdrop-blur-sm shadow-lg transition-all hover:shadow-xl",
        onClick && "cursor-pointer hover:bg-card/60",
        className
      )}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-2">
          {Icon && <Icon className="w-3.5 h-3.5" />}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-lg font-bold text-foreground">{value}</div>
        {hasChange && (
          <div className={cn(
            "flex items-center gap-1 text-xs mt-1",
            isPositive ? "text-green-600" : "text-red-600"
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
          <p className="text-xs text-muted-foreground mt-1">{changeLabel}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default TitanStatCard;
