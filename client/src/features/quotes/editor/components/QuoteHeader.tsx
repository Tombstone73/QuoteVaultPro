import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { ArrowLeft, Copy, FileEdit, Save } from "lucide-react";
import BackNavControls from "@/components/BackNavControls";
import { ORDER_DETAIL_SECONDARY_ACTION_CLASS } from "@/components/orders/orderDetailActionStyles";
import { DetailPageHeaderShell } from "@/components/orders/DetailSurface";
import { ListDetailNavigator } from "@/components/navigation/ListDetailNavigator";
import type { ReactNode } from "react";
import type { QuoteWorkflowState } from "@shared/quoteWorkflow";
import { WORKFLOW_LABELS, WORKFLOW_BADGE_VARIANTS } from "@shared/quoteWorkflow";

type QuoteHeaderProps = {
    quoteNumber?: string;
    quoteId: string | null;
    newTitle?: string;
    canDuplicateQuote?: boolean;
    isDuplicatingQuote?: boolean;
    status?: "draft" | "active" | "canceled" | string;
    effectiveWorkflowState?: QuoteWorkflowState | null;
    lastUpdatedLabel?: string;
    updatedByLabel?: string;
    detailPresentation?: boolean;
    editMode?: boolean;
    editModeDisabled?: boolean;
    onEditModeChange?: (next: boolean) => void;
    onSave?: () => void;
    canSaveQuote?: boolean;
    isSaving?: boolean;
    showReviseButton?: boolean;
    isRevisingQuote?: boolean;
    onBack: () => void;
    onSectionHome?: () => void;
    listNavigation?: { context: unknown; position: number | null; total: number; isLoading: boolean; canPrevious: boolean; canNext: boolean; go: (direction: -1 | 1) => Promise<void> };
    primaryActions?: ReactNode;
    onDuplicateQuote?: () => void;
    onReviseQuote?: () => void;
};

export function QuoteHeader({
    quoteNumber,
    quoteId,
    newTitle,
    canDuplicateQuote = false,
    isDuplicatingQuote = false,
    status = "active",
    effectiveWorkflowState,
    lastUpdatedLabel,
    updatedByLabel,
    detailPresentation = true,
    editMode = true,
    editModeDisabled = false,
    onEditModeChange,
    onSave,
    canSaveQuote = false,
    isSaving = false,
    showReviseButton = false,
    isRevisingQuote = false,
    onBack,
    onSectionHome,
    listNavigation,
    primaryActions,
    onDuplicateQuote,
    onReviseQuote,
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

    if (!detailPresentation) {
        return (
            <div className="flex items-center justify-between gap-4 border-b border-border/40 py-2">
                <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 gap-2"><ArrowLeft className="h-4 w-4" />Back</Button>
                <div className="flex items-center gap-3">
                    <h1 className="text-lg font-semibold">{quoteNumber ? `Quote #${quoteNumber}` : (newTitle || "New Quote")}</h1>
                    {statusUi && <Badge variant={statusUi.variant} className="text-xs">{statusUi.label}</Badge>}
                </div>
                <div className="flex items-center gap-3">
                    {onEditModeChange && <div className="flex items-center gap-2"><Switch checked={editMode} onCheckedChange={onEditModeChange} disabled={editModeDisabled} aria-label="Toggle Edit Mode" /><span className="text-xs text-muted-foreground">Edit Mode</span></div>}
                    {showReviseButton && !!quoteId && <Button size="sm" onClick={() => onReviseQuote?.()} disabled={isRevisingQuote || !onReviseQuote}><FileEdit className="mr-2 h-4 w-4" />{isRevisingQuote ? "Revising…" : "Revise Quote"}</Button>}
                    {!!quoteId && <Button size="sm" variant="outline" onClick={() => onDuplicateQuote?.()} disabled={!canDuplicateQuote || isDuplicatingQuote || !onDuplicateQuote}><Copy className="mr-2 h-4 w-4" />{isDuplicatingQuote ? "Duplicating…" : "Duplicate"}</Button>}
                </div>
            </div>
        );
    }

    return (
        <DetailPageHeaderShell actionsLabel="Quote controls" identity={<>
                <BackNavControls onBack={onBack} onSectionHome={onSectionHome} sectionLabel="Quotes" />
                <h1 className="text-titan-xl font-semibold tracking-tight text-titan-text-primary">
                    {quoteNumber ? `Quote #${quoteNumber}` : (newTitle || "New Quote")}
                </h1>
                {statusUi && (
                    <Badge variant={statusUi.variant} className="text-xs">
                        {statusUi.label}
                    </Badge>
                )}
                {listNavigation?.context && <ListDetailNavigator label="quote" position={listNavigation.position} total={listNavigation.total} loading={listNavigation.isLoading} canPrevious={listNavigation.canPrevious} canNext={listNavigation.canNext} onPrevious={() => void listNavigation.go(-1)} onNext={() => void listNavigation.go(1)} />}
            </>} actions={<>
                {primaryActions}
                {!showReviseButton && !!quoteId && onSave && <Button size="sm" onClick={onSave} disabled={!canSaveQuote || isSaving}><Save className="mr-2 h-4 w-4" />{isSaving ? "Saving…" : "Save Changes"}</Button>}
                {showReviseButton && !!quoteId && (
                    <Button
                        size="sm"
                        variant="outline"
                        className={ORDER_DETAIL_SECONDARY_ACTION_CLASS}
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
                        className={ORDER_DETAIL_SECONDARY_ACTION_CLASS}
                        onClick={() => onDuplicateQuote?.()}
                        disabled={!canDuplicateQuote || isDuplicatingQuote || !onDuplicateQuote}
                    >
                        <Copy className="w-4 h-4 mr-2" />
                        {isDuplicatingQuote ? "Duplicating…" : "Duplicate"}
                    </Button>
                )}
            </>} />
    );
}
