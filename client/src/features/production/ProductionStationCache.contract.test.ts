import { QueryClient } from "@tanstack/react-query";
const client = new QueryClient();
jest.mock("@tanstack/react-query", () => ({
  ...jest.requireActual("@tanstack/react-query"),
  useQueryClient: () => client,
  useMutation: (options: unknown) => options,
}));
jest.mock("react-router-dom", () => ({ useNavigate: () => jest.fn() }));
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: jest.fn() }) }));
jest.mock("@/components/ui/toast", () => ({ ToastAction: () => null }));
const hooks = require("@/hooks/useProduction");

test.each(["useCreateProductionRun", "useCreatePrepressProductionRun", "useRecordProductionRunOutcome", "useRecordProductionRunSheetProgress"])(
  "%s invalidates the badge and every filtered station cache after success", name => {
    client.clear();
    const keys = [["/api/operational-summary"], ["/api/production/jobs", { view: "flatbed", search: "sign" }, "station-population-v1"],
      ["/api/production/jobs", { view: "roll" }, "station-population-v1"], ["/api/production/runs", { station: "flatbed" }]];
    for (const key of keys) client.setQueryData(key, { fixture: true });
    hooks[name]().onSuccess();
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    client.clear();
  },
);
