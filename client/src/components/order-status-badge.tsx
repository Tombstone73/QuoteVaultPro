import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface OrderStatusBadgeProps {
  status: string;
  className?: string;
}

export function OrderStatusBadge({ status, className }: OrderStatusBadgeProps) {
  const getStatusConfig = (status: string) => {
    switch (status.toLowerCase()) {
      case "new":
        return {
          label: "New",
          className: "bg-blue-500/10 text-blue-500 border-blue-500/20",
        };
      case "scheduled":
        return {
          label: "Scheduled",
          className: "bg-purple-500/10 text-purple-500 border-purple-500/20",
        };
      case "in_production":
        return {
          label: "In Production",
          className: "bg-orange-500/10 text-orange-500 border-orange-500/20",
        };
      case "ready_for_pickup":
        return {
          label: "Ready for Pickup",
          className: "bg-green-500/10 text-green-500 border-green-500/20",
        };
      case "shipped":
        return {
          label: "Shipped",
          className: "bg-teal-500/10 text-teal-500 border-teal-500/20",
        };
      case "completed":
        return {
          label: "Completed",
          className: "bg-gray-500/10 text-gray-500 border-gray-500/20",
        };
      case "on_hold":
        return {
          label: "On Hold",
          className: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
        };
      case "canceled":
        return {
          label: "Canceled",
          className: "bg-red-500/10 text-red-500 border-red-500/20",
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

interface OrderPriorityBadgeProps {
  priority: string;
  className?: string;
}

export function OrderPriorityBadge({ priority, className }: OrderPriorityBadgeProps) {
  const getPriorityConfig = (priority: string) => {
    switch (priority.toLowerCase()) {
      case "rush":
        return {
          label: "Rush",
          className: "bg-red-500/10 text-red-500 border-red-500/20",
        };
      case "normal":
        return {
          label: "Normal",
          className: "bg-blue-500/10 text-blue-500 border-blue-500/20",
        };
      case "low":
        return {
          label: "Low",
          className: "bg-gray-500/10 text-gray-500 border-gray-500/20",
        };
      default:
        return {
          label: priority,
          className: "bg-gray-500/10 text-gray-500 border-gray-500/20",
        };
    }
  };

  const config = getPriorityConfig(priority);

  return (
    <Badge variant="outline" className={cn(config.className, className)}>
      {config.label}
    </Badge>
  );
}

interface LineItemStatusBadgeProps {
  status: string;
  className?: string;
}

export function LineItemStatusBadge({ status, className }: LineItemStatusBadgeProps) {
  const getStatusConfig = (status: string) => {
    switch (status.toLowerCase()) {
      case "queued":
        return {
          label: "Queued",
          className: "bg-gray-500/10 text-gray-500 border-gray-500/20",
        };
      case "printing":
        return {
          label: "Printing",
          className: "bg-blue-500/10 text-blue-500 border-blue-500/20",
        };
      case "finishing":
        return {
          label: "Finishing",
          className: "bg-purple-500/10 text-purple-500 border-purple-500/20",
        };
      case "done":
        return {
          label: "Done",
          className: "bg-green-500/10 text-green-500 border-green-500/20",
        };
      case "canceled":
        return {
          label: "Canceled",
          className: "bg-red-500/10 text-red-500 border-red-500/20",
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
