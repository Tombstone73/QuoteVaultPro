import PlaceholderPage from "@/components/PlaceholderPage";
import { ROUTES } from "@/config/routes";

export default function FinancePage() {
  return (
    <PlaceholderPage
      title="Finance"
      description="Payments are applied from invoices today. This screen will become a financial overview later."
      items={[
        { title: "Outstanding invoices", status: "planned" },
        { title: "Overdue invoices", status: "planned" },
        { title: "Paid in last 7 days", status: "planned" },
        { title: "QuickBooks sync overview", status: "later" },
      ]}
      primaryAction={{ label: "Open Invoices", to: ROUTES.invoices.list }}
    />
  );
}
