import { Badge } from "@/components/ui/badge";

export function LowStockBadge({ stock, min }: { stock: number; min: number }) {
  if (stock >= min) return null;
  return <Badge variant="destructive" className="animate-pulse">Low Stock</Badge>;
}
