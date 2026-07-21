import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

export function AiProductBuilderEntryButton({
  canAccess,
  onOpen,
}: {
  canAccess: boolean;
  onOpen: () => void;
}) {
  if (!canAccess) return null;

  return (
    <Button
      type="button"
      variant="outline"
      className="gap-2"
      onClick={onOpen}
      data-testid="ai-product-builder-entry"
    >
      <Sparkles className="h-4 w-4" />
      AI Product Builder
    </Button>
  );
}
