import { useEffect, useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type ConvertQuoteFormValues = {
  dueDate: string;
  promisedDate: string;
  priority: string;
  notes: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isLoading?: boolean;
  onSubmit: (values: ConvertQuoteFormValues) => void;
  defaultValues?: Partial<ConvertQuoteFormValues>;
};

export function ConvertQuoteToOrderDialog({
  open,
  onOpenChange,
  isLoading,
  onSubmit,
  defaultValues,
}: Props) {
  const [dueDate, setDueDate] = useState(defaultValues?.dueDate || "");
  const [promisedDate, setPromisedDate] = useState(defaultValues?.promisedDate || "");
  const [priority, setPriority] = useState(defaultValues?.priority || "normal");
  const [notes, setNotes] = useState(defaultValues?.notes || "");

  useEffect(() => {
    if (open) {
      setDueDate(defaultValues?.dueDate || "");
      setPromisedDate(defaultValues?.promisedDate || "");
      setPriority(defaultValues?.priority || "normal");
      setNotes(defaultValues?.notes || "");
    }
  }, [open, defaultValues?.dueDate, defaultValues?.promisedDate, defaultValues?.priority, defaultValues?.notes]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convert Quote to Order</DialogTitle>
          <DialogDescription>
            This will create a new order from the selected quote.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="dueDate">Due Date (Optional)</Label>
            <Input
              id="dueDate"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="promisedDate">Promised Date (Optional)</Label>
            <Input
              id="promisedDate"
              type="date"
              value={promisedDate}
              onChange={(e) => setPromisedDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="priority">Priority</Label>
            <Select
              value={priority}
              onValueChange={setPriority}
            >
              <SelectTrigger id="priority">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="rush">Rush</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Internal Notes (Optional)</Label>
            <Input
              id="notes"
              placeholder="Production notes, special instructions..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={() => onSubmit({ dueDate, promisedDate, priority, notes })}
            disabled={isLoading}
          >
            {isLoading ? "Creating..." : "Create Order"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

