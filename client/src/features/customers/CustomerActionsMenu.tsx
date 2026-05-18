/**
 * CustomerActionsMenu
 *
 * Structured actions component for customer views.
 *
 * Primary visible actions (full mode):
 *   - New Quote
 *   - New Order
 *
 * Overflow dropdown:
 *   - Edit Customer      (via callback)
 *   - ── separator ──
 *   - Add Contact        (→ /contacts?customerId=...&action=new)
 *   - View Contacts      (→ /contacts?customerId=...)
 *   - ── separator ──
 *   - Transactions       (switches to transactions tab via callback)
 *   - Generate Statement (disabled placeholder)
 *   - ── separator ──
 *   - Local Storage      (via callback)
 *
 * Embedded/small mode: only shows overflow dropdown.
 */

import { useNavigate } from "react-router-dom";
import {
  FileText,
  ShoppingCart,
  Edit,
  FolderOpen,
  MoreHorizontal,
  UserPlus,
  Users,
  Receipt,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface CustomerActionsMenuProps {
  customerId: string;
  /** Compact/embedded mode — only shows overflow dropdown */
  embedded?: boolean;
  /** Called when "Edit Customer" is clicked */
  onEditCustomer?: () => void;
  /** Called when "Local Storage" is clicked */
  onLocalStorage?: () => void;
  /** Called when tab-targeting items are clicked (e.g. "Transactions") */
  onSwitchTab?: (tab: string) => void;
}

export function CustomerActionsMenu({
  customerId,
  embedded = false,
  onEditCustomer,
  onLocalStorage,
  onSwitchTab,
}: CustomerActionsMenuProps) {
  const navigate = useNavigate();

  const overflowMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated rounded-md flex-shrink-0"
          aria-label="More customer actions"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="bg-titan-bg-card border-titan-border w-52">
        {onEditCustomer && (
          <>
            <DropdownMenuItem
              onClick={onEditCustomer}
              className="text-titan-text-primary hover:bg-titan-bg-card-elevated cursor-pointer gap-2"
            >
              <Edit className="w-3.5 h-3.5 text-titan-text-secondary" />
              Edit Customer
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-titan-border-subtle" />
          </>
        )}

        <DropdownMenuItem
          onClick={() => navigate(`/contacts?customerId=${customerId}&action=new`)}
          className="text-titan-text-primary hover:bg-titan-bg-card-elevated cursor-pointer gap-2"
        >
          <UserPlus className="w-3.5 h-3.5 text-titan-text-secondary" />
          Add Contact
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => navigate(`/contacts?customerId=${customerId}`)}
          className="text-titan-text-primary hover:bg-titan-bg-card-elevated cursor-pointer gap-2"
        >
          <Users className="w-3.5 h-3.5 text-titan-text-secondary" />
          View Contacts
        </DropdownMenuItem>

        <DropdownMenuSeparator className="bg-titan-border-subtle" />

        <DropdownMenuItem
          onClick={() => onSwitchTab?.("transactions")}
          className="text-titan-text-primary hover:bg-titan-bg-card-elevated cursor-pointer gap-2"
        >
          <Receipt className="w-3.5 h-3.5 text-titan-text-secondary" />
          Transactions
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled
          className="text-titan-text-muted/50 cursor-not-allowed gap-2"
        >
          <BarChart3 className="w-3.5 h-3.5" />
          <span>Generate Statement</span>
          <span className="ml-auto text-[10px] bg-titan-bg-card-elevated px-1.5 py-0.5 rounded text-titan-text-muted">
            soon
          </span>
        </DropdownMenuItem>

        {onLocalStorage && (
          <>
            <DropdownMenuSeparator className="bg-titan-border-subtle" />
            <DropdownMenuItem
              onClick={onLocalStorage}
              className="text-titan-text-primary hover:bg-titan-bg-card-elevated cursor-pointer gap-2"
            >
              <FolderOpen className="w-3.5 h-3.5 text-titan-text-secondary" />
              Local Storage
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  if (embedded) {
    return overflowMenu;
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button
        size="sm"
        variant="outline"
        onClick={() => navigate(`/quotes/new?customerId=${customerId}`)}
        disabled={!customerId}
        className="h-7 px-2 text-[11px] border-titan-border-subtle text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated"
      >
        <FileText className="w-3 h-3 mr-1" />
        Quote
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => navigate(`/orders/new?customerId=${customerId}`)}
        disabled={!customerId}
        className="h-7 px-2 text-[11px] border-titan-border-subtle text-titan-text-secondary hover:text-titan-text-primary hover:bg-titan-bg-card-elevated"
      >
        <ShoppingCart className="w-3 h-3 mr-1" />
        Order
      </Button>
      {overflowMenu}
    </div>
  );
}
