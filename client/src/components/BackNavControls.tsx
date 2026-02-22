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
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated rounded-titan-md"
      >
        <ArrowLeft className="w-4 h-4 mr-2" />
        {backLabel}
      </Button>

      {onSectionHome ? (
        <Button
          variant="outline"
          size="sm"
          onClick={onSectionHome}
          className="h-8 px-2 border-titan-border-subtle text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated"
        >
          {sectionLabel || "Section Home"}
        </Button>
      ) : null}
    </div>
  );
}
