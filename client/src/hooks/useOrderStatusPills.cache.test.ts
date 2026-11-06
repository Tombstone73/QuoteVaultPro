import { describe, expect, jest, test } from "@jest/globals";
import { QueryClient } from "@tanstack/react-query";

jest.mock('@/lib/apiConfig', () => ({ getApiUrl: (path: string) => path, apiUrl: (path: string) => path, resolveCanonicalApiRequestUrl: (path: string) => path }));

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
  state: 'open',
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

  test('confirmed Complete removes only matching rows from Open and refreshes pages/counts without changing controls', () => {
    const client=new QueryClient();
    const open=ordersListQueryKey({state:'open',search:'20779',priority:'rush',page:2,pageSize:25,sortBy:'date',sortDir:'desc'});
    const complete=ordersListQueryKey({state:'production_complete',page:1,pageSize:25});
    const all=ordersListQueryKey({page:1,pageSize:25});
    const filtered=ordersListQueryKey({statusPillIds:['pill-waiting'],page:1,pageSize:25});
    const page={items:[originalOrder],page:2,pageSize:25,totalCount:26,totalPages:2,hasNext:false,hasPrev:true};
    client.setQueryData(open,page);client.setQueryData(all,page);client.setQueryData(filtered,page);
    client.setQueryData(complete,{...page,items:[],page:1,totalCount:0,totalPages:1});
    client.setQueryData(['/api/operational-summary'],{orders:26});
    applyOrderStatusPillMutationSuccess({queryClient:client,orderId:'order-1',selectedStatusPillId:'pill-complete',data:{data:{state:'open',status:'in_production'},statusPill:{id:'pill-complete',key:'complete',name:'Complete'}}});
    expect(client.getQueryData(open)).toMatchObject({items:[],page:2,pageSize:25,totalCount:25,totalPages:1});
    expect((client.getQueryData(all) as any).items[0]).toMatchObject({state:'open',status:'in_production',statusPillValue:'Complete'});
    expect((client.getQueryData(filtered) as any).items).toEqual([]);
    expect(client.getQueryState(complete)?.isInvalidated).toBe(true);
    expect(client.getQueryState(['/api/operational-summary'])?.isInvalidated).toBe(true);
    expect(client.getQueryCache().find({queryKey:open})?.queryKey).toEqual(open);
  });

  test('changing back from Complete leaves Prod Complete, while a concurrent canonical closure wins', () => {
    const client=new QueryClient();const key=ordersListQueryKey({state:'production_complete',page:1,pageSize:25});
    const page={items:[{...originalOrder,statusPillKey:'complete',statusPillId:'pill-complete',statusPillValue:'Complete'}],page:1,pageSize:25,totalCount:1,totalPages:1,hasNext:false,hasPrev:false};
    client.setQueryData(key,page);
    applyOrderStatusPillMutationSuccess({queryClient:client,orderId:'order-1',selectedStatusPillId:'pill-new',data:{data:{state:'open',status:'in_production'},statusPill:{id:'pill-new',key:'new',name:'New'}}});
    expect((client.getQueryData(key) as any).items).toEqual([]);
    client.setQueryData(key,page);client.setQueryData(orderDetailQueryKey('order-1'),page.items[0]);
    applyOrderStatusPillMutationSuccess({queryClient:client,orderId:'order-1',selectedStatusPillId:'pill-new',data:{data:{state:'closed',status:'operationally_complete'},statusPill:{id:'pill-complete',key:'complete',name:'Complete'}}});
    expect((client.getQueryData(key) as any).items).toEqual([]);
    expect(client.getQueryData(orderDetailQueryKey('order-1'))).toMatchObject({state:'closed',status:'operationally_complete'});
  });

  test('an older in-flight list response cannot resurrect the confirmed Complete row in Open',async()=>{
    const client=new QueryClient();const key=ordersListQueryKey({state:'open',page:1,pageSize:25});
    const page={items:[originalOrder],page:1,pageSize:25,totalCount:1,totalPages:1,hasNext:false,hasPrev:false};
    client.setQueryData(key,page);let finish!:(value:typeof page)=>void;
    const pending=client.fetchQuery({queryKey:key,queryFn:()=>new Promise<typeof page>(resolve=>{finish=resolve;})}).catch(()=>undefined);
    applyOrderStatusPillMutationSuccess({queryClient:client,orderId:'order-1',selectedStatusPillId:'pill-complete',data:{statusPill:{id:'pill-complete',key:'complete',name:'Complete'}}});
    finish(page);await pending;
    expect((client.getQueryData(key) as any).items).toEqual([]);
  });
});
