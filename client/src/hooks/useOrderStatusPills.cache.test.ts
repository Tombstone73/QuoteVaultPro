import { describe, expect, jest, test } from "@jest/globals";
import { QueryClient } from "@tanstack/react-query";

jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
}));

import { orderDetailQueryKey, ordersListQueryKey } from "./useOrders";
import { getOrdersListStatusSelectorProps } from "@/components/orders/OrdersListStatusCell";
import {
  applyOrderStatusPillMutationSuccess,
  requestOrderStatusPillAssignment,
} from "./useOrderStatusPills";

const originalOrder = {
  id: "order-1",
  statusPillId: "pill-waiting",
  statusPillValue: "Waiting on Approval",
  statusPillKey: "waiting_on_approval",
  statusPillColor: "#a16207",
};

describe("status-pill assignment cache synchronization", () => {
  test("keeps server-side search and lifecycle filters in the Orders list query key", () => {
    expect(ordersListQueryKey({
      page: 1,
      pageSize: 25,
      search: "20032",
      state: "canceled",
      statusPillId: "pill-hold",
      priority: "rush",
    })).toEqual([
      "orders",
      "list",
      expect.objectContaining({
        search: "20032",
        state: "canceled",
        statusPillId: "pill-hold",
        priority: "rush",
        due: undefined,
      }),
    ]);
  });

  test("keeps a dashboard due-window request in its own list cache entry", () => {
    expect(ordersListQueryKey({ page: 1, pageSize: 25, due: "tomorrow" })).toEqual([
      "orders",
      "list",
      expect.objectContaining({ due: "tomorrow" }),
    ]);
  });

  test("successful assignment immediately patches every list page and order detail", () => {
    const queryClient = new QueryClient();
    const firstPageKey = ordersListQueryKey({ page: 1, pageSize: 25, sortBy: "date" });
    const filteredKey = ordersListQueryKey({ page: 2, pageSize: 25, status: "active" });
    queryClient.setQueryData(firstPageKey, { items: [originalOrder], page: 1, pageSize: 25, totalCount: 1, totalPages: 1, hasNext: false, hasPrev: false });
    queryClient.setQueryData(filteredKey, [originalOrder]);
    queryClient.setQueryData(orderDetailQueryKey("order-1"), originalOrder);

    applyOrderStatusPillMutationSuccess({
      queryClient,
      orderId: "order-1",
      selectedStatusPillId: "pill-approved",
      data: {
        data: {
          id: "order-1",
          statusPillId: "pill-approved",
          statusPillValue: "Approved",
          statusPillAssignedAt: "2026-07-18T12:00:00.000Z",
          statusPillAssignedByUserId: "user-1",
          updatedAt: "2026-07-18T12:00:00.000Z",
        },
        statusPill: { id: "pill-approved", key: "approved", name: "Approved", color: "#047857" },
      },
    });

    expect((queryClient.getQueryData(firstPageKey) as any).items[0]).toMatchObject({
      statusPillId: "pill-approved",
      statusPillValue: "Approved",
      statusPillKey: "approved",
      statusPillColor: "#047857",
      statusPillAssignedByUserId: "user-1",
    });
    expect((queryClient.getQueryData(filteredKey) as any)[0].statusPillValue).toBe("Approved");
    expect(getOrdersListStatusSelectorProps((queryClient.getQueryData(firstPageKey) as any).items[0])).toMatchObject({
      currentPillId: "pill-approved",
      currentPillValue: "Approved",
    });
    expect(queryClient.getQueryData(orderDetailQueryKey("order-1"))).toMatchObject({
      statusPillValue: "Approved",
      statusPillColor: "#047857",
    });
    expect(queryClient.getQueryState(firstPageKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(filteredKey)?.isInvalidated).toBe(true);
  });

  test("failed assignment rejects without changing the existing row cache", async () => {
    const queryClient = new QueryClient();
    const listKey = ordersListQueryKey({ page: 1, pageSize: 25 });
    queryClient.setQueryData(listKey, { items: [originalOrder] });
    const fetchFn = jest.fn(async () => ({
      ok: false,
      json: async () => ({ message: "Assignment rejected" }),
    })) as unknown as typeof fetch;

    await expect(requestOrderStatusPillAssignment("order-1", "pill-approved", fetchFn)).rejects.toThrow("Assignment rejected");
    expect((queryClient.getQueryData(listKey) as any).items[0]).toMatchObject(originalOrder);
  });
});
