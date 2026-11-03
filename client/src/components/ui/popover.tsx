import * as React from "react"
import * as PopoverPrimitive from "@radix-ui/react-popover"

import { cn } from "@/lib/utils"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import { WorkspaceOverlayContext, useParkedWorkspaceContent, useWorkspaceOverlayState } from "@/contexts/workspaceOverlay"

function Popover({ children, ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  const state = useWorkspaceOverlayState(props)
  return <PopoverPrimitive.Root {...props} open={state.open} onOpenChange={state.onOpenChange}><WorkspaceOverlayContext.Provider value={{ desiredOpen: state.desiredOpen }}>{children}</WorkspaceOverlayContext.Provider></PopoverPrimitive.Root>
}

const PopoverTrigger = PopoverPrimitive.Trigger

const PopoverContent = React.forwardRef<
  React.ElementRef<typeof PopoverPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 4, children, ...props }, ref) => {
  const workspace = useWorkspace()
  const kept = useParkedWorkspaceContent(children)
  return <>{kept.parked}{(!workspace || workspace.active) && <PopoverPrimitive.Portal container={workspace?.portalContainer ?? undefined}>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn(
        "z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[--radix-popover-content-transform-origin]",
        className
      )}
      {...props}
      onCloseAutoFocus={event => { if (workspace && !workspace.isActive()) { event.preventDefault(); return } props.onCloseAutoFocus?.(event) }}
    >{kept.content}</PopoverPrimitive.Content>
  </PopoverPrimitive.Portal>}</>
})
PopoverContent.displayName = PopoverPrimitive.Content.displayName

export { Popover, PopoverTrigger, PopoverContent }
