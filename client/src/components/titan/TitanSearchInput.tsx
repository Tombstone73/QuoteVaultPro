import * as React from "react";
import { cn } from "@/lib/utils";
import { Search } from "lucide-react";

interface TitanSearchInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  containerClassName?: string;
}

export function TitanSearchInput({ 
  className, 
  containerClassName,
  placeholder = "Search...",
  ...props 
}: TitanSearchInputProps) {
  return (
    <div className={cn("relative", containerClassName)}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-titan-text-muted" />
      <input
        type="text"
        className={cn(
          "w-full bg-titan-bg-input border border-titan-border rounded-titan-md",
          "pl-9 pr-3 py-2 text-titan-sm text-titan-text-primary",
          "placeholder:text-titan-text-muted",
          "focus:border-titan-accent focus:ring-1 focus:ring-titan-accent/30 outline-none",
          "transition-colors",
          className
        )}
        placeholder={placeholder}
        {...props}
      />
    </div>
  );
}

export default TitanSearchInput;
