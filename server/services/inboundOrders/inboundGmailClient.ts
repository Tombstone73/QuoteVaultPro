import { google } from 'googleapis';
import type { InboundEmailMailbox } from '@shared/schema';

/** Shared import/acknowledgement credential construction. Never log this object. */
export function inboundGmailClient(mailbox: InboundEmailMailbox) {
  const credentials = (mailbox.authJson ?? {}) as Record<string, any>;
  const text=(value:unknown)=>typeof value==='string'&&value.trim()?value.trim():null;
  const clientId = text(credentials.clientId) || text(process.env.GOOGLE_CLIENT_ID);
  const clientSecret = text(credentials.clientSecret) || text(process.env.GOOGLE_CLIENT_SECRET);
  const refreshToken=text(credentials.refreshToken);
  if (!refreshToken || !clientId || !clientSecret) throw new Error('Inbound Gmail credentials unavailable');
  const auth = new google.auth.OAuth2({clientId,clientSecret,
    redirectUri:text(credentials.redirectUri) || text(process.env.GOOGLE_REDIRECT_URI) || 'urn:ietf:wg:oauth:2.0:oob',transporterOptions:{timeout:60_000}});
  auth.setCredentials({refresh_token:refreshToken});
  return { auth, gmail:google.gmail({version:'v1',auth,timeout:60_000}) };
}
