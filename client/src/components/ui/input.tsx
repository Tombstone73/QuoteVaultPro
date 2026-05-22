import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onFocus, onChange, placeholder, ...props }, ref) => {
    const isPbv2FormulaInput = placeholder === "custom_grommet_qty * 0.25 * q";

    // h-9 to match icon buttons and default buttons.
    return (
      <input
        type={type}
        placeholder={placeholder}
        onFocus={(event) => {
          if (isPbv2FormulaInput && event.currentTarget.value.trim() === "0") {
            event.currentTarget.value = "";
          }
          onFocus?.(event);
        }}
        onChange={(event) => {
          if (
            isPbv2FormulaInput &&
            event.currentTarget.value.startsWith("0") &&
            event.currentTarget.value.length > 1 &&
            !/[0-9.]/.test(event.currentTarget.value[1] ?? "")
          ) {
            event.currentTarget.value = event.currentTarget.value.slice(1);
          }
          onChange?.(event);
        }}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
