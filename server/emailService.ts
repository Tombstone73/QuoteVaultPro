import { google } from "googleapis";
import { storage } from "./storage";
import type { EmailSettings } from "@shared/schema";
import { buildRawMessage, normalizeEmailAttachments, type EmailAttachment } from "./lib/emailMime";
export { buildRawMessage, normalizeEmailAttachments } from "./lib/emailMime";

/**
 * Returns true for Google OAuth auth failures that indicate the refresh token
 * is invalid or revoked and the organisation must reconnect.
 * Covers: invalid_grant, token revocation, 401 UNAUTHENTICATED.
 */
function isGmailAuthError(err: any): boolean {
  const msg = String(err?.message || err?.toString() || '').toLowerCase();
  const code = err?.code ?? err?.status;
  return (
    msg.includes('invalid_grant') ||
    msg.includes('token has been expired or revoked') ||
    msg.includes('invalid credentials') ||
    msg.includes('invalid_token') ||
    msg.includes('unauthenticated') ||
    code === 401 ||
    code === 'invalid_grant'
  );
}

/**
 * Utility to add timeout to promises with clear error messages
 */
function withTimeout<T>(label: string, ms: number, promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}


interface EmailConfig {
  provider: string;
  fromAddress: string;
  fromName: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
}

interface EmailTemplates {
  replyToEmail?: string;
  quoteEmailSubject?: string;
  quoteEmailBody?: string;
  invoiceEmailSubject?: string;
  invoiceEmailBody?: string;
}

export function resolveQuoteEmailContent(input: {
  customSubject?: string | null;
  customBody?: string | null;
  subjectTemplate?: string | null;
  bodyTemplate?: string | null;
  variables: Record<string, unknown>;
}): { subject: string; bodyText: string } {
  const replaceVariables = (template: string) => {
    let result = template;
    Object.entries(input.variables).forEach(([key, value]) => {
      result = result.replace(new RegExp(`\\{${key}\\}`, "g"), String(value ?? ""));
    });
    return result;
  };

  const subjectTemplate = input.subjectTemplate || "Quote #{quoteNumber} from {companyName}";
  const bodyTemplate = input.bodyTemplate || "Hello,\n\nPlease find your quote #{quoteNumber} below.\n\nThank you for your business!";

  return {
    subject: input.customSubject?.trim() || replaceVariables(subjectTemplate),
    bodyText: input.customBody?.trim() || replaceVariables(bodyTemplate),
  };
}

export function quoteEmailPlainTextToHtml(bodyText: string): string {
  return bodyText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\r?\n/g, "<br>");
}


class EmailService {
  /**
   * Get email templates from organization settings
   */
  private async getEmailTemplates(organizationId: string): Promise<EmailTemplates> {
    try {
      const { db } = await import('./db');
      const { organizations } = await import('@shared/schema');
      const { eq } = await import('drizzle-orm');

      const [org] = await db
        .select({ settings: organizations.settings })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      if (!org || !org.settings) {
        return {};
      }

      const settings = org.settings as any;
      return settings.emailTemplates || {};
    } catch (error) {
      console.error('[EmailService] Failed to load email templates:', error);
      return {};
    }
  }

