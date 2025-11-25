import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface FulfillmentStatusBadgeProps {
  status: "pending" | "packed" | "shipped" | "delivered";
  className?: string;
}

export function FulfillmentStatusBadge({ status, className }: FulfillmentStatusBadgeProps) {
  const getStatusConfig = (status: string) => {
    switch (status) {
      case "pending":
        return {
          label: "Pending",
          className: "bg-gray-500/10 text-gray-500 border-gray-500/20",
        };
      case "packed":
        return {
          label: "Packed",
          className: "bg-blue-500/10 text-blue-500 border-blue-500/20",
        };
      case "shipped":
        return {
          label: "Shipped",
          className: "bg-purple-500/10 text-purple-500 border-purple-500/20",
        };
      case "delivered":
        return {
          label: "Delivered",
          className: "bg-green-500/10 text-green-500 border-green-500/20",
        };
      default:
        return {
          label: status,
          className: "bg-gray-500/10 text-gray-500 border-gray-500/20",
        };
    }
  };

  const config = getStatusConfig(status);

  return (
    <Badge variant="outline" className={cn(config.className, className)}>
      {config.label}
    </Badge>
  );
}
