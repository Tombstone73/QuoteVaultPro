import { Button } from "@/components/ui/button";
import { Loader2, Save, X } from "lucide-react";

type OrderCreateActionsProps = {
    canSaveQuote: boolean;
    isSaving: boolean;
    onSave: () => void;
    onDiscard: () => void;
    showDiscard?: boolean;
    primaryActionLabel?: string;
    primaryActionSavingLabel?: string;
    inline?: boolean;
};

/** The existing Order summary actions, usable in the page's compact action bar. */
export function OrderCreateActions({ canSaveQuote, isSaving, onSave, onDiscard, showDiscard = true, primaryActionLabel, primaryActionSavingLabel, inline = false }: OrderCreateActionsProps) {
    return (
        <div className={inline ? "flex flex-wrap items-center gap-2" : "flex w-full flex-col gap-3"}>
            <Button className={inline ? "h-9 font-semibold" : "h-11 w-full font-semibold"} onClick={onSave} disabled={!canSaveQuote || isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {isSaving ? (primaryActionSavingLabel || "Creating Order…") : (primaryActionLabel || "Create Order")}
            </Button>
            {showDiscard && (
                <Button variant="outline" className={inline ? "h-9" : "w-full"} onClick={onDiscard} disabled={isSaving}>
                    <X className="mr-2 h-4 w-4" />Discard draft
                </Button>
            )}
        </div>
    );
}
