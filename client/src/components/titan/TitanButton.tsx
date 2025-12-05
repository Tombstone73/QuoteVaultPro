import * as React from "react";
import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface TitanButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg" | "icon";
  icon?: LucideIcon;
  iconPosition?: "left" | "right";
}

const variantStyles = {
  primary: cn(
    "bg-titan-accent hover:bg-titan-accent-hover text-white",
    "shadow-titan-sm hover:shadow-titan-md"
  ),
  secondary: cn(
    "bg-titan-bg-card-elevated border border-titan-border",
    "text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card"
  ),
  ghost: cn(
    "bg-transparent text-titan-text-secondary",
    "hover:bg-titan-bg-card hover:text-titan-text-primary"
  ),
  danger: cn(
    "bg-titan-error hover:bg-titan-error/90 text-white",
    "shadow-titan-sm hover:shadow-titan-md"
  ),
};

const sizeStyles = {
  sm: "h-8 px-3 text-titan-xs gap-1.5",
  md: "h-9 px-4 text-titan-sm gap-2",
  lg: "h-10 px-5 text-titan-base gap-2",
  icon: "h-8 w-8 p-0",
};

export function TitanButton({
  className,
  children,
  variant = "primary",
  size = "md",
  icon: Icon,
  iconPosition = "left",
  disabled,
  ...props
}: TitanButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center rounded-titan-md font-medium transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-titan-accent/50",
        "disabled:opacity-50 disabled:pointer-events-none",
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      disabled={disabled}
      {...props}
    >
      {Icon && iconPosition === "left" && <Icon className="h-4 w-4" />}
      {children}
      {Icon && iconPosition === "right" && <Icon className="h-4 w-4" />}
    </button>
  );
}

export function TitanIconButton({
  className,
  icon: Icon,
  variant = "ghost",
  ...props
}: Omit<TitanButtonProps, "children" | "size"> & { icon: LucideIcon }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center h-8 w-8 rounded-titan-md transition-colors",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-titan-accent/50",
        "disabled:opacity-50 disabled:pointer-events-none",
        variantStyles[variant],
        className
      )}
      {...props}
    >
      {Icon && <Icon className="h-4 w-4" />}
    </button>
  );
}

export default TitanButton;
