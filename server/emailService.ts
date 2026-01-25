import nodemailer from "nodemailer";
import { google } from "googleapis";
import { storage } from "./storage";
import type { EmailSettings } from "@shared/schema";
import { isEmailEnabled } from "./workers/workerGates";
import { logger } from "./logger";
import { classifyEmailError, createSafeErrorContext, EMAIL_ERRORS } from "./emailErrors";
import { getInvoiceWithRelations } from "./invoicesService";

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
   * Check if email is configured for an organization
   * Returns { configured: boolean, reason?: string }
   */
  async isEmailConfigured(organizationId: string): Promise<{ configured: boolean; reason?: string }> {
    // Check if email feature is globally enabled
    if (!isEmailEnabled()) {
      return {
        configured: false,
        reason: "Email feature is disabled. Check WORKERS_ENABLED and email-related environment variables.",
      };
    }

    // Check if organization has email settings
    const config = await this.getEmailConfig(organizationId);
    if (!config) {
      return {
        configured: false,
        reason: "Email provider not configured for this organization. Configure in Admin Settings → Email.",
      };
    }

    // Check Gmail OAuth completeness
    if (config.provider === "gmail") {
      if (!config.clientId || !config.clientSecret || !config.refreshToken) {
        return {
          configured: false,
          reason: "Gmail OAuth credentials incomplete. Required: Client ID, Client Secret, and Refresh Token.",
        };
      }
    }

    // Check SMTP completeness
    if (config.provider === "smtp") {
      if (!config.smtpHost || !config.smtpPort) {
        return {
          configured: false,
          reason: "SMTP configuration incomplete. Required: Host and Port.",
        };
      }
    }

    return { configured: true };
  }

  /**
   * Get email configuration from database
   */
  private async getEmailConfig(organizationId: string): Promise<EmailConfig | null> {
    const settings = await storage.getDefaultEmailSettings(organizationId);
    if (!settings) {
      return null;
    }

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
   * Create Nodemailer transporter with OAuth2 or SMTP
   * NOTE: For Gmail, we use Gmail API directly (see sendViaGmailAPI)
   * This method is only used for SMTP providers now
   */
  private async createTransporter(config: EmailConfig, requestId?: string) {
    if (config.provider === "smtp" && config.smtpHost && config.smtpPort) {
      // SMTP setup
      logger.info('email_smtp_setup', {
        requestId,
        provider: 'smtp',
        host: config.smtpHost,
        port: config.smtpPort,
        hasAuth: !!(config.smtpUsername && config.smtpPassword),
      });

      return nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpPort === 465, // true for 465, false for other ports
        auth: config.smtpUsername && config.smtpPassword ? {
          user: config.smtpUsername,
          pass: config.smtpPassword,
        } : undefined,
        // Timeout settings for SMTP
        connectionTimeout: 5000,
        greetingTimeout: 5000,
        socketTimeout: 10000,
      });
    } else {
      throw new Error(`Unsupported email provider: ${config.provider} or missing configuration`);
    }
  }

  /**
   * Send email via Gmail API (not SMTP)
   * More reliable on Railway where SMTP connections often timeout
   */
  private async sendViaGmailAPI(
    config: EmailConfig,
    to: string,
    subject: string,
    htmlBody: string,
    requestId?: string
  ): Promise<void> {
    if (!config.clientId || !config.clientSecret || !config.refreshToken) {
      throw new Error('Gmail OAuth credentials missing');
    }

    const redirectUri = process.env.GMAIL_OAUTH_REDIRECT_URI || "https://developers.google.com/oauthplayground";
    
    logger.info('email_gmail_api_start', {
      requestId,
      provider: 'gmail-api',
      redirectUri,
      hasClientId: !!config.clientId,
      hasClientSecret: !!config.clientSecret,
      hasRefreshToken: !!config.refreshToken,
    });

    const OAuth2 = google.auth.OAuth2;
    const oauth2Client = new OAuth2(
      config.clientId,
      config.clientSecret,
      redirectUri
    );

    oauth2Client.setCredentials({
      refresh_token: config.refreshToken,
    });

    // Create Gmail API client
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Build raw RFC822 email message
    const messageParts = [
      `From: "${config.fromName}" <${config.fromAddress}>`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      htmlBody,
    ];
    const rawMessage = messageParts.join('\r\n');

    // Base64url encode (RFC 4648 Section 5)
    const base64UrlEncode = (str: string): string => {
      return Buffer.from(str, 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    };

    const encodedMessage = base64UrlEncode(rawMessage);

    // Send with timeout
    const sendPromise = gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        const timeoutError = new Error('Gmail API send timed out');
        (timeoutError as any).code = 'ETIMEDOUT';
        reject(timeoutError);
      }, 10000); // 10 second timeout
    });

    const result = await Promise.race([sendPromise, timeoutPromise]);

    logger.info('email_gmail_api_success', {
      requestId,
      messageId: result.data.id,
      threadId: result.data.threadId,
    });
  }

  /**
   * Send a test email to verify configuration
   * Includes timeout handling to prevent hanging
   */
  async sendTestEmail(organizationId: string, recipientEmail: string, requestId?: string): Promise<void> {
    // Operational kill switch: disable email during provider outages, bounce storms, or template issues
    if (!isEmailEnabled()) {
      logger.warn('email_disabled', { 
        requestId, 
        organizationId, 
        recipientEmail: this.maskEmail(recipientEmail),
        feature: 'FEATURE_EMAIL_ENABLED' 
      });
      throw new Error('Email sending temporarily disabled');
    }

    logger.info('email_send_prep', {
      requestId,
      organizationId,
      recipientDomain: recipientEmail.split('@')[1], // Only log domain for privacy
    });

    const config = await this.getEmailConfig(organizationId);
    if (!config) {
      logger.warn('email_config_missing', { requestId, organizationId });
      throw new Error("Email settings not configured. Please configure email settings in the admin panel.");
    }

    // Log config presence (booleans only, no secrets)
    logger.info('email_config_loaded', {
      requestId,
      organizationId,
      provider: config.provider,
      hasFromAddress: !!config.fromAddress,
      hasFromName: !!config.fromName,
      hasClientId: !!config.clientId,
      hasClientSecret: !!config.clientSecret,
      hasRefreshToken: !!config.refreshToken,
      hasSmtpHost: !!config.smtpHost,
      hasSmtpPort: !!config.smtpPort,
    });

    const subject = "Test Email from QuoteVaultPro";
    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333;">Email Configuration Test</h2>
        <p>This is a test email from QuoteVaultPro.</p>
        <p>If you're receiving this, your email configuration is working correctly! ✅</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
        <p style="color: #666; font-size: 12px;">
          Sent from QuoteVaultPro<br>
          Provider: ${config.provider}
        </p>
      </div>
    `;

    logger.info('email_send_start', {
      requestId,
      organizationId,
      provider: config.provider,
      fromAddress: config.fromAddress,
      recipientDomain: recipientEmail.split('@')[1],
    });

    try {
      // Use Gmail API for Gmail provider (more reliable on Railway)
      if (config.provider === 'gmail') {
        await this.sendViaGmailAPI(config, recipientEmail, subject, htmlBody, requestId);
        
        logger.info('email_send_success', {
          requestId,
          organizationId,
          provider: 'gmail-api',
        });
      } else {
        // Use SMTP for other providers
        const transporter = await this.createTransporter(config, requestId);
        
        const mailOptions = {
          from: `"${config.fromName}" <${config.fromAddress}>`,
          to: recipientEmail,
          subject: subject,
          html: htmlBody,
        };

        const sendPromise = transporter.sendMail(mailOptions);
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Email send operation timed out')), 12000);
        });

        const result = await Promise.race([sendPromise, timeoutPromise]);

        logger.info('email_send_success', {
          requestId,
          organizationId,
          messageId: result.messageId,
          response: result.response?.substring(0, 100),
        });
      }
    } catch (error: any) {
      logger.error('email_send_error', {
        requestId,
        organizationId,
        provider: config.provider,
        ...createSafeErrorContext(error),
      });
      throw error;
    }
  }

  /**
   * Mask email address for privacy in logs
   */
  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (local.length <= 2) return `${local[0]}***@${domain}`;
    return `${local.substring(0, 2)}***@${domain}`;
  }

  /**
   * Send quote email to recipient
   */
  async sendQuoteEmail(organizationId: string, quoteId: string, recipientEmail: string, userId?: string): Promise<void> {
    // Operational kill switch: disable email during provider outages, bounce storms, or template issues
    if (!isEmailEnabled()) {
      logger.warn('Email disabled - sendQuoteEmail aborted', { organizationId, quoteId, recipientEmail, feature: 'FEATURE_EMAIL_ENABLED' });
      throw new Error('Email sending temporarily disabled');
    }
    const config = await this.getEmailConfig(organizationId);
    if (!config) {
      throw new Error("Email settings not configured. Please configure email settings in the admin panel.");
    }

    // Get quote data
    const quote = await storage.getQuoteById(organizationId, quoteId, userId);
    if (!quote) {
      throw new Error("Quote not found");
    }

    const subject = `Quote #${quote.quoteNumber} from ${config.fromName}`;
    const htmlContent = this.generateQuoteEmailHTML(quote);

    // Use Gmail API for Gmail provider
    if (config.provider === 'gmail') {
      await this.sendViaGmailAPI(config, recipientEmail, subject, htmlContent);
    } else {
      const transporter = await this.createTransporter(config);
      const mailOptions = {
        from: `"${config.fromName}" <${config.fromAddress}>`,
        to: recipientEmail,
        subject: subject,
        html: htmlContent,
      };
      await transporter.sendMail(mailOptions);
    }
  }

  /**
   * Send generic email with custom content
   */
  async sendEmail(organizationId: string, options: { to: string; subject: string; html: string; from?: string }): Promise<void> {
    // Operational kill switch: disable email during provider outages, bounce storms, or template issues
    if (!isEmailEnabled()) {
      logger.warn('Email disabled - sendEmail aborted', { organizationId, to: options.to, subject: options.subject, feature: 'FEATURE_EMAIL_ENABLED' });
      throw new Error('Email sending temporarily disabled');
    }

    const config = await this.getEmailConfig(organizationId);
    if (!config) {
      throw new Error("Email settings not configured. Please configure email settings in the admin panel.");
    }

    // Use Gmail API for Gmail provider
    if (config.provider === 'gmail') {
      await this.sendViaGmailAPI(config, options.to, options.subject, options.html);
    } else {
      const transporter = await this.createTransporter(config);
      const mailOptions = {
        from: options.from || `"${config.fromName}" <${config.fromAddress}>`,
        to: options.to,
        subject: options.subject,
        html: options.html,
      };
      await transporter.sendMail(mailOptions);
    }
  }

  /**
   * Send invoice email to recipient
   * TODO: Add PDF attachment when invoice PDF generation is implemented
   */
  async sendInvoiceEmail(organizationId: string, invoiceId: string, recipientEmail: string): Promise<void> {
    // Operational kill switch
    if (!isEmailEnabled()) {
      logger.warn('Email disabled - sendInvoiceEmail aborted', { organizationId, invoiceId, recipientEmail, feature: 'FEATURE_EMAIL_ENABLED' });
      throw new Error('Email sending temporarily disabled');
    }

    const config = await this.getEmailConfig(organizationId);
    if (!config) {
      throw new Error("Email settings not configured. Please configure email settings in the admin panel.");
    }

    // Get invoice data with relations
    const rel = await getInvoiceWithRelations(invoiceId);
    if (!rel || rel.invoice.organizationId !== organizationId) {
      throw new Error("Invoice not found");
    }

    const invoice = rel.invoice;

    const subject = `Invoice #${invoice.invoiceNumber} from ${config.fromName}`;
    const htmlContent = this.generateInvoiceEmailHTML(invoice);

    // Use Gmail API for Gmail provider
    if (config.provider === 'gmail') {
      await this.sendViaGmailAPI(config, recipientEmail, subject, htmlContent);
    } else {
      const transporter = await this.createTransporter(config);
      const mailOptions = {
        from: `"${config.fromName}" <${config.fromAddress}>`,
        to: recipientEmail,
        subject: subject,
        html: htmlContent,
      };
      await transporter.sendMail(mailOptions);
    }
  }

  /**
   * Generate HTML email content for an invoice
   * TODO: Include link to customer portal when portal URLs are finalized
   * TODO: Add payment instructions/link when payment processing is implemented
   */
  private generateInvoiceEmailHTML(invoice: any): string {
    const lineItemsHTML = invoice.lineItems
      ?.map((item: any) => {
        return `
          <tr>
            <td style="padding: 12px; border-bottom: 1px solid #eee;">
              <strong>${item.description || item.product?.name || "Item"}</strong>
              ${item.quantity ? `<br><span style="color: #666; font-size: 14px;">Quantity: ${item.quantity}</span>` : ""}
            </td>
            <td style="padding: 12px; border-bottom: 1px solid #eee; text-align: right;">
              $${parseFloat(item.amount || item.linePrice || "0").toFixed(2)}
            </td>
          </tr>
        `;
      })
      .join("") || `<tr><td colspan="2" style="padding: 12px;">No items</td></tr>`;

    const subtotal = parseFloat(invoice.subtotal || "0");
    const tax = parseFloat(invoice.tax || "0");
    const total = parseFloat(invoice.total || invoice.totalAmount || "0");
    const dueDate = invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : "Upon receipt";
    const status = invoice.status || "pending";
    const publicAppUrl = process.env.PUBLIC_APP_URL || "";

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Invoice #${invoice.invoiceNumber}</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; padding: 20px;">
        <div style="background-color: #f8f9fa; padding: 30px; border-radius: 8px; margin-bottom: 30px;">
          <h1 style="margin: 0 0 10px 0; color: #2563eb;">Invoice #${invoice.invoiceNumber}</h1>
          <p style="margin: 0; color: #666;">
            Date: ${new Date(invoice.createdAt || invoice.issueDate).toLocaleDateString()}<br>
            Due Date: ${dueDate}<br>
            ${invoice.customerName ? `Customer: ${invoice.customerName}` : ""}
          </p>
        </div>

        ${status === 'pending' || status === 'overdue' ? `
        <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin-bottom: 30px;">
          <p style="margin: 0; color: #856404;">
            <strong>Payment Due:</strong> This invoice is ${status === 'overdue' ? 'overdue' : 'pending payment'}.
            ${status === 'overdue' ? ' Please submit payment as soon as possible.' : ''}
          </p>
        </div>
        ` : ''}

        <table style="width: 100%; border-collapse: collapse; margin-bottom: 30px;">
          <thead>
            <tr style="background-color: #f8f9fa;">
              <th style="padding: 12px; text-align: left; border-bottom: 2px solid #dee2e6;">Item</th>
              <th style="padding: 12px; text-align: right; border-bottom: 2px solid #dee2e6;">Amount</th>
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
            ${tax > 0 ? `
            <tr>
              <td style="padding: 8px 0;">Tax:</td>
              <td style="padding: 8px 0; text-align: right;">$${tax.toFixed(2)}</td>
            </tr>
            ` : ""}
            <tr style="border-top: 2px solid #dee2e6;">
              <td style="padding: 12px 0 0 0;"><strong style="font-size: 18px;">Total Due:</strong></td>
              <td style="padding: 12px 0 0 0; text-align: right;"><strong style="font-size: 18px; color: #2563eb;">$${total.toFixed(2)}</strong></td>
            </tr>
          </table>
        </div>

        ${publicAppUrl ? `
        <div style="margin-top: 30px; text-align: center;">
          <a href="${publicAppUrl}/portal/invoices/${invoice.id}" 
             style="display: inline-block; background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
            View Invoice Online
          </a>
        </div>
        ` : ''}

        <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #dee2e6; color: #666; font-size: 14px;">
          <p>Thank you for your business!</p>
          <p style="margin: 0;">If you have any questions about this invoice, please don't hesitate to contact us.</p>
        </div>
      </body>
      </html>
    `;
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

