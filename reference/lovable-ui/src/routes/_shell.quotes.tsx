import { createFileRoute } from "@tanstack/react-router";
import { SalesList } from "@/components/app/SalesList";

export const Route = createFileRoute("/_shell/quotes")({
  head: () => ({
    meta: [
      { title: "Quotes — PrintersHero V2" },
      { name: "description", content: "Every open, sent and accepted quote in one filterable list, sharing the same workspace as orders." },
      { property: "og:title", content: "Quotes — PrintersHero V2" },
      { property: "og:description", content: "Track quote status, value and conversion from a single dense list." },
    ],
  }),
  component: () => <SalesList type="Quote" />,
});
