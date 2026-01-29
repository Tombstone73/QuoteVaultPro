import { google } from "googleapis";
import { storage } from "./storage";
import type { EmailSettings } from "@shared/schema";

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

/**
 * Build raw RFC 2822 email message for Gmail API
 */
function buildRawMessage(options: {
  from: string;
  to: string;
  subject: string;
  html: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
}): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  const { from, to, subject, html, attachments } = options;

  let message = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
  ];

  if (attachments && attachments.length > 0) {
    // Multipart message with attachments
    message.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    message.push('');
    message.push(`--${boundary}`);
    message.push('Content-Type: text/html; charset=UTF-8');
    message.push('Content-Transfer-Encoding: quoted-printable');
    message.push('');
    message.push(html);
    message.push('');

    // Add each attachment
    for (const attachment of attachments) {
      message.push(`--${boundary}`);
      message.push(`Content-Type: ${attachment.contentType}`);
      message.push('Content-Transfer-Encoding: base64');
      message.push(`Content-Disposition: attachment; filename="${attachment.filename}"`);
      message.push('');
      message.push(attachment.content.toString('base64'));
      message.push('');
    }

    message.push(`--${boundary}--`);
  } else {
    // Simple HTML message
    message.push('Content-Type: text/html; charset=UTF-8');
    message.push('');
    message.push(html);
  }

  // Base64url encode the entire message
  const rawMessage = message.join('\r\n');
  return Buffer.from(rawMessage)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

interface EmailConfig {
  provider: string;
  fromAddress: string;
  fromName: string;
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUsername?: string;
  smtpPassword?: string;
}

class EmailService {
  /**
   * Get email configuration from database
   */
  private async getEmailConfig(organizationId: string): Promise<EmailConfig | null> {
    const settings = await storage.getDefaultEmailSettings(organizationId);
    if (!settings) {
      console.error(`[EmailService] No email settings found for org ${organizationId}`);
      return null;
    }

    console.log(`[EmailService] Loaded config for org ${organizationId}:`, {
      provider: settings.provider,
      fromAddress: settings.fromAddress,
      fromName: settings.fromName,
      hasClientId: !!settings.clientId,
      hasClientSecret: !!settings.clientSecret,
      hasRefreshToken: !!settings.refreshToken,
      hasSmtpHost: !!settings.smtpHost,
      hasSmtpPort: !!settings.smtpPort,
    });

    return {
      provider: settings.provider,
      fromAddress: settings.fromAddress,
      fromName: settings.fromName,
      clientId: settings.clientId || undefined,
      clientSecret: settings.clientSecret || undefined,
      refreshToken: settings.refreshToken || undefined,
      smtpHost: settings.smtpHost || undefined,
      smtpPort: settings.smtpPort || undefined,
      smtpUsername: settings.smtpUsername || undefined,
      smtpPassword: settings.smtpPassword || undefined,
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
    const oauth2Client = new OAuth2(
      config.clientId,
      config.clientSecret,
      "https://developers.google.com/oauthplayground"
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
    attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
  }): Promise<string> {
    const gmail = await this.createGmailClient(config);

    const fromAddress = `"${config.fromName}" <${config.fromAddress}>`;
    const rawMessage = buildRawMessage({
      from: fromAddress,
      to: options.to,
      subject: options.subject,
      html: options.html,
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

    if (config.provider !== 'gmail' || !config.clientId || !config.clientSecret || !config.refreshToken) {
      throw new Error('Gmail OAuth credentials are required. Please configure email settings.');
    }

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Email Configuration Test</h2>
        <p>This is a test email from QuoteVaultPro.</p>
        <p>If you're receiving this, your email configuration is working correctly! ✅</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #666; font-size: 12px;">
          Sent from QuoteVaultPro via Gmail API<br>
          Provider: ${config.provider}
        </p>
      </div>
    `;

    await this.sendViaGmailAPI(config, {
      to: recipientEmail,
      subject: 'Test Email from QuoteVaultPro',
      html,
    });
  }

  /**
   * Send quote email to recipient
   */
  async sendQuoteEmail(organizationId: string, quoteId: string, recipientEmail: string, userId?: string): Promise<void> {
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

    if (config.provider !== 'gmail' || !config.clientId || !config.clientSecret || !config.refreshToken) {
      throw new Error('Gmail OAuth credentials are required. Please configure email settings.');
    }

    // Get quote data
    const quote = await storage.getQuoteById(organizationId, quoteId, userId);
    if (!quote) {
      throw new Error("Quote not found");
    }
    console.log('[EmailService] [STAGE: load-config] ✅ Config and quote data loaded');

    const htmlContent = this.generateQuoteEmailHTML(quote);

    await this.sendViaGmailAPI(config, {
      to: recipientEmail,
      subject: `Quote #${quote.quoteNumber} from ${config.fromName}`,
      html: htmlContent,
    });
  }

  /**
   * Send generic email with custom content
   */
  async sendEmail(organizationId: string, options: { to: string; subject: string; html: string; from?: string; attachments?: any[] }): Promise<string> {
    console.log(`[EmailService] [STAGE: load-config] sendEmail called:`, {
      organizationId,
      to: options.to,
      subject: options.subject,
      hasHtml: !!options.html,
      hasAttachments: !!(options.attachments && options.attachments.length > 0),
    });

    const config = await this.getEmailConfig(organizationId);
    if (!config) {
      const error = new Error("Email settings not configured. Please configure email settings in the admin panel.");
      console.error('[EmailService] [STAGE: load-config] ❌ No config found for org:', organizationId);
      throw error;
    }
    console.log('[EmailService] [STAGE: load-config] ✅ Config loaded');

    if (config.provider !== 'gmail' || !config.clientId || !config.clientSecret || !config.refreshToken) {
      throw new Error('Gmail OAuth credentials are required. Please configure email settings.');
    }

    // Convert nodemailer attachment format to Gmail API format
    let gmailAttachments: Array<{ filename: string; content: Buffer; contentType: string }> | undefined;
    if (options.attachments && options.attachments.length > 0) {
      gmailAttachments = options.attachments.map((att: any) => ({
        filename: att.filename || 'attachment',
        content: Buffer.isBuffer(att.content) ? att.content : Buffer.from(att.content),
        contentType: att.contentType || 'application/octet-stream',
      }));
    }

    return await this.sendViaGmailAPI(config, {
      to: options.to,
      subject: options.subject,
      html: options.html,
      attachments: gmailAttachments,
    });
  }

  /**
   * Generate HTML email content for a quote
   */
  private generateQuoteEmailHTML(quote: any): string {
    const lineItemsHTML = quote.lineItems
      .map((item: any) => {
        const variantInfo = item.variant ? ` - ${item.variant.name}` : "";
        return `
          <tr>
            <td style="padding: 12px; border-bottom: 1px solid #eee;">
              <strong>${item.product?.name || "Unknown Product"}${variantInfo}</strong><br>
              <span style="color: #666; font-size: 14px;">
                ${item.width}" × ${item.height}" × ${item.quantity} qty
              </span>
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

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Quote #${quote.quoteNumber}</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px; margin-bottom: 30px;">
          <h1 style="margin: 0 0 10px 0; color: #2563eb;">Quote #${quote.quoteNumber}</h1>
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
}

export const emailService = new EmailService();

