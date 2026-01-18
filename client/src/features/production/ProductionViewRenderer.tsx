import FlatbedProductionView from "@/features/production/views/FlatbedProductionView";
import { Card, CardContent } from "@/components/ui/card";

type ProductionStatus = "queued" | "in_progress" | "done";

const registry: Record<string, (props: { viewKey: string; status: ProductionStatus }) => JSX.Element> = {
  flatbed: (props) => <FlatbedProductionView {...props} />,
};

export default function ProductionViewRenderer(props: { viewKey: string; status: ProductionStatus }) {
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
