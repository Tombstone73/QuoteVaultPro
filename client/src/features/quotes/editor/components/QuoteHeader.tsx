import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

type QuoteHeaderProps = {
    quoteNumber?: string;
    canSaveQuote: boolean;
    canConvertToOrder: boolean;
    isSaving: boolean;
    onBack: () => void;
    onSave: () => void;
    onConvertToOrder: () => void;
    convertToOrderPending?: boolean;
};

export function QuoteHeader({
    quoteNumber,
    canSaveQuote,
    canConvertToOrder,
    isSaving,
    onBack,
    onSave,
    onConvertToOrder,
    convertToOrderPending,
}: QuoteHeaderProps) {
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
            </div>
        </div>
    );
}
