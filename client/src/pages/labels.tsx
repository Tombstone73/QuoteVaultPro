import PlaceholderPage from "@/components/PlaceholderPage";
import { ROUTES } from "@/config/routes";

export default function LabelsPage() {
  return (
    <PlaceholderPage
      title="Labels"
      description="Labels will live inside Fulfillment once carrier integrations are added. For now, manage shipments and tracking from the Fulfillment module."
      items={[
        {
          title: "Carrier integrations (UPS/FedEx/USPS)",
          status: "coming_soon",
        },
        {
          title: "Buy label + print",
          status: "coming_soon",
        },
        {
          title: "Store label PDFs on shipments",
          status: "planned",
        },
      ]}
      primaryAction={{ label: "Go to Fulfillment", to: ROUTES.fulfillment.list }}
    />
  );
}
