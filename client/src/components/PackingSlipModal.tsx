import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

interface PackingSlipModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  packingSlipHtml: string;
}

export function PackingSlipModal({ open, onOpenChange, packingSlipHtml }: PackingSlipModalProps) {
  const handlePrint = () => {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
      printWindow.document.write(packingSlipHtml);
      printWindow.document.close();
      printWindow.focus();
      printWindow.print();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Packing Slip</DialogTitle>
          <DialogDescription>
            Preview and print the packing slip for this order
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Preview Container */}
          <div 
            className="border rounded-md p-4 bg-white overflow-auto max-h-[60vh]"
            dangerouslySetInnerHTML={{ __html: packingSlipHtml }}
          />

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-2" />
              Print Packing Slip
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
