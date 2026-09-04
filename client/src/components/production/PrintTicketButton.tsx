/**
 * PrintTicketButton — reusable "Print Ticket / Print Traveler" action.
 *
 * Drop this in anywhere an order, line item, or production job appears. It
 * opens the appropriate print page (production ticket vs. order traveler) in a
 * new tab using the existing browser/Windows print flow — no ESC/POS.
 *
 * Two modes:
 *  - `jobId`  → production ticket for a single production job / line item.
 *  - `orderId` → order traveler (whole-order summary with all line items).
 *
 * Renders either as a Button (default) or as a dropdown menu item
 * (`asMenuItem`) for order list / customer order row overflow menus.
 */

import { Button, type ButtonProps } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { ROUTES } from "@/config/routes";
import { Ticket } from "lucide-react";
import { useState } from "react";
import { TravelerPrintDialog } from "@/components/production/TravelerPrintDialog";

interface PrintTicketButtonBaseProps {
  /** Production job id — prints a single production ticket. */
  jobId?: string;
  /** Order id — prints the whole-order traveler. Ignored when `jobId` is set. */
  orderId?: string;
  /** Optional label override. */
  label?: string;
  /** Render as a dropdown menu item instead of a button. */
  asMenuItem?: boolean;
  /** Render an icon-only button (compact, for table row action cells). */
  iconOnly?: boolean;
  className?: string;
}

type PrintTicketButtonProps = PrintTicketButtonBaseProps &
  Pick<ButtonProps, "variant" | "size">;

/** Resolve the print route + default label for the given target. */
function resolveTarget(jobId?: string, orderId?: string): { href: string; label: string } | null {
  if (jobId) {
    return { href: ROUTES.production.jobTicket(jobId), label: "Print Ticket" };
  }
  if (orderId) {
    return { href: ROUTES.orders.traveler(orderId), label: "Print Traveler" };
  }
  return null;
}

export function PrintTicketButton({
  jobId,
  orderId,
  label,
  asMenuItem = false,
  iconOnly = false,
  variant = "outline",
  size = "sm",
  className,
}: PrintTicketButtonProps) {
  const target = resolveTarget(jobId, orderId);
  const [travelerOpen, setTravelerOpen] = useState(false);
  if (!target) return null;

  const text = label ?? target.label;

  const open = (e: { preventDefault: () => void; stopPropagation: () => void }) => {
    // Avoid triggering row navigation when embedded in a clickable row.
    e.preventDefault();
    e.stopPropagation();
    if (orderId && !jobId) setTravelerOpen(true);
    else window.open(target.href, "_blank");
  };

  if (asMenuItem) {
    return <><DropdownMenuItem onSelect={(e) => open(e)} className={className}>
        <Ticket className="mr-2 h-4 w-4" />
        {text}
      </DropdownMenuItem>{orderId && <TravelerPrintDialog orderId={orderId} open={travelerOpen} onOpenChange={setTravelerOpen} />}</>;
  }

  if (iconOnly) {
    return <><Button variant={variant} size={size} className={className} onClick={open} title={text}>
        <Ticket className="h-4 w-4" />
      </Button>{orderId && <TravelerPrintDialog orderId={orderId} open={travelerOpen} onOpenChange={setTravelerOpen} />}</>;
  }

  return <><Button variant={variant} size={size} className={className} onClick={open}>
      <Ticket className="mr-1.5 h-4 w-4" />
      {text}
    </Button>{orderId && <TravelerPrintDialog orderId={orderId} open={travelerOpen} onOpenChange={setTravelerOpen} />}</>;
}
