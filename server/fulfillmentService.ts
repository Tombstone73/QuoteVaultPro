import { db } from './db';
import { orders, orderLineItems, shipments, customers } from '../shared/schema';
import { eq } from 'drizzle-orm';
import { emailService } from './emailService';

export async function generatePackingSlipHTML(orderId: string): Promise<string> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new Error('Order not found');

  const [customer] = await db.select().from(customers).where(eq(customers.id, order.customerId));
  const lineItems = await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId));

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
    <p>Order #${order.orderNumber}</p>
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
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new Error('Order not found');

  const [customer] = await db.select().from(customers).where(eq(customers.id, order.customerId));
  if (!customer?.email) throw new Error('Customer has no email address');

  const [shipment] = await db.select().from(shipments).where(eq(shipments.id, shipmentId));
  if (!shipment) throw new Error('Shipment not found');

  const lineItems = await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId));

  const trackingLink = shipment.trackingNumber 
    ? generateTrackingLink(shipment.carrier, shipment.trackingNumber)
    : null;

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
    <p>Hi ${customer.companyName},</p>
    <p>Great news! Your order <strong>#${order.orderNumber}</strong> has been shipped via <strong>${shipment.carrier.toUpperCase()}</strong>.</p>
    
    ${shipment.trackingNumber ? `
      <div class="tracking">
        <p>Tracking Number:</p>
        <p class="tracking-number">${shipment.trackingNumber}</p>
        ${trackingLink ? `<a href="${trackingLink}" class="btn">Track Your Package</a>` : ''}
      </div>
    ` : ''}

    <h3>Order Items:</h3>
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
            <td>${item.description}</td>
            <td>${item.quantity}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    ${shipment.notes ? `<p><strong>Shipping Notes:</strong> ${shipment.notes}</p>` : ''}

    <p style="margin-top: 30px;">If you have any questions about your shipment, please don't hesitate to contact us.</p>
    
    <div class="footer">
      <p>Thank you for your business!</p>
    </div>
  </div>
</body>
</html>
  `.trim();

  await emailService.sendEmail(organizationId, {
    to: customer.email,
    subject: `Your Order #${order.orderNumber} Has Shipped!`,
    html,
  });
}

function generateTrackingLink(carrier: string, trackingNumber: string): string | null {
  const lowerCarrier = carrier.toLowerCase();
  
  if (lowerCarrier.includes('ups')) {
    return `https://www.ups.com/track?tracknum=${encodeURIComponent(trackingNumber)}`;
  } else if (lowerCarrier.includes('fedex')) {
    return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(trackingNumber)}`;
  } else if (lowerCarrier.includes('usps')) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(trackingNumber)}`;
  } else if (lowerCarrier.includes('dhl')) {
    return `https://www.dhl.com/en/express/tracking.html?AWB=${encodeURIComponent(trackingNumber)}`;
  }
  
  return null;
}

export async function updateOrderFulfillmentStatus(orderId: string, status: 'pending' | 'packed' | 'shipped' | 'delivered'): Promise<void> {
  await db.update(orders).set({ fulfillmentStatus: status, updatedAt: new Date().toISOString() }).where(eq(orders.id, orderId));
}
