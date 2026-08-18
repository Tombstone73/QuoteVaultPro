import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_shell/invoices")({
  component: () => <Outlet />,
});