  /**
   * Replace template variables in subject/body
   */
  private replaceTemplateVariables(template: string, variables: Record<string, any>): string {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`\\{${key}\\}`, 'g');
      result = result.replace(regex, String(value || ''));
    }
    return result;
  }

  /**
   * Get email configuration from database.
   * Platform credentials (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) take precedence
   * over any per-org credentials that may have been stored in the legacy manual flow.
   */
  private async getEmailConfig(organizationId: string): Promise<EmailConfig | null> {
    const settings = await storage.getDefaultEmailSettings(organizationId);
    if (!settings) {
      console.error(`[EmailService] No email settings found for org ${organizationId}`);
      return null;
    }

    const clientId = process.env.GOOGLE_CLIENT_ID || undefined;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || undefined;

    console.log(`[EmailService] Loaded config for org ${organizationId}:`, {
      provider: settings.provider,
      fromAddress: settings.fromAddress,
      fromName: settings.fromName,
      connectionStatus: settings.connectionStatus,
      hasPlatformClientId: !!clientId,
      hasPlatformClientSecret: !!clientSecret,
      hasRefreshToken: !!settings.refreshToken,
    });

    return {
      provider: settings.provider,
      fromAddress: settings.fromAddress,
      fromName: settings.fromName,
      clientId,
      clientSecret,
      refreshToken: settings.refreshToken || undefined,
    };
  }

  /**
   * Create Gmail API client with OAuth2 credentials
   */
  private async createGmailClient(config: EmailConfig) {
    console.log('[EmailService] [STAGE: create-gmail-client] Creating Gmail API client:', {
      fromAddress: config.fromAddress,
      provider: config.provider,
    });

    const OAuth2 = google.auth.OAuth2;
    // redirect_uri is not used during refresh-token flows; set to the platform callback
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI ||
      `${(process.env.APP_URL ?? 'http://localhost:5000').replace(/\/$/, '')}/api/email/google/callback`;
    const oauth2Client = new OAuth2(
      config.clientId,
      config.clientSecret,
      redirectUri,
    );

    oauth2Client.setCredentials({
      refresh_token: config.refreshToken,
    });

    // Get access token with timeout
    console.log('[EmailService] [STAGE: fetch-access-token] Requesting OAuth2 access token from Google...');
    try {
      await withTimeout(
        'OAuth2 access token retrieval',
        10000, // 10 second timeout
        oauth2Client.getAccessToken()
      );
      console.log('[EmailService] [STAGE: fetch-access-token] ✅ OAuth2 access token obtained successfully');
    } catch (error: any) {
      console.error('[EmailService] [STAGE: fetch-access-token] ❌ Failed to get OAuth2 access token:', {
        error: error.message,
        code: error.code,
      });
      if (error.message.includes('timed out')) {
        throw new Error('Timed out while contacting Google to fetch an access token. Please check your network connection and try again.');
      }
      // Surface auth errors with a recognisable marker so callers can detect them
      if (isGmailAuthError(error)) {
        const authErr = new Error(`GMAIL_AUTH_ERROR: ${error.message}`);
        (authErr as any).isGmailAuthError = true;
        throw authErr;
      }
      throw new Error(`Failed to authenticate with Gmail: ${error.message}`);
    }

    // Create Gmail API client
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    console.log('[EmailService] [STAGE: create-gmail-client] ✅ Gmail API client created');
    
    return gmail;
  }

  /**
   * Send email via Gmail API (avoids SMTP timeouts on Railway)
   */
  private async sendViaGmailAPI(config: EmailConfig, options: {
    to: string;
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
    attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
  }): Promise<string> {
    const gmail = await this.createGmailClient(config);

    const fromAddress = `"${config.fromName}" <${config.fromAddress}>`;
    console.log(`[EmailService] Using From: "${config.fromName}" <${config.fromAddress}>`);
    if (options.replyTo) {
      console.log(`[EmailService] Using Reply-To: ${options.replyTo}`);
    }
    
    const rawMessage = buildRawMessage({
      from: fromAddress,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
      attachments: options.attachments,
    });

    console.log('[EmailService] [STAGE: send-via-gmail-api] Sending email via Gmail API...');
    try {
      const result = await withTimeout(
        'Gmail API send operation',
        20000, // 20 second timeout
        gmail.users.messages.send({
          userId: 'me',
          requestBody: {
            raw: rawMessage,
          },
        })
      );
      
      console.log('[EmailService] [STAGE: send-via-gmail-api] ✅ Email sent successfully via Gmail API:', {
        messageId: result.data.id,
        threadId: result.data.threadId,
      });

      return result.data.id || 'no-message-id';
    } catch (error: any) {
      console.error('[EmailService] [STAGE: send-via-gmail-api] ❌ Gmail API send failed:', {
        error: error.message,
        code: error.code,
      });
      if (error.message.includes('timed out')) {
        throw new Error('Timed out while sending email via Gmail API. Please check your network connection and try again.');
      }
      // Re-surface tagged auth errors without wrapping
      if ((error as any).isGmailAuthError || isGmailAuthError(error)) {
        const authErr = new Error(`GMAIL_AUTH_ERROR: ${error.message}`);
        (authErr as any).isGmailAuthError = true;
        throw authErr;
      }
      throw new Error(`Failed to send email via Gmail API: ${error.message}`);
    }
  }

  /**
   * Send a test email to verify configuration
   */
  async sendTestEmail(organizationId: string, recipientEmail: string): Promise<void> {
    console.log('[EmailService] [STAGE: load-config] Loading email config for test email:', {
      organizationId,
      recipientEmail,
    });

    const config = await this.getEmailConfig(organizationId);
    if (!config) {
      console.error('[EmailService] [STAGE: load-config] ❌ No email settings found');
      throw new Error("Email settings not configured. Please configure email settings in the admin panel.");
    }
    console.log('[EmailService] [STAGE: load-config] ✅ Config loaded successfully');

    if (config.provider !== 'gmail' || !config.refreshToken) {
      throw new Error('Gmail is not connected. Please connect your Gmail account in Settings → Email.');
    }
    if (!config.clientId || !config.clientSecret) {
      throw new Error('Gmail OAuth app is not configured. Please contact your platform administrator to set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.');
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Email Configuration Test</h2>
        <p>This is a test email from ${config.fromName}.</p>
        <p>If you're receiving this, your email configuration is working correctly! ✅</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #666; font-size: 12px;">
          Sent from ${config.fromName} via Gmail API<br>
          Provider: ${config.provider}
        </p>
      </div>
    `;

    await this.sendOrMarkRevoked(organizationId, config, {
      to: recipientEmail,
      subject: `Test Email from ${config.fromName}`,
      html,
    });
  }

  /**
   * Send quote email to recipient
   */
  async sendQuoteEmail(
    organizationId: string,
    quoteId: string,
    recipientEmail: string,
    userId?: string,
    options: {
      subject?: string;
      body?: string;
      attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
    } = {},
  ): Promise<void> {
    console.log('[EmailService] [STAGE: load-config] Loading config for quote email:', {
      organizationId,
      quoteId,
      recipientEmail,
    });

    const config = await this.getEmailConfig(organizationId);
    if (!config) {
      console.error('[EmailService] [STAGE: load-config] ❌ No email settings found');
      throw new Error("Email settings not configured. Please configure email settings in the admin panel.");
    }

    if (config.provider !== 'gmail' || !config.refreshToken) {
      throw new Error('Gmail is not connected. Please connect your Gmail account in Settings → Email.');
    }
    if (!config.clientId || !config.clientSecret) {
      throw new Error('Gmail OAuth app is not configured. Please contact your platform administrator.');
    }

    // Get quote data
    const quote = await storage.getQuoteById(organizationId, quoteId, userId);
    if (!quote) {
      throw new Error("Quote not found");
    }

    // Get email templates
    const templates = await this.getEmailTemplates(organizationId);
    console.log('[EmailService] [STAGE: load-config] ✅ Config, quote data, and templates loaded');

    // Prepare template variables
    const quoteDisplayNumber = (quote as any).displayNumber || quote.quoteNumber;
    const variables = {
      quoteNumber: quoteDisplayNumber,
      companyName: config.fromName,
      customerName: quote.customerName || 'Customer',
    };

    // Use custom template or default
    const { subject, bodyText } = resolveQuoteEmailContent({
      customSubject: options.subject,
      customBody: options.body,
      subjectTemplate: templates.quoteEmailSubject,
      bodyTemplate: templates.quoteEmailBody,
      variables,
    });

    // Convert plain text body to HTML with proper formatting
    const bodyHtml = quoteEmailPlainTextToHtml(bodyText);

    // Generate full HTML email with quote details
    const htmlContent = this.generateQuoteEmailHTML(quote, bodyHtml);

    await this.sendOrMarkRevoked(organizationId, config, {
      to: recipientEmail,
      subject,
      html: htmlContent,
      replyTo: templates.replyToEmail,
      attachments: options.attachments,
    });
  }

  /**
   * Send order confirmation/work order email to recipient
   */
  async sendOrderEmail(
    organizationId: string,
    orderId: string,
    recipientEmail: string,
    options: { attachments?: Array<{ filename: string; content: Buffer; contentType: string }> } = {},
  ): Promise<void> {
    console.log('[EmailService] [STAGE: load-config] Loading config for order email:', {
      organizationId,
      orderId,
      recipientEmail,
    });

    const config = await this.getEmailConfig(organizationId);
    if (!config) {
      throw new Error("Email settings not configured. Please configure email settings in the admin panel.");
    }

    if (config.provider !== 'gmail' || !config.refreshToken) {
      throw new Error('Gmail is not connected. Please connect your Gmail account in Settings → Email.');
    }
    if (!config.clientId || !config.clientSecret) {
      throw new Error('Gmail OAuth app is not configured. Please contact your platform administrator.');
    }

    const order = await storage.getOrderById(organizationId, orderId);
    if (!order) {
      throw new Error("Order not found");
    }

    const templates = await this.getEmailTemplates(organizationId);
    const orderDisplayNumber = (order as any).displayNumber || (order as any).orderNumber;
    const variables = {
      orderNumber: orderDisplayNumber,
      quoteNumber: orderDisplayNumber,
      companyName: config.fromName,
      customerName: (order as any).customer?.companyName || (order as any).customer?.name || (order as any).billToName || 'Customer',
    };

    const subjectTemplate = (templates as any).orderEmailSubject || 'Order #{orderNumber} from {companyName}';
    const bodyTemplate = (templates as any).orderEmailBody || 'Hello,\n\nPlease find your order confirmation for #{orderNumber} below.\n\nThank you for your business!';
    const subject = this.replaceTemplateVariables(subjectTemplate, variables);
    const bodyText = this.replaceTemplateVariables(bodyTemplate, variables);
    const bodyHtml = bodyText.split('\n').map(line => line || '<br>').join('<br>');
    const htmlContent = this.generateOrderEmailHTML(order, bodyHtml);

    await this.sendOrMarkRevoked(organizationId, config, {
      to: recipientEmail,
      subject,
      html: htmlContent,
      replyTo: templates.replyToEmail,
      attachments: options.attachments,
    });
  }

  /**
   * Send generic email with custom content
   */
  async sendEmail(organizationId: string, options: { to: string; subject: string; html: string; text?: string; from?: string; replyTo?: string; attachments?: any[] }): Promise<string> {
    console.log(`[EmailService] [STAGE: load-config] sendEmail called:`, {
      organizationId,
      to: options.to,
      subject: options.subject,
      hasHtml: !!options.html,
      hasReplyTo: !!options.replyTo,
      hasAttachments: !!(options.attachments && options.attachments.length > 0),
    });

    const config = await this.getEmailConfig(organizationId);
    if (!config) {
      const error = new Error("Email settings not configured. Please configure email settings in the admin panel.");
      console.error('[EmailService] [STAGE: load-config] ❌ No config found for org:', organizationId);
      throw error;
    }

    // Get email templates for Reply-To if not explicitly provided
    const templates = await this.getEmailTemplates(organizationId);
    const replyTo = options.replyTo || templates.replyToEmail;

    console.log('[EmailService] [STAGE: load-config] ✅ Config loaded');

    if (config.provider !== 'gmail' || !config.refreshToken) {
      throw new Error('Gmail is not connected. Please connect your Gmail account in Settings → Email.');
    }
    if (!config.clientId || !config.clientSecret) {
      throw new Error('Gmail OAuth app is not configured. Please contact your platform administrator.');
    }

    // Convert nodemailer attachment format to Gmail API format
    const gmailAttachments = normalizeEmailAttachments(options.attachments);

    return await this.sendOrMarkRevoked(organizationId, config, {
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo,
      attachments: gmailAttachments,
    });
  }

  /**
   * Wraps sendViaGmailAPI: on Google auth failure, marks the org connection as
   * revoked_or_invalid (best-effort), then rethrows a user-facing error.
   * All other errors are re-thrown unchanged.
   */
  private async sendOrMarkRevoked(
    organizationId: string,
    config: EmailConfig,
    options: {
      to: string;
      subject: string;
      html: string;
      text?: string;
      replyTo?: string;
      attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
    },
  ): Promise<string> {
    try {
      return await this.sendViaGmailAPI(config, options);
    } catch (err: any) {
      if ((err as any).isGmailAuthError) {
        console.error(
          `[EmailService] Gmail auth failure for org ${organizationId} — marking revoked_or_invalid. Error: ${err.message}`,
        );
        try {
          await storage.markEmailConnectionStatus(organizationId, 'revoked_or_invalid');
        } catch (dbErr) {
          console.error('[EmailService] Failed to update connection status:', dbErr);
        }
        throw new Error(
          'Gmail authentication failed — the connection has been revoked or expired. ' +
          'Please go to Settings → Email and reconnect your Gmail account.',
        );
      }
      throw err;
    }
  }

  /**
   * Simple HTML escape for email template safety
   */
  private escapeHtml(text: string | null | undefined): string {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Generate HTML email content for a quote
   */
  private generateQuoteEmailHTML(quote: any, customBodyHtml?: string): string {
    const lineItemsHTML = quote.lineItems
      .map((item: any) => {
        const variantInfo = item.variant ? ` - ${this.escapeHtml(item.variant.name)}` : "";
        const description = item.description && typeof item.description === 'string' && item.description.trim()
          ? item.description.trim()
          : null;
        const descriptionHTML = description
          ? `<br><span style="color: #666; font-size: 13px; font-style: italic;">${this.escapeHtml(description)}</span>`
          : "";
        return `
          <tr>
            <td style="padding: 12px; border-bottom: 1px solid #eee;">
              <strong>${this.escapeHtml(item.product?.name) || "Unknown Product"}${variantInfo}</strong><br>
              <span style="color: #666; font-size: 14px;">
                ${item.width}" × ${item.height}" × ${item.quantity} qty
              </span>${descriptionHTML}
            </td>
            <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">
              $${parseFloat(item.linePrice).toFixed(2)}
            </td>
          </tr>
        `;
      })
      .join("");

    const subtotal = parseFloat(quote.subtotal || "0");
    const taxRate = parseFloat(quote.taxRate || "0");
    const marginPercentage = parseFloat(quote.marginPercentage || "0");
    const discountAmount = parseFloat(quote.discountAmount || "0");
    const totalPrice = parseFloat(quote.totalPrice || "0");

    const taxAmount = subtotal * taxRate;
    const marginAmount = subtotal * marginPercentage;

    const quoteDisplayNumber = (quote as any).displayNumber || quote.quoteNumber;

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Quote ${quoteDisplayNumber}</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px;">
        ${customBodyHtml ? `
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          ${customBodyHtml}
        </div>
        ` : ''}
        
        <div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px; margin-bottom: 30px;">
          <h1 style="margin: 0 0 10px 0; color: #2563eb;">Quote ${quoteDisplayNumber}</h1>
          <p style="margin: 0; color: #666;">
            Date: ${new Date(quote.createdAt).toLocaleDateString()}<br>
            ${quote.customerName ? `Customer: ${quote.customerName}` : ""}
          </p>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
          <thead>
            <tr style="background-color: #f8f9fa;">
              <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Item</th>
              <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6;">Price</th>
            </tr>
          </thead>
          <tbody>
            ${lineItemsHTML}
          </tbody>
        </table>

        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
          <table style="width: 100%; max-width: 300px; margin-left: auto;">
            <tr>
              <td style="padding: 8px 0;"><strong>Subtotal:</strong></td>
              <td style="padding: 8px 0; text-align: right;">$${subtotal.toFixed(2)}</td>
            </tr>
            ${marginPercentage > 0 ? `
            <tr>
              <td style="padding: 8px 0;">Margin (${(marginPercentage * 100).toFixed(2)}%):</td>
              <td style="padding: 8px 0; text-align: right;">$${marginAmount.toFixed(2)}</td>
            </tr>
            ` : ""}
            ${taxRate > 0 ? `
            <tr>
              <td style="padding: 8px 0;">Tax (${(taxRate * 100).toFixed(2)}%):</td>
              <td style="padding: 8px 0; text-align: right;">$${taxAmount.toFixed(2)}</td>
            </tr>
            ` : ""}
            ${discountAmount > 0 ? `
            <tr>
              <td style="padding: 8px 0; color: #dc2626;">Discount:</td>
              <td style="padding: 8px 0; text-align: right; color: #dc2626;">-$${discountAmount.toFixed(2)}</td>
            </tr>
            ` : ""}
            <tr style="border-top: 2px solid #dee2e6;">
              <td style="padding: 12px 0 0 0;"><strong style="font-size: 18px;">Total:</strong></td>
              <td style="padding: 12px 0 0 0; text-align: right;"><strong style="font-size: 18px; color: #2563eb;">$${totalPrice.toFixed(2)}</strong></td>
            </tr>
          </table>
        </div>

        <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #dee2e6; color: #666; font-size: 14px;">
          <p>Thank you for your business!</p>
          <p style="margin: 0;">If you have any questions about this quote, please don't hesitate to contact us.</p>
        </div>
      </body>
      </html>
    `;
  }

  private generateOrderEmailHTML(order: any, customBodyHtml?: string): string {
    const lineItemsHTML = (order.lineItems || [])
      .map((item: any) => {
        const variantInfo = item.productVariant?.name ? ` - ${this.escapeHtml(item.productVariant.name)}` : "";
        const description = item.description && typeof item.description === 'string' && item.description.trim()
          ? item.description.trim()
          : null;
        const descriptionHTML = description
          ? `<br><span style="color: #666; font-size: 13px; font-style: italic;">${this.escapeHtml(description)}</span>`
          : "";
        const total = Number.parseFloat(String(item.totalPrice || "0"));
        return `
          <tr>
            <td style="padding: 12px; border-bottom: 1px solid #eee;">
              <strong>${this.escapeHtml(item.product?.name || item.description || "Line item")}${variantInfo}</strong><br>
              <span style="color: #666; font-size: 14px;">
                ${item.width || "—"}" × ${item.height || "—"}" × ${item.quantity || 0} qty
              </span>${descriptionHTML}
            </td>
            <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">
              $${Number.isFinite(total) ? total.toFixed(2) : "0.00"}
            </td>
          </tr>
        `;
      })
      .join("");

    const subtotal = Number.parseFloat(String(order.subtotal || "0"));
    const tax = Number.parseFloat(String(order.taxAmount ?? order.tax ?? "0"));
    const shipping = Number(order.shippingCents || 0) / 100;
    const total = Number.parseFloat(String(order.total || "0"));
    const orderDisplayNumber = order.displayNumber || order.orderNumber;
    const customerName = order.customer?.companyName || order.customer?.name || order.billToName || "Customer";

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Order ${this.escapeHtml(orderDisplayNumber)}</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px;">
        ${customBodyHtml ? `
        <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          ${customBodyHtml}
        </div>
        ` : ''}

        <div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px; margin-bottom: 30px;">
          <h1 style="margin: 0 0 10px 0; color: #2563eb;">Order ${this.escapeHtml(orderDisplayNumber)}</h1>
          <p style="margin: 0; color: #666;">
            Date: ${new Date(order.createdAt).toLocaleDateString()}<br>
            Customer: ${this.escapeHtml(customerName)}
          </p>
        </div>

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
          <thead>
            <tr style="background-color: #f8f9fa;">
              <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Item</th>
              <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${lineItemsHTML}
          </tbody>
        </table>

        <div style="text-align: right; margin-bottom: 30px;">
          <p style="margin: 5px 0;">Subtotal: $${Number.isFinite(subtotal) ? subtotal.toFixed(2) : "0.00"}</p>
          ${shipping > 0 ? `<p style="margin: 5px 0;">Shipping: $${shipping.toFixed(2)}</p>` : ""}
          <p style="margin: 5px 0;">Tax: $${Number.isFinite(tax) ? tax.toFixed(2) : "0.00"}</p>
          <p style="margin: 10px 0; font-size: 18px; font-weight: bold;">Total: $${Number.isFinite(total) ? total.toFixed(2) : "0.00"}</p>
        </div>
      </body>
      </html>
    `;
  }
}

export const emailService = new EmailService();

