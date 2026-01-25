/**
 * Email Error Taxonomy
 * 
 * Structured error classification for email operations.
 * Provides consistent error codes, categories, HTTP status, and user-friendly messages.
 */

export type EmailErrorCategory = 'CONFIG' | 'OAUTH' | 'SMTP' | 'NETWORK' | 'TIMEOUT' | 'UNKNOWN';

export interface EmailErrorSpec {
  code: string;
  category: EmailErrorCategory;
  httpStatus: number;
  userMessage: string;
}

export const EMAIL_ERRORS = {
  // Configuration errors
  CONFIG_MISSING: {
    code: 'EMAIL_CONFIG_MISSING',
    category: 'CONFIG' as EmailErrorCategory,
    httpStatus: 400,
    userMessage: 'Email provider not configured. Please configure Gmail OAuth settings in Settings > Email Provider.',
  },
  CONFIG_INCOMPLETE: {
    code: 'EMAIL_CONFIG_INCOMPLETE',
    category: 'CONFIG' as EmailErrorCategory,
    httpStatus: 400,
    userMessage: 'Email configuration is incomplete. Please ensure all required fields are filled.',
  },
  CONFIG_DISABLED: {
    code: 'EMAIL_CONFIG_DISABLED',
    category: 'CONFIG' as EmailErrorCategory,
    httpStatus: 503,
    userMessage: 'Email sending is temporarily disabled. Please try again later.',
  },

  // OAuth errors
  GMAIL_INVALID_GRANT: {
    code: 'GMAIL_INVALID_GRANT',
    category: 'OAUTH' as EmailErrorCategory,
    httpStatus: 401,
    userMessage: 'Gmail OAuth token has expired or been revoked. Please re-generate your refresh token in Google OAuth Playground.',
  },
  GMAIL_UNAUTHORIZED_CLIENT: {
    code: 'GMAIL_UNAUTHORIZED_CLIENT',
    category: 'OAUTH' as EmailErrorCategory,
    httpStatus: 401,
    userMessage: 'Gmail OAuth client is not authorized. Verify your Client ID and Client Secret are correct.',
  },
  GMAIL_INVALID_CLIENT: {
    code: 'GMAIL_INVALID_CLIENT',
    category: 'OAUTH' as EmailErrorCategory,
    httpStatus: 401,
    userMessage: 'Gmail OAuth Client ID or Client Secret is invalid. Please check your Google Cloud Console credentials.',
  },
  GMAIL_ACCESS_DENIED: {
    code: 'GMAIL_ACCESS_DENIED',
    category: 'OAUTH' as EmailErrorCategory,
    httpStatus: 403,
    userMessage: 'Access denied by Gmail. Check that your OAuth consent screen is configured correctly.',
  },
  GMAIL_INSUFFICIENT_SCOPE: {
    code: 'GMAIL_INSUFFICIENT_SCOPE',
    category: 'OAUTH' as EmailErrorCategory,
    httpStatus: 403,
    userMessage: 'Gmail OAuth refresh token lacks required scopes. Ensure https://mail.google.com/ scope is selected when generating the token.',
  },
  OAUTH_REFRESH_TIMEOUT: {
    code: 'OAUTH_REFRESH_TIMEOUT',
    category: 'TIMEOUT' as EmailErrorCategory,
    httpStatus: 504,
    userMessage: 'OAuth token refresh timed out. Please check your internet connection and try again.',
  },

  // SMTP/Gmail API errors
  SMTP_AUTH_FAILED: {
    code: 'SMTP_AUTH_FAILED',
    category: 'SMTP' as EmailErrorCategory,
    httpStatus: 401,
    userMessage: 'Gmail authentication failed. Verify your OAuth credentials and refresh token.',
  },
  SMTP_RECIPIENT_REJECTED: {
    code: 'SMTP_RECIPIENT_REJECTED',
    category: 'SMTP' as EmailErrorCategory,
    httpStatus: 400,
    userMessage: 'Recipient email address was rejected by Gmail. Check that the address is valid.',
  },
  SMTP_SENDER_REJECTED: {
    code: 'SMTP_SENDER_REJECTED',
    category: 'SMTP' as EmailErrorCategory,
    httpStatus: 400,
    userMessage: 'Sender email address was rejected. Ensure the "From" address matches your Gmail account.',
  },
  SMTP_MESSAGE_REJECTED: {
    code: 'SMTP_MESSAGE_REJECTED',
    category: 'SMTP' as EmailErrorCategory,
    httpStatus: 400,
    userMessage: 'Email message was rejected by Gmail. Check content and attachments.',
  },
  GMAIL_RATE_LIMIT: {
    code: 'GMAIL_RATE_LIMIT',
    category: 'SMTP' as EmailErrorCategory,
    httpStatus: 429,
    userMessage: 'Gmail rate limit exceeded. Please wait a few minutes and try again.',
  },

  // Network errors
  DNS_LOOKUP_FAILED: {
    code: 'DNS_LOOKUP_FAILED',
    category: 'NETWORK' as EmailErrorCategory,
    httpStatus: 504,
    userMessage: 'Unable to resolve Gmail servers. Check your DNS settings and internet connection.',
  },
  CONNECTION_REFUSED: {
    code: 'CONNECTION_REFUSED',
    category: 'NETWORK' as EmailErrorCategory,
    httpStatus: 504,
    userMessage: 'Connection to Gmail was refused. Check firewall settings and network connectivity.',
  },
  CONNECTION_RESET: {
    code: 'CONNECTION_RESET',
    category: 'NETWORK' as EmailErrorCategory,
    httpStatus: 504,
    userMessage: 'Connection to Gmail was reset. This may be a temporary network issue, please try again.',
  },

  // Timeout errors
  CONNECT_TIMEOUT: {
    code: 'CONNECT_TIMEOUT',
    category: 'TIMEOUT' as EmailErrorCategory,
    httpStatus: 504,
    userMessage: 'Connection to Gmail timed out. Check your internet connection and try again.',
  },
  SEND_TIMEOUT: {
    code: 'SEND_TIMEOUT',
    category: 'TIMEOUT' as EmailErrorCategory,
    httpStatus: 504,
    userMessage: 'Email send operation timed out. Gmail may be experiencing issues, please try again.',
  },
  OPERATION_TIMEOUT: {
    code: 'OPERATION_TIMEOUT',
    category: 'TIMEOUT' as EmailErrorCategory,
    httpStatus: 504,
    userMessage: 'Email test operation timed out after 15 seconds. Check your network and Gmail configuration.',
  },

  // Unknown/unexpected
  UNKNOWN_ERROR: {
    code: 'EMAIL_UNKNOWN_ERROR',
    category: 'UNKNOWN' as EmailErrorCategory,
    httpStatus: 500,
    userMessage: 'An unexpected error occurred while sending email. Please check server logs for details.',
  },
} as const;

