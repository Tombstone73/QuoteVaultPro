import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export function ListDetailNavigator({
  label,
  position,
  total,
  loading,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
}: {
  label: "invoice" | "order";
  position: number | null;
  total: number;
  loading?: boolean;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  if (position == null && !loading) return null;
  const title = label[0].toUpperCase() + label.slice(1);
  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex items-center gap-1.5" aria-label={`${title} list navigation`}>
        <span className="min-w-[4.5rem] text-right text-sm text-muted-foreground" aria-live="polite">
          {loading ? "…" : `${position} of ${total}`}
        </span>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={!canPrevious} onClick={onPrevious} aria-label={`Previous ${label}`}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Previous {label}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button type="button" variant="ghost" size="icon" className="h-8 w-8" disabled={!canNext} onClick={onNext} aria-label={`Next ${label}`}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Next {label}</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
