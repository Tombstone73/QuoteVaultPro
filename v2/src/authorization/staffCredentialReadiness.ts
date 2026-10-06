/** bcryptjs-compatible credential encoding, including canonical base64 padding bits.
 * This establishes login capability, not knowledge of the password by a person. */
export const isUsableStaffPasswordHash = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.length === 60 && /^\$2[aby]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{21}[.Oeu][./A-Za-z0-9]{30}[.CGKOSWaeimquy26](?![\s\S])/.test(value);

/** The login route trims its input but the identity lookup does not trim storage.
 * Do not count padded identities or introduce a new email-format policy. */
export const isUsableStaffLoginEmail = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 320 && value === value.trim();
