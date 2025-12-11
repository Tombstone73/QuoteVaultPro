import { Button } from "@/components/ui/button";
import { ArrowLeft, Edit } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "@/config/routes";

type QuoteHeaderProps = {
    quoteNumber?: string;
    quoteId: string | null;
    canSaveQuote: boolean;
    canConvertToOrder: boolean;
    isSaving: boolean;
    readOnly?: boolean;
    onBack: () => void;
    onSave: () => void;
    onConvertToOrder: () => void;
    convertToOrderPending?: boolean;
};

export function QuoteHeader({
    quoteNumber,
    quoteId,
    canSaveQuote,
    canConvertToOrder,
    isSaving,
    readOnly = false,
    onBack,
    onSave,
    onConvertToOrder,
    convertToOrderPending,
}: QuoteHeaderProps) {
    const navigate = useNavigate();

    return (
        <div className="flex items-center justify-between py-2">
            <Button variant="ghost" size="sm" onClick={onBack} className="gap-2">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back to quotes
            </Button>
            <div className="flex items-center gap-2">
                <h1 className="text-xl font-semibold">
                    {quoteNumber ? `Quote #${quoteNumber}` : "Quote"}
                </h1>
            </div>
            <div className="flex items-center gap-2">
                {readOnly ? (
                    // View mode: show Edit Quote button
                    quoteId && (
                        <Button
                            size="sm"
                            variant="default"
                            onClick={() => navigate(ROUTES.quotes.edit(quoteId))}
                        >
                            <Edit className="w-4 h-4 mr-2" />
                            Edit Quote
                        </Button>
                    )
                ) : (
                    // Edit mode: show Save and Convert buttons
                    <>
                        {canConvertToOrder && (
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={onConvertToOrder}
                                disabled={convertToOrderPending}
                            >
                                Convert to Order
                            </Button>
                        )}
                        <Button
                            size="sm"
                            variant="default"
                            onClick={onSave}
                            disabled={!canSaveQuote}
                        >
                            {isSaving ? "Saving…" : "Save Quote"}
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
}
