import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type BackNavControlsProps = {
  onBack: () => void;
  backLabel?: string;
  sectionLabel?: string;
  onSectionHome?: () => void;
  className?: string;
};

export default function BackNavControls({
  onBack,
  backLabel = "Back",
  sectionLabel,
  onSectionHome,
  className,
}: BackNavControlsProps) {
  const secondaryLabel = sectionLabel ? `Open ${sectionLabel}` : "Section Home";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="h-8 rounded-titan-md text-titan-text-secondary hover:bg-titan-bg-card-elevated hover:text-titan-text-primary"
      >
        <ArrowLeft className="mr-2 h-4 w-4" />
        {backLabel}
      </Button>

      {onSectionHome ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={onSectionHome}
          className="h-8 px-2 text-titan-text-secondary hover:bg-titan-bg-card-elevated hover:text-titan-text-primary"
        >
          {secondaryLabel}
        </Button>
      ) : null}
    </div>
  );
}
