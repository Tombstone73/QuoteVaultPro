import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Copy, FileEdit } from "lucide-react";
import type { QuoteWorkflowState } from "@shared/quoteWorkflow";
import { WORKFLOW_LABELS, WORKFLOW_BADGE_VARIANTS } from "@shared/quoteWorkflow";

type QuoteHeaderProps = {
    quoteNumber?: string;
    quoteId: string | null;
    canDuplicateQuote?: boolean;
    isDuplicatingQuote?: boolean;
    status?: "draft" | "active" | "canceled" | string;
    effectiveWorkflowState?: QuoteWorkflowState | null;
    lastUpdatedLabel?: string;
    updatedByLabel?: string;
    editMode: boolean;
    editModeDisabled?: boolean;
    showReviseButton?: boolean;
    isRevisingQuote?: boolean;
    onBack: () => void;
    onDuplicateQuote?: () => void;
    onReviseQuote?: () => void;
    onEditModeChange: (next: boolean) => void;
};

export function QuoteHeader({
    quoteNumber,
    quoteId,
    canDuplicateQuote = false,
    isDuplicatingQuote = false,
    status = "active",
    effectiveWorkflowState,
    lastUpdatedLabel,
    updatedByLabel,
    editMode,
    editModeDisabled = false,
    showReviseButton = false,
    isRevisingQuote = false,
    onBack,
    onDuplicateQuote,
    onReviseQuote,
    onEditModeChange,
}: QuoteHeaderProps) {
    // For new/unsaved quotes, show "Draft" or nothing
    const isNewQuote = !quoteId;
    
    const statusUi = (() => {
        // New quotes should show "Draft", not "Sent"
        if (isNewQuote) {
            return { label: "Draft", variant: "secondary" as const };
        }
        
        // Use effective workflow state if available (shows Converted, Approved, etc.)
        if (effectiveWorkflowState) {
            const label = WORKFLOW_LABELS[effectiveWorkflowState];
            let variant = WORKFLOW_BADGE_VARIANTS[effectiveWorkflowState];
            // Map "success" to "default" since Badge component doesn't support success variant
            if (variant === 'success') variant = 'default';
            return { label, variant };
        }
        
        // Fallback to DB status for backwards compatibility
        const s = String(status || "").toLowerCase();
        if (s === "draft") return { label: "Draft", variant: "secondary" as const };
        if (s === "canceled" || s === "cancelled") return { label: "Canceled", variant: "destructive" as const };
        // For "active" or other neutral states, don't show a status badge
        return null;
    })();

    return (
        <div className="flex items-center justify-between gap-4 py-2 border-b border-border/40">
            {/* Left: Back button */}
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-2 -ml-2">
                <ArrowLeft className="h-4 w-4" />
                Back
            </Button>

            {/* Center: Quote # + Status */}
            <div className="flex items-center gap-3">
                <h1 className="text-lg font-semibold">
                    {quoteNumber ? `Quote #${quoteNumber}` : "New Quote"}
                </h1>
                {statusUi && (
                    <Badge variant={statusUi.variant} className="text-xs">
                        {statusUi.label}
                    </Badge>
                )}
            </div>

            {/* Right: Edit Mode + Actions */}
            <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                    <Switch
                        checked={editMode}
                        onCheckedChange={onEditModeChange}
                        disabled={editModeDisabled}
                        aria-label="Toggle Edit Mode"
                    />
                    <span className="text-xs text-muted-foreground">Edit Mode</span>
                </div>

                {showReviseButton && !!quoteId && (
                    <Button
                        size="sm"
                        variant="default"
                        onClick={() => onReviseQuote?.()}
                        disabled={isRevisingQuote || !onReviseQuote}
                    >
                        <FileEdit className="w-4 h-4 mr-2" />
                        {isRevisingQuote ? "Revising…" : "Revise Quote"}
                    </Button>
                )}

                {!!quoteId && (
                    <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onDuplicateQuote?.()}
                        disabled={!canDuplicateQuote || isDuplicatingQuote || !onDuplicateQuote}
                    >
                        <Copy className="w-4 h-4 mr-2" />
                        {isDuplicatingQuote ? "Duplicating…" : "Duplicate"}
                    </Button>
                )}
            </div>
        </div>
    );
}
