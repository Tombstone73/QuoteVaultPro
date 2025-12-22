import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Ban } from "lucide-react";

type VoidQuoteDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    quoteNumber?: number | string | null;
    onConfirm: (reason: string) => Promise<void> | void;
};

export function VoidQuoteDialog({
    open,
    onOpenChange,
    quoteNumber,
    onConfirm,
}: VoidQuoteDialogProps) {
    const [reason, setReason] = useState("");
    const [touched, setTouched] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const reasonInvalid = touched && reason.trim().length === 0;

    const handleConfirm = async () => {
        setTouched(true);

        if (reason.trim().length === 0) {
            return;
        }

        setIsSubmitting(true);
        try {
            await onConfirm(reason.trim());
            // Reset on success
            setReason("");
            setTouched(false);
            onOpenChange(false);
        } catch (error) {
            // Error handling done by parent
            console.error("[VoidQuoteDialog] Confirm failed:", error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleOpenChange = (nextOpen: boolean) => {
        if (!nextOpen && !isSubmitting) {
            // Reset state when closing
            setReason("");
            setTouched(false);
        }
        onOpenChange(nextOpen);
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Ban className="h-5 w-5 text-destructive" />
                        Void Quote?
                    </DialogTitle>
                    <DialogDescription>
                        {quoteNumber ? (
                            <>
                                Quote <span className="font-semibold">#{quoteNumber}</span> will be
                                marked as voided but remain in the system for audit history.
                            </>
                        ) : (
                            "This quote will be marked as voided but remain in the system for audit history."
                        )}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-2 py-4">
                    <Label htmlFor="void-reason" className="text-sm font-medium">
                        Reason for voiding <span className="text-destructive">*</span>
                    </Label>
                    <Textarea
                        id="void-reason"
                        placeholder="e.g., Customer canceled order, pricing error, duplicate quote..."
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        onBlur={() => setTouched(true)}
                        disabled={isSubmitting}
                        className={reasonInvalid ? "border-destructive focus-visible:ring-destructive" : ""}
                        rows={3}
                    />
                    {reasonInvalid && (
                        <p className="text-sm text-destructive">
                            Please provide a reason for voiding this quote.
                        </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                        Note: Reason will be shown in confirmation but cannot be saved to the quote record yet.
                    </p>
                </div>

                <DialogFooter>
                    <Button
                        variant="outline"
                        onClick={() => handleOpenChange(false)}
                        disabled={isSubmitting}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="destructive"
                        onClick={handleConfirm}
                        disabled={isSubmitting || (touched && reason.trim().length === 0)}
                    >
                        {isSubmitting ? "Voiding..." : "Void Quote"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
