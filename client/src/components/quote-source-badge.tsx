import { Badge } from "@/components/ui/badge";
import { FileText, User } from "lucide-react";

type QuoteSource = 'internal' | 'customer_quick_quote' | string;

interface QuoteSourceBadgeProps {
  source: QuoteSource;
  className?: string;
}

export function QuoteSourceBadge({ source, className }: QuoteSourceBadgeProps) {
  const getSourceLabel = (s: QuoteSource) => {
    switch (s) {
      case 'internal':
        return { label: 'Internal', variant: 'default' as const, icon: FileText };
      case 'customer_quick_quote':
        return { label: 'Customer', variant: 'secondary' as const, icon: User };
      default:
        return { label: 'Quote', variant: 'outline' as const, icon: FileText };
    }
  };

  const { label, variant, icon: Icon } = getSourceLabel(source);

  return (
    <Badge variant={variant} className={className}>
      <Icon className="w-3 h-3 mr-1" />
      {label}
    </Badge>
  );
}
