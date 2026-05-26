import FlatbedProductionView from "@/features/production/views/FlatbedProductionView";
import RollProductionView from "@/features/production/views/RollProductionView";
import { Card, CardContent } from "@/components/ui/card";
import type { ProductionJobListItem } from "@/hooks/useProduction";
import type { ProductionBoardTab } from "@/lib/productionBoard";

type ProductionStatus = ProductionBoardTab;

const registry: Record<string, (props: { viewKey: string; status: ProductionStatus; jobs?: ProductionJobListItem[] }) => JSX.Element> = {
  flatbed: (props) => <FlatbedProductionView {...props} />,
  roll: (props) => <RollProductionView {...props} />,
};

export default function ProductionViewRenderer(props: { viewKey: string; status: ProductionStatus; jobs?: ProductionJobListItem[] }) {
  const View = registry[props.viewKey];
  if (!View) {
    return (
      <Card className="bg-titan-bg-card border-titan-border-subtle">
        <CardContent className="p-4 text-sm text-titan-text-muted">
          Production view <span className="font-medium text-titan-text-primary">{props.viewKey}</span> is not implemented.
        </CardContent>
      </Card>
    );
  }

  return <View {...props} />;
}
