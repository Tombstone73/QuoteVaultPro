import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonSurface = "border active:border-current disabled:border-button-outline/65 disabled:bg-muted disabled:text-muted-foreground disabled:shadow-none aria-busy:border-dashed"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium motion-safe:transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          `${buttonSurface} border-primary-border bg-primary font-semibold text-primary-foreground hover:bg-button-primary-hover`,
        destructive:
          `${buttonSurface} border-button-outline bg-button-destructive font-semibold text-destructive-foreground shadow-[inset_0_0_0_1px_currentColor] hover:bg-button-destructive-hover`,
        outline:
          `${buttonSurface} border-button-outline bg-background text-foreground hover:border-foreground hover:bg-accent hover:text-accent-foreground`,
        secondary:
          `${buttonSurface} border-button-outline bg-secondary text-secondary-foreground hover:border-foreground hover:bg-accent hover:text-accent-foreground`,
        ghost:
          `${buttonSurface} border-transparent bg-muted text-foreground hover:border-button-outline hover:bg-secondary hover:text-secondary-foreground`,
        link: "text-primary underline-offset-4 hover:underline disabled:text-muted-foreground",
      },
      // Heights are set as "min" heights, because sometimes Ai will place large amount of content
      // inside buttons. With a min-height they will look appropriate with small amounts of content,
      // but will expand to fit large amounts of content.
      size: {
        default: "min-h-9 px-4 py-2",
        sm: "min-h-8 rounded-md px-3 text-xs",
        lg: "min-h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  },
)
Button.displayName = "Button"

export { Button, buttonVariants }
