import { Factory } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ActiveProductionValueCardProps = {
  value?: { totalCents: number; newCents: number; inProductionCents: number } | null;
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatCents(cents: number | undefined) {
  return cents == null ? "—" : currency.format(cents / 100);
}

export default function ActiveProductionValueCard({ value }: ActiveProductionValueCardProps) {
  return (
    <Card className="border-border bg-card">
      <CardHeader className="border-b border-border pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Factory className="h-4 w-4 text-primary" />
          Active Production Value
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-end justify-between gap-4 pt-4">
        <div className="text-3xl font-semibold tabular-nums tracking-tight" data-testid="active-production-value-total">
          {formatCents(value?.totalCents)}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
          <span>New: <strong className="font-medium text-foreground">{formatCents(value?.newCents)}</strong></span>
          <span>In Production: <strong className="font-medium text-foreground">{formatCents(value?.inProductionCents)}</strong></span>
        </div>
      </CardContent>
    </Card>
  );
}
