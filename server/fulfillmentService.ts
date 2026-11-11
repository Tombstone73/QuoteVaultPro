import { db } from './db';
import { orders, orderLineItems, shipmentItems, shipmentOrders, customers } from '../shared/schema';
import { and, eq, sum } from 'drizzle-orm';
import { emailService } from './emailService';
import { FulfillmentHttpError } from './services/fulfillment/types';
import { loadShipmentTrackingSources } from './services/shipmentTrackingService';

export async function generatePackingSlipHTML(orderId: string): Promise<string> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new Error('Order not found');

  const [customer] = order.customerId
    ? await db.select().from(customers).where(eq(customers.id, order.customerId))
    : [];
  const lineItems = await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId));
  const orderDisplayNumber = order.displayNumber || order.orderNumber;

  const shippingAddr = (order.shippingAddress as {
    name?: string;
    company?: string;
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
    phone?: string;
  }) || {};
  const addressLine1 = shippingAddr.address1 || '';
  const addressLine2 = shippingAddr.address2 ? `<br>${shippingAddr.address2}` : '';
  const cityStateZip = `${shippingAddr.city || ''}, ${shippingAddr.state || ''} ${shippingAddr.zip || ''}`;
  
  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; }
    .header { text-align: center; margin-bottom: 30px; border-bottom: 2px solid #333; padding-bottom: 10px; }
    .header h1 { margin: 0; font-size: 28px; }
    .info-section { margin-bottom: 20px; }
    .info-section strong { display: inline-block; width: 120px; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { border: 1px solid #ddd; padding: 10px; text-align: left; }
    th { background-color: #f2f2f2; font-weight: bold; }
    .notes { margin-top: 30px; padding: 15px; background-color: #f9f9f9; border-left: 4px solid #333; }
    .footer { margin-top: 40px; text-align: center; color: #666; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>PACKING SLIP</h1>
    <p>Order ${orderDisplayNumber}</p>
  </div>

  <div class="info-section">
    <p><strong>Ship To:</strong></p>
    <p>
      ${shippingAddr.name || customer?.companyName || ''}<br>
      ${shippingAddr.company ? shippingAddr.company + '<br>' : ''}
      ${addressLine1}${addressLine2}<br>
      ${cityStateZip}<br>
      ${shippingAddr.country || 'USA'}
      ${shippingAddr.phone ? '<br>Phone: ' + shippingAddr.phone : ''}
    </p>
  </div>

  <div class="info-section">
    <p><strong>Order Date:</strong> ${new Date(order.createdAt).toLocaleDateString()}</p>
    ${order.promisedDate ? `<p><strong>Promised Date:</strong> ${new Date(order.promisedDate).toLocaleDateString()}</p>` : ''}
  </div>

  <table>
    <thead>
      <tr>
        <th>Description</th>
        <th>Quantity</th>
        <th>Dimensions</th>
      </tr>
    </thead>
    <tbody>
      ${lineItems.map(item => `
        <tr>
          <td>${item.description}</td>
          <td>${item.quantity}</td>
          <td>${item.width && item.height ? `${item.width}" × ${item.height}"` : '-'}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  ${order.notesInternal ? `
    <div class="notes">
      <strong>Internal Notes:</strong><br>
      ${order.notesInternal}
    </div>
  ` : ''}

  <div class="footer">
    <p>Thank you for your business!</p>
    <p>This is a packing slip, not an invoice.</p>
  </div>
</body>
</html>
  `.trim();

  // Save packing slip HTML to order for later retrieval
  await db.update(orders).set({ packingSlipHtml: html, updatedAt: new Date().toISOString() }).where(eq(orders.id, orderId));

  return html;
}

export async function sendShipmentEmail(
  organizationId: string,
  orderId: string,
  shipmentId: string,
  subject?: string,
  customMessage?: string
): Promise<void> {
  const [order] = await db.select().from(orders).where(and(
    eq(orders.id, orderId),
    eq(orders.organizationId, organizationId),
  ));
  if (!order) throw new Error('Order not found');

  const [customer] = order.customerId
    ? await db.select().from(customers).where(and(
      eq(customers.id, order.customerId),
      eq(customers.organizationId, organizationId),
    ))
    : [];
  const recipientEmail = customer?.email ?? order.billToEmail;
  if (!recipientEmail) throw new Error('Order has no customer or contact email address');

  const [shipmentOrder] = await db.select({ orderId: shipmentOrders.orderId }).from(shipmentOrders).where(and(
    eq(shipmentOrders.organizationId, organizationId),
    eq(shipmentOrders.shipmentId, shipmentId),
    eq(shipmentOrders.orderId, orderId),
  )).limit(1);
  if (!shipmentOrder) throw new FulfillmentHttpError(404, 'Shipment does not belong to this Order.', 'NOT_FOUND');

  const [shipment] = await loadShipmentTrackingSources(organizationId, [shipmentId]);
  if (shipment?.status !== 'SHIPPED') throw new FulfillmentHttpError(409, 'Choose a current shipped shipment for the notification.', 'INVALID_STATE');
  const allocationScope = and(eq(shipmentItems.organizationId, organizationId), eq(shipmentItems.shipmentId, shipmentId), eq(shipmentItems.orderId, orderId));
  const [lineItems, assignedPackages] = await Promise.all([
    db.select({ description: orderLineItems.description, quantity: sum(shipmentItems.quantity) }).from(shipmentItems)
      .innerJoin(orderLineItems, and(eq(orderLineItems.id, shipmentItems.orderLineItemId), eq(orderLineItems.orderId, orderId)))
      .where(allocationScope).groupBy(orderLineItems.id, orderLineItems.description),
    db.selectDistinct({ id: shipmentItems.packageId }).from(shipmentItems).where(allocationScope),
  ]);
  const packageIds = new Set(assignedPackages.map(pkg => pkg.id));
  const tracking = shipment.trackingPackages.filter(pkg => shipment.scope !== 'MULTI_ORDER' || !pkg.packageId || packageIds.has(pkg.packageId));
  const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
  const orderDisplayNumber = order.displayNumber || order.orderNumber;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; border-radius: 5px 5px 0 0; }
    .content { background-color: #f9f9f9; padding: 20px; border: 1px solid #ddd; border-top: none; }
    .tracking { background-color: #fff; padding: 15px; margin: 20px 0; border-left: 4px solid #4CAF50; }
    .tracking-number { font-size: 18px; font-weight: bold; color: #333; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background-color: #f2f2f2; font-weight: bold; }
    .btn { display: inline-block; padding: 12px 24px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 4px; margin: 15px 0; }
    .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>📦 Your Order Has Shipped!</h1>
  </div>
  <div class="content">
    <p>Hi ${escape(customer?.companyName || 'there')},</p>
    <p>A shipment for your order <strong>${escape(orderDisplayNumber)}</strong> has shipped.</p>
    
    ${tracking.map(pkg => `
      <div class="tracking">
        <p>${escape([pkg.packageReference, pkg.carrier].filter(Boolean).join(' · ') || 'Tracking number')}</p>
        <p class="tracking-number">${escape(pkg.trackingNumber)}</p>
        ${pkg.trackingUrl ? `<a href="${escape(pkg.trackingUrl)}" class="btn">Track Your Package</a>` : ''}
      </div>
    `).join('')}

    ${lineItems.length ? `<h3>Items in this shipment:</h3>
    <table>
      <thead>
        <tr>
          <th>Description</th>
          <th>Qty</th>
        </tr>
      </thead>
      <tbody>
        ${lineItems.map(item => `
          <tr>
            <td>${escape(item.description)}</td>
            <td>${escape(item.quantity)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>` : ''}

    ${customMessage?.trim() ? `<p>${escape(customMessage.trim())}</p>` : ''}
    ${shipment.notes ? `<p><strong>Shipping Notes:</strong> ${escape(shipment.notes)}</p>` : ''}

    <p style="margin-top: 30px;">If you have any questions about your shipment, please don't hesitate to contact us.</p>
    
    <div class="footer">
      <p>Thank you for your business!</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  await emailService.sendEmail(organizationId, {
    to: recipientEmail,
    subject: subject?.trim() || `Your Order ${orderDisplayNumber} Has Shipped!`,
    html,
  });
}

export async function updateOrderFulfillmentStatus(organizationId: string, orderId: string, status: 'pending' | 'packed' | 'shipped' | 'delivered'): Promise<void> {
  await db.update(orders).set({ fulfillmentStatus: status, updatedAt: new Date().toISOString() }).where(and(
    eq(orders.id, orderId),
    eq(orders.organizationId, organizationId),
  ));
}
