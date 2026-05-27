/**
 * PrintTicketActions — the two-button production ticket print workflow.
 *
 *  - "Print Ticket"  → fast path: opens the ticket with default printer/data,
 *                       no modal.
 *  - "Print Options" → opens the Print Options modal for print-snapshot
 *                       overrides before printing.
 *
 * Drop this in anywhere a single "Print Ticket" action for a production job
 * previously appeared (job detail page, production board cards).
 */

import { useState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { ROUTES } from "@/config/routes";
import { PrintOptionsModal } from "./PrintOptionsModal";
import { Ticket, SlidersHorizontal } from "lucide-react";

interface PrintTicketActionsProps {
  /** Production job to print a ticket for. */
  jobId: string;
  /** Actual job/line-item quantity — prefills the partial-quantity total. */
  jobQuantity?: number;
  /** Button size (applied to both buttons). */
  size?: ButtonProps["size"];
  /** Variant for the primary "Print Ticket" button. */
  variant?: ButtonProps["variant"];
  className?: string;
}

export function PrintTicketActions({
  jobId,
  jobQuantity,
  size = "sm",
  variant = "secondary",
  className,
}: PrintTicketActionsProps) {
  const [optionsOpen, setOptionsOpen] = useState(false);

  const printFast = (e: { preventDefault: () => void; stopPropagation: () => void }) => {
    e.preventDefault();
    e.stopPropagation();
    window.open(ROUTES.production.jobTicket(jobId), "_blank");
  };

  const openOptions = (e: { preventDefault: () => void; stopPropagation: () => void }) => {
    e.preventDefault();
    e.stopPropagation();
    setOptionsOpen(true);
  };

  return (
    <div className={`inline-flex items-stretch ${className ?? ""}`}>
      <Button
        variant={variant}
        size={size}
        className="gap-1.5 rounded-r-none border-r-0"
        onClick={printFast}
      >
        <Ticket className="h-4 w-4" /> Print Ticket
      </Button>
      <Button
        variant={variant}
        size={size}
        className="rounded-l-none px-2"
        onClick={openOptions}
        aria-label="Open print options"
        title="Print options"
      >
        <SlidersHorizontal className="h-4 w-4" />
      </Button>
      <PrintOptionsModal
        open={optionsOpen}
        onOpenChange={setOptionsOpen}
        jobId={jobId}
        jobQuantity={jobQuantity}
      />
    </div>
  );
}
