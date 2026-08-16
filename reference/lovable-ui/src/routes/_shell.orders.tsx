import { createFileRoute } from "@tanstack/react-router";
import { SalesList } from "@/components/app/SalesList";

export const Route = createFileRoute("/_shell/orders")({
  head: () => ({
    meta: [
      { title: "Orders — PrintersHero V2" },
      { name: "description", content: "Live order list with due dates, production status and balances for a commercial print shop." },
      { property: "og:title", content: "Orders — PrintersHero V2" },
      { property: "og:description", content: "Orders open in the same workspace as quotes — only the lifecycle actions change." },
    ],
  }),
  component: () => <SalesList type="Order" />,
});
