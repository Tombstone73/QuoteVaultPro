import { useNavigate } from "react-router-dom";
import { ClipboardPlus, FilePlus2, ReceiptText, ShoppingCart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ROUTES } from "@/config/routes";

export default function QuickActionsPanel() {
  const navigate = useNavigate();

  return (
    <Card className="border-border bg-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm uppercase tracking-wider">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button className="w-full" onClick={() => navigate(ROUTES.quotes.new)}>
          <FilePlus2 className="h-4 w-4" />
          New Quote
        </Button>

        <Button className="w-full" variant="outline" onClick={() => navigate(ROUTES.orders.new)}>
          <ShoppingCart className="h-4 w-4" />
          New Order
        </Button>

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled title="Coming soon" className="h-14 flex-col gap-1">
            <ClipboardPlus className="h-4 w-4" />
            <span className="text-xs">Receive</span>
          </Button>

          <Button variant="outline" onClick={() => navigate(ROUTES.invoices.list)} className="h-14 flex-col gap-1">
            <ReceiptText className="h-4 w-4" />
            <span className="text-xs">Invoice</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
