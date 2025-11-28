import * as React from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface CustomerStatCardProps {
  id: string;
  label: string;
  value: React.ReactNode;
  trend?: React.ReactNode;
  Icon?: React.ComponentType<{ className?: string }>;
  accent?: "blue" | "orange" | "purple" | "green" | "yellow";
  className?: string;
}

const pillColors: Record<string, React.CSSProperties> = {
  blue: { backgroundColor: "#1e6cff", boxShadow: "0 0 22px rgba(30,108,255,0.45)" },
  orange: { backgroundColor: "#ff7a1e", boxShadow: "0 0 22px rgba(255,122,30,0.35)" },
  purple: { backgroundColor: "#7a5cff", boxShadow: "0 0 22px rgba(122,92,255,0.35)" },
  green: { backgroundColor: "#22c55e", boxShadow: "0 0 22px rgba(34,197,94,0.35)" },
  yellow: { backgroundColor: "#facc15", boxShadow: "0 0 22px rgba(250,204,21,0.35)" },
};

export function CustomerStatCard({ label, value, trend, Icon, accent = "blue", className }: CustomerStatCardProps) {
  return (
    <div
      className={cn(
        "relative flex flex-col justify-between rounded-xl border px-4 py-3",
        "shadow-[0_2px_12px_rgba(0,0,0,0.5)]",
        className
      )}
      style={{
        borderColor: "var(--app-card-border-color)",
        backgroundImage: `linear-gradient(to bottom, var(--app-card-gradient-start), var(--app-card-gradient-end))`,
        boxShadow: "var(--app-card-shadow)",
      }}
    >
      {Icon && (
        <div className="absolute right-3 top-3 h-8 w-8 rounded-full flex items-center justify-center"
          style={{ ...pillColors[accent] }}
        >
          <Icon className="h-4 w-4 text-white" />
        </div>
      )}
      <div className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>{label}</div>
      <div className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>{value}</div>
      {trend && (
        <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>{trend}</div>
      )}
    </div>
  );
}

export default CustomerStatCard;