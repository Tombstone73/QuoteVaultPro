import PlaceholderPage from "@/components/PlaceholderPage";
import { ROUTES } from "@/config/routes";

export default function ReportsPage() {
  return (
    <PlaceholderPage
      title="Reports"
      description="Reporting will be a build-your-own system with templates. We’ll add the first templates after Fulfillment is live."
      items={[
        { title: "Sales by day/week/month", status: "planned" },
        { title: "Orders by status", status: "planned" },
        { title: "Production throughput", status: "planned" },
        { title: "Top customers", status: "planned" },
        { title: "Product profitability", status: "later" },
      ]}
      primaryAction={{ label: "Open Orders", to: ROUTES.orders.list }}
    />
  );
}
