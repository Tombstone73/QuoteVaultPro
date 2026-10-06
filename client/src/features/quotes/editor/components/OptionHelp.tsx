import { useId } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type OptionHelpProps = {
  label: string;
  description?: string;
  helpText?: string;
  choices?: Array<{ value: string; label: string; description?: string }>;
};

/** Presentation only: option definitions remain the source of all help content. */
export function OptionHelp({ label, description, helpText, choices = [] }: OptionHelpProps) {
  const headingId = useId();
  const paragraphs = Array.from(new Set([description, helpText].map((text) => text?.trim()).filter(Boolean)));
  const describedChoices = choices.filter((choice) => choice.description?.trim());

  if (paragraphs.length === 0 && describedChoices.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Help for ${label}`}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-labelledby={headingId}
        className="max-h-[min(24rem,70vh)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-3 text-sm"
      >
        <h4 id={headingId} className="font-medium text-foreground">{label}</h4>
        <div className="mt-2 space-y-2 whitespace-pre-wrap break-words text-muted-foreground">
          {paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          {describedChoices.length > 0 && (
            <dl className="space-y-2">
              {describedChoices.map((choice) => (
                <div key={choice.value}>
                  <dt className="font-medium text-foreground">{choice.label}</dt>
                  <dd>{choice.description}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
