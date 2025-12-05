import * as React from "react";
import { cn } from "@/lib/utils";

interface TitanCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated" | "highlight";
  noPadding?: boolean;
}

const variantStyles = {
  default: "bg-titan-bg-card border-titan-border-subtle shadow-titan-card",
  elevated: "bg-titan-bg-card-elevated border-titan-border-subtle shadow-titan-md",
  highlight: "bg-titan-bg-card-highlight border-titan-accent/20 shadow-titan-glow-blue",
};

export function TitanCard({ 
  className, 
  children, 
  variant = "default",
  noPadding = false,
  ...props 
}: TitanCardProps) {
  return (
    <div
      className={cn(
        "rounded-titan-lg border",
        variantStyles[variant],
        !noPadding && "p-4",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export default TitanCard;
