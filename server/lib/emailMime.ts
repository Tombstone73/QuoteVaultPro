export type EmailAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
};

export function normalizeEmailAttachments(attachments: any[] | undefined): EmailAttachment[] | undefined {
  if (!attachments?.length) return undefined;
  return attachments.map((att: any) => ({
    filename: att.filename || "attachment",
    content: Buffer.isBuffer(att.content)
      ? att.content
      : att.encoding === "base64" && typeof att.content === "string"
        ? Buffer.from(att.content, "base64")
        : Buffer.from(att.content),
    contentType: att.contentType || "application/octet-stream",
  }));
}

function encodeMimeBase64(value: string | Buffer): string {
  const encoded = (Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8")).toString("base64");
  return encoded.match(/.{1,76}/g)?.join("\r\n") || "";
}

/** Builds a correctly encoded Gmail raw RFC 2822 message. */
export function buildRawMessage(options: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  attachments?: EmailAttachment[];
}): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  const alternativeBoundary = `----=_Alt_${Date.now()}_${Math.random().toString(36).substring(2)}`;
  const { from, to, subject, html, text, replyTo, attachments } = options;
  const message = [`From: ${from}`, `To: ${to}`, `Subject: ${subject}`];
  if (replyTo) message.push(`Reply-To: ${replyTo}`);
  message.push("MIME-Version: 1.0");

  const appendAlternative = (target: string[]) => {
    if (text) {
      target.push(`Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`, "", `--${alternativeBoundary}`);
      target.push("Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", encodeMimeBase64(text), "", `--${alternativeBoundary}`);
    }
    target.push("Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", encodeMimeBase64(html), "");
    if (text) target.push(`--${alternativeBoundary}--`);
  };

  if (attachments?.length) {
    message.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, "", `--${boundary}`);
    appendAlternative(message);
    for (const attachment of attachments) {
      message.push(`--${boundary}`, `Content-Type: ${attachment.contentType}`, "Content-Transfer-Encoding: base64", `Content-Disposition: attachment; filename="${attachment.filename}"`, "", encodeMimeBase64(attachment.content), "");
    }
    message.push(`--${boundary}--`);
  } else if (text) {
    message.push(`Content-Type: multipart/alternative; boundary="${alternativeBoundary}"`, "");
    appendAlternative(message);
  } else {
    message.push("Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", encodeMimeBase64(html));
  }

  return Buffer.from(message.join("\r\n")).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
