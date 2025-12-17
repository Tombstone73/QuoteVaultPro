import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Copy } from "lucide-react";

type QuoteHeaderProps = {
    quoteNumber?: string;
    quoteId: string | null;
    canDuplicateQuote?: boolean;
    isDuplicatingQuote?: boolean;
    status?: "draft" | "active" | "canceled" | string;
    lastUpdatedLabel?: string;
    updatedByLabel?: string;
    editMode: boolean;
    editModeDisabled?: boolean;
    onBack: () => void;
    onDuplicateQuote?: () => void;
    onEditModeChange: (next: boolean) => void;
};

export function QuoteHeader({
    quoteNumber,
    quoteId,
    canDuplicateQuote = false,
    isDuplicatingQuote = false,
    status = "active",
    lastUpdatedLabel,
    updatedByLabel,
    editMode,
    editModeDisabled = false,
    onBack,
    onDuplicateQuote,
    onEditModeChange,
}: QuoteHeaderProps) {
    // For new/unsaved quotes, show "Draft" or nothing
    const isNewQuote = !quoteId;
    
    const statusUi = (() => {
        // New quotes should show "Draft", not "Sent"
        if (isNewQuote) {
            return { label: "Draft", variant: "secondary" as const };
        }
        
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

            {/* Right: Edit Mode + Duplicate */}
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
