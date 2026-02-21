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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle, Loader2 } from "lucide-react";

interface DestructiveActionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmationSlug: string;
  confirmButtonText?: string;
  onConfirm: () => Promise<void>;
}

export function DestructiveActionModal({
  open,
  onOpenChange,
  title,
  description,
  confirmationSlug,
  confirmButtonText = "Confirm",
  onConfirm,
}: DestructiveActionModalProps) {
  const [slugInput, setSlugInput] = useState("");
  const [checked, setChecked] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isValid = slugInput === confirmationSlug && checked;

  const handleConfirm = async () => {
    if (!isValid) return;

    setIsSubmitting(true);
    try {
      await onConfirm();
      handleClose();
    } catch (error) {
      // Error handling done by parent
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    setSlugInput("");
    setChecked(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10">
              <AlertTriangle className="h-5 w-5 text-destructive" />
            </div>
            <DialogTitle className="text-xl">{title}</DialogTitle>
          </div>
          <DialogDescription className="text-base pt-2">
            {description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Slug verification */}
          <div className="space-y-2">
            <Label htmlFor="slug-confirm" className="text-sm font-medium">
              Type <span className="font-mono font-semibold text-destructive">{confirmationSlug}</span> to confirm
            </Label>
            <Input
              id="slug-confirm"
              value={slugInput}
              onChange={(e) => setSlugInput(e.target.value)}
              placeholder="Enter organization slug"
              className="font-mono"
              disabled={isSubmitting}
            />
          </div>

          {/* Checkbox confirmation */}
          <div className="flex items-start space-x-2">
            <Checkbox
              id="understand-irreversible"
              checked={checked}
              onCheckedChange={(checked) => setChecked(checked === true)}
              disabled={isSubmitting}
            />
            <label
              htmlFor="understand-irreversible"
              className="text-sm leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              I understand this action cannot be undone
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!isValid || isSubmitting}
          >
            {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmButtonText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
