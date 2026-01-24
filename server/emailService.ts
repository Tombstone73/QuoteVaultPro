import nodemailer from "nodemailer";
import { google } from "googleapis";
import { storage } from "./storage";
import type { EmailSettings } from "@shared/schema";
import { isEmailEnabled } from "./workers/workerGates";
import { logger } from "./logger";
import { classifyEmailError, createSafeErrorContext, EMAIL_ERRORS } from "./emailErrors";

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
   * Includes timeout configuration to prevent hanging
   */
  private async createTransporter(config: EmailConfig, requestId?: string) {
    if (config.provider === "gmail" && config.clientId && config.clientSecret && config.refreshToken) {
      // Gmail OAuth2 setup
      logger.info('email_oauth_refresh_start', {
        requestId,
        provider: 'gmail',
        hasClientId: !!config.clientId,
        hasClientSecret: !!config.clientSecret,
        hasRefreshToken: !!config.refreshToken,
      });

      const OAuth2 = google.auth.OAuth2;
      const oauth2Client = new OAuth2(
        config.clientId,
        config.clientSecret,
        "https://developers.google.com/oauthplayground" // Redirect URL
      );

      oauth2Client.setCredentials({
        refresh_token: config.refreshToken,
      });

      // Get access token with timeout
      try {
        const accessTokenPromise = oauth2Client.getAccessToken();
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('OAuth token refresh timed out')), 8000);
        });
        
        const accessToken = await Promise.race([accessTokenPromise, timeoutPromise]);

        logger.info('email_oauth_refresh_success', {
          requestId,
          hasAccessToken: !!accessToken.token,
        });

        return nodemailer.createTransport({
          service: "gmail",
          auth: {
            type: "OAuth2",
            user: config.fromAddress,
            clientId: config.clientId,
            clientSecret: config.clientSecret,
            refreshToken: config.refreshToken,
            accessToken: accessToken.token || undefined,
          },
          // Nodemailer timeout settings
          connectionTimeout: 5000, // 5 seconds to establish connection
          greetingTimeout: 5000,   // 5 seconds to receive greeting
          socketTimeout: 10000,    // 10 seconds for socket inactivity
        });
      } catch (error: any) {
        // Log OAuth refresh failure with safe context
        logger.error('email_oauth_refresh_error', {
          requestId,
          ...createSafeErrorContext(error),
        });
        
        // Re-throw with context preserved
        throw error;
      }
    } else if (config.provider === "smtp" && config.smtpHost && config.smtpPort) {
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

    const transporter = await this.createTransporter(config, requestId);

    const mailOptions = {
      from: `"${config.fromName}" <${config.fromAddress}>`,
      to: recipientEmail,
      subject: "Test Email from QuoteVaultPro",
      html: `
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
      `,
    };

    logger.info('email_send_start', {
      requestId,
      organizationId,
      provider: config.provider,
      fromAddress: config.fromAddress,
      recipientDomain: recipientEmail.split('@')[1],
    });

    try {
      // Send with timeout (transporter already has connection timeouts, but add overall timeout)
      const sendPromise = transporter.sendMail(mailOptions);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Email send operation timed out')), 12000); // 12s for actual send
      });

      const result = await Promise.race([sendPromise, timeoutPromise]);

      logger.info('email_send_success', {
        requestId,
        organizationId,
        messageId: result.messageId,
        response: result.response?.substring(0, 100), // Truncate response
      });
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

    const transporter = await this.createTransporter(config);

    const htmlContent = this.generateQuoteEmailHTML(quote);

    const mailOptions = {
      from: `"${config.fromName}" <${config.fromAddress}>`,
      to: recipientEmail,
      subject: `Quote #${quote.quoteNumber} from ${config.fromName}`,
      html: htmlContent,
    };

    await transporter.sendMail(mailOptions);
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
    const transporter = await this.createTransporter(config);
    const mailOptions = {
      from: options.from || `"${config.fromName}" <${config.fromAddress}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
    };
    await transporter.sendMail(mailOptions);
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

