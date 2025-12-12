import { Button } from "@/components/ui/button";
import { ArrowLeft, Copy, Edit } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/config/routes";

type QuoteHeaderProps = {
    quoteNumber?: string;
    quoteId: string | null;
    canSaveQuote: boolean;
    canConvertToOrder: boolean;
    isSaving: boolean;
    canDuplicateQuote?: boolean;
    isDuplicatingQuote?: boolean;
    readOnly?: boolean;
    onBack: () => void;
    onSave: () => void;
    onConvertToOrder: () => void;
    onDuplicateQuote?: () => void;
    convertToOrderPending?: boolean;
};

export function QuoteHeader({
    quoteNumber,
    quoteId,
    canSaveQuote,
    canConvertToOrder,
    isSaving,
    canDuplicateQuote = false,
    isDuplicatingQuote = false,
    readOnly = false,
    onBack,
    onSave,
    onConvertToOrder,
    onDuplicateQuote,
    convertToOrderPending,
}: QuoteHeaderProps) {
    const navigate = useNavigate();

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <Button variant="ghost" size="sm" onClick={onBack} className="gap-2 -ml-2">
                    <ArrowLeft className="h-4 w-4" />
                    Back to quotes
                </Button>

                <div className="flex items-center gap-2">
                    {/* Duplicate Quote v1 (normal duplicate only) */}
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

                    {/* View mode: show Edit Quote button in header */}
                    {readOnly && quoteId && (
                        <Button
                            size="sm"
                            variant="default"
                            onClick={() => navigate(ROUTES.quotes.edit(quoteId))}
                        >
                            <Edit className="w-4 h-4 mr-2" />
                            Edit Quote
                        </Button>
                    )}
                </div>

                {/* Edit mode actions are intentionally moved into SummaryCard (right column). */}
                {!readOnly && (
                    <div className="hidden">
                        <Button size="sm" onClick={onSave} disabled={!canSaveQuote}>
                            {isSaving ? "Saving…" : "Save Quote"}
                        </Button>
                        {canConvertToOrder && (
                            <Button size="sm" onClick={onConvertToOrder} disabled={convertToOrderPending}>
                                Convert to Order
                            </Button>
                        )}
                    </div>
                )}
            </div>

            <div className="flex items-end justify-between gap-4">
                <h1 className="text-2xl font-semibold tracking-tight">
                    {quoteNumber ? `Quote #${quoteNumber}` : "Quote"}
                </h1>
            </div>
        </div>
    );
}