/**
 * Classify an error from Gmail/OAuth/Nodemailer into our taxonomy
 */
export function classifyEmailError(error: any): EmailErrorSpec {
  const errorMessage = error.message?.toLowerCase() || '';
  const errorName = error.name || '';
  
  // Safely normalize error.code (can be string, number, or undefined)
  let errorCode = '';
  if (typeof error.code === 'string') {
    errorCode = error.code.toUpperCase();
  } else if (typeof error.code === 'number') {
    errorCode = String(error.code);
  }
  
  // Check for Google/Gaxios API errors with nested structure
  const googleError = error.response?.data?.error;
  const googleErrorCode = typeof googleError === 'string' ? googleError.toLowerCase() : '';
  const httpStatus = error.response?.status || error.status;

  // OAuth errors (from Google OAuth2 client or API response)
  if (errorMessage.includes('invalid_grant') || errorCode.includes('INVALID_GRANT') || googleErrorCode === 'invalid_grant') {
    return EMAIL_ERRORS.GMAIL_INVALID_GRANT;
  }
  if (errorMessage.includes('unauthorized_client') || errorCode.includes('UNAUTHORIZED_CLIENT') || googleErrorCode === 'unauthorized_client') {
    return EMAIL_ERRORS.GMAIL_UNAUTHORIZED_CLIENT;
  }
  if (errorMessage.includes('invalid_client') || errorCode.includes('INVALID_CLIENT') || googleErrorCode === 'invalid_client') {
    return EMAIL_ERRORS.GMAIL_INVALID_CLIENT;
  }
  if (errorMessage.includes('access_denied') || errorCode.includes('ACCESS_DENIED') || googleErrorCode === 'access_denied') {
    return EMAIL_ERRORS.GMAIL_ACCESS_DENIED;
  }
  if (errorMessage.includes('insufficient') && errorMessage.includes('scope')) {
    return EMAIL_ERRORS.GMAIL_INSUFFICIENT_SCOPE;
  }
  if (errorMessage.includes('oauth token refresh timed out')) {
    return EMAIL_ERRORS.OAUTH_REFRESH_TIMEOUT;
  }

  // SMTP/Nodemailer errors
  if (errorCode === 'EAUTH' || errorMessage.includes('authentication failed') || errorMessage.includes('invalid login')) {
    return EMAIL_ERRORS.SMTP_AUTH_FAILED;
  }
  if (errorCode === 'EENVELOPE' || errorMessage.includes('recipient rejected')) {
    return EMAIL_ERRORS.SMTP_RECIPIENT_REJECTED;
  }
  if (errorMessage.includes('sender rejected') || errorMessage.includes('from address')) {
    return EMAIL_ERRORS.SMTP_SENDER_REJECTED;
  }
  if (errorMessage.includes('message rejected') || errorCode === 'EMESSAGE') {
    return EMAIL_ERRORS.SMTP_MESSAGE_REJECTED;
  }
  if (errorMessage.includes('rate limit') || errorMessage.includes('quota exceeded')) {
    return EMAIL_ERRORS.GMAIL_RATE_LIMIT;
  }

  // Network errors
  if (errorCode === 'ENOTFOUND' || errorMessage.includes('getaddrinfo')) {
    return EMAIL_ERRORS.DNS_LOOKUP_FAILED;
  }
  if (errorCode === 'ECONNREFUSED') {
    return EMAIL_ERRORS.CONNECTION_REFUSED;
  }
  if (errorCode === 'ECONNRESET') {
    return EMAIL_ERRORS.CONNECTION_RESET;
  }

  // Timeout errors
  if (errorCode === 'ETIMEDOUT' || errorMessage.includes('connection timeout')) {
    return EMAIL_ERRORS.CONNECT_TIMEOUT;
  }
  if (errorMessage.includes('email send operation timed out')) {
    return EMAIL_ERRORS.SEND_TIMEOUT;
  }
  if (errorMessage.includes('email_timeout') || errorName === 'AbortError') {
    return EMAIL_ERRORS.OPERATION_TIMEOUT;
  }

  // Config errors
  if (errorMessage.includes('email settings not configured')) {
    return EMAIL_ERRORS.CONFIG_MISSING;
  }
  if (errorMessage.includes('temporarily disabled')) {
    return EMAIL_ERRORS.CONFIG_DISABLED;
  }
  if (errorMessage.includes('unsupported email provider') || errorMessage.includes('missing configuration')) {
    return EMAIL_ERRORS.CONFIG_INCOMPLETE;
  }

  // Default to unknown
  return EMAIL_ERRORS.UNKNOWN_ERROR;
}

/**
 * Create safe log context from error (no secrets)
 */
export function createSafeErrorContext(error: any): Record<string, any> {
  return {
    errorName: error.name,
    errorCode: error.code,
    errorMessage: error.message?.substring(0, 200), // Truncate long messages
    errorType: error.constructor?.name,
    // Extract SMTP response code if present
    ...(error.responseCode && { smtpResponseCode: error.responseCode }),
    // Extract HTTP status if present
    ...(error.status && { httpStatus: error.status }),
  };
}
