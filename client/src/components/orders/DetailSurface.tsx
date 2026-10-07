import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

// Presentation shells shared by Order Detail and Quote Detail. Domain controls
// remain with their respective pages.
export function DetailPageHeaderShell({ identity, actions, actionsLabel }: { identity: ReactNode; actions: ReactNode; actionsLabel: string }) {
  return (
    <header className="mb-5 border-b border-border/60 pb-3">
      <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 xl:shrink-0">{identity}</div>
        <div className="flex w-fit max-w-full min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-muted/20 p-1 xl:ml-auto" aria-label={actionsLabel}>
          {actions}
        </div>
      </div>
    </header>
  );
}

export function DetailTopGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(20rem,1fr)_minmax(24rem,1.2fr)_minmax(18rem,0.8fr)]">{children}</div>;
}

export function DetailTopCard({ children, label, customer = false, className }: { children: ReactNode; label: string; customer?: boolean; className?: string }) {
  return (
    <section
      aria-label={label}
      className={cn(
        customer
          ? "grid gap-4 rounded-lg border border-titan-border-subtle bg-titan-bg-card p-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2"
          : "min-w-0 space-y-3 rounded-lg border border-titan-border-subtle bg-titan-bg-card p-4",
        className,
      )}
    >
      {children}
    </section>
  );
}

export function DetailLineItemsHeadingRow({ children, detail = true, className }: { children: ReactNode; detail?: boolean; className?: string }) {
  return <div className={detail ? "flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/50 bg-muted/15 px-3 py-2.5" : className}>{children}</div>;
}

export function DetailLineItemsCard({ children, detail = true, className }: { children: ReactNode; detail?: boolean; className?: string }) {
  return <Card className={detail ? "border-0 bg-transparent shadow-none" : className}>{children}</Card>;
}

export function DetailLineItemsHeader({ children, detail = true, className }: { children: ReactNode; detail?: boolean; className?: string }) {
  return <CardHeader className={detail ? "px-0 pt-0 pb-2" : className}>{children}</CardHeader>;
}

export function DetailLineItemsContent({ children, detail = true, className }: { children: ReactNode; detail?: boolean; className?: string }) {
  return <CardContent className={detail ? "px-0 py-0 overflow-x-hidden" : className}>{children}</CardContent>;
}

export function DetailBottomGrid({ children }: { children: ReactNode }) {
  return <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(240px,0.75fr)_minmax(280px,1fr)_minmax(320px,1fr)]">{children}</div>;
}

export function DetailFulfillmentDisclosure({ children, open, onOpenChange }: { children: ReactNode; open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Collapsible className="xl:order-2" open={open} onOpenChange={onOpenChange}>{children}</Collapsible>;
}

export function DetailFulfillmentBody({ children }: { children: ReactNode }) {
  return <CollapsibleContent>{children}</CollapsibleContent>;
}

export function DetailTotalsCard({ children, className }: { children: ReactNode; className?: string }) {
  return <Card className={cn("h-fit xl:order-1", className)}>{children}</Card>;
}

export function DetailUtilitySection({ title, badge, icon, children, defaultOpen = false, open, onOpenChange, forceMount = false }: { title: string; badge?: ReactNode; icon?: ReactNode; children: ReactNode; defaultOpen?: boolean; open?: boolean; onOpenChange?: (open: boolean) => void; forceMount?: boolean }) {
  return (
    <Collapsible defaultOpen={defaultOpen} open={open} onOpenChange={onOpenChange} className="rounded-lg border bg-card">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/40">
          <div className="flex items-center gap-2 text-sm font-medium">{icon}{title}{badge}</div>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent forceMount={forceMount || undefined} className="border-t">
        <div className="p-4">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
