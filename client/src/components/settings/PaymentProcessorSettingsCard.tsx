import { useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

type ProcessorStatus = "ready" | "needs_setup" | "off";

interface PaymentProcessorSettingsCardProps {
  processorName: string;
  logoSrc: string;
  logoAlt: string;
  description: string;
  status: ProcessorStatus;
  enabled: boolean;
  readinessLabel?: string;
  isDefault: boolean;
  defaultExpanded?: boolean;
  children: ReactNode;
}

function statusLabel(status: ProcessorStatus): string {
  if (status === "ready") return "Enabled";
  if (status === "needs_setup") return "Needs setup";
  return "Off";
}

function statusClassName(status: ProcessorStatus): string {
  if (status === "ready") return "bg-green-500 text-white";
  if (status === "needs_setup") return "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200";
  return "";
}

export function PaymentProcessorSettingsCard({
  processorName,
  logoSrc,
  logoAlt,
  description,
  status,
  enabled,
  readinessLabel,
  isDefault,
  defaultExpanded = false,
  children,
}: PaymentProcessorSettingsCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <Card className={cn("mb-6 overflow-hidden", isDefault && "border-primary/60 ring-1 ring-primary/30")}>
      <CardHeader className="p-0">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-4 px-6 py-4 text-left transition-colors hover:bg-muted/40"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
        >
          <div className="flex min-w-0 items-center gap-4">
            <span className="flex h-14 w-40 shrink-0 items-center justify-center rounded-md border bg-white px-3 py-2 shadow-sm dark:bg-white">
              <img
                src={logoSrc}
                alt={logoAlt}
                className="block max-h-10 max-w-[8.75rem] object-contain"
                loading="lazy"
              />
            </span>
            <span className="min-w-0">
              <span className="block text-base font-semibold text-foreground">{processorName}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{description}</span>
            </span>
          </div>

          <span className="flex shrink-0 items-center gap-2">
            {isDefault ? <Badge>Default</Badge> : <Badge variant="outline">Not default</Badge>}
            <Badge variant={enabled ? "default" : "outline"} className={enabled ? "bg-green-500 text-white" : ""}>
              {enabled ? "Enabled" : "Off"}
            </Badge>
            <Badge variant={status === "ready" ? "default" : "outline"} className={statusClassName(status)}>
              {readinessLabel || statusLabel(status)}
            </Badge>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", expanded && "rotate-180")} />
          </span>
        </button>
      </CardHeader>
      {expanded ? (
        <CardContent className="border-t px-6 py-4">
          {children}
        </CardContent>
      ) : null}
    </Card>
  );
}
