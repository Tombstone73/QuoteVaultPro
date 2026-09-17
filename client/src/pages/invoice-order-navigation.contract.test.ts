import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@jest/globals";

const invoiceDetail = fs.readFileSync(path.join(process.cwd(), "client/src/pages/invoice-detail.tsx"), "utf8");
const orderDetail = fs.readFileSync(path.join(process.cwd(), "client/src/pages/order-detail.tsx"), "utf8");

test("Invoice to Order links carry the current invoice URL into both detail and pricing edit", () => {
  expect(invoiceDetail).toContain('const invoiceDetailPath = `${location.pathname}${location.search}`;');
  expect(invoiceDetail).toContain('buildDetailReturnPath(`/orders/${invoice.orderId}`, invoiceDetailPath)');
  expect(invoiceDetail).toContain('buildDetailReturnPath(`/orders/${invoice.orderId}/edit?focus=pricing`, invoiceDetailPath)');
});

test("Order resolves an explicit validated return before list context and preserves it across edit transitions", () => {
  expect(orderDetail).toContain('const detailReturnTo = parseDetailReturnPath(searchParams);');
  expect(orderDetail).toContain('resolveDetailBackPath(detailReturnTo, listNavigation.backPath, "/orders")');
  expect(orderDetail).toContain('const orderDetailPath = `${ROUTES.orders.detail(orderId ?? "")}${location.search}`;');
  expect(orderDetail).toContain('const postSavePath = isOrderEditRoute ? orderDetailPath : ROUTES.orders.list;');
  expect(orderDetail).toContain('<Link to={orderDetailPath}>');
});
