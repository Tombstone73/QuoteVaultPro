import "dotenv/config";
import { mergeDuplicateCustomers } from "../server/services/customerCanonicalIdentityService";
import { createCustomerContactLinkForOrganization } from "../server/storage";

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const inline = process.argv.find((value) => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length).trim() || null;
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? (process.argv[index + 1]?.trim() || null) : null;
}

async function main() {
  const organizationId = arg("organization-id");
  const survivorCustomerId = arg("survivor-customer-id");
  const duplicateCustomerId = arg("duplicate-customer-id");
  const contactId = arg("contact-id");
  const actorUserId = arg("actor-user-id");
  const reason = arg("reason") ?? "Reviewed customer duplicate repair";

  if (!organizationId || !survivorCustomerId || !duplicateCustomerId) {
    throw new Error("Usage: tsx scripts/repair-customer-duplicate.ts --organization-id <id> --survivor-customer-id <id> --duplicate-customer-id <id> [--contact-id <id>] [--actor-user-id <id>] [--reason <text>]");
  }

  const merge = await mergeDuplicateCustomers({
    organizationId,
    survivorCustomerId,
    duplicateCustomerId,
    actorUserId,
    reviewed: true,
    reason,
  });

  let linkedContact = null;
  if (contactId) {
    linkedContact = await createCustomerContactLinkForOrganization(organizationId, survivorCustomerId, contactId, {
      isPrimary: false,
    });
  }

  console.log(JSON.stringify({
    success: true,
    merge,
    linkedContactId: linkedContact?.id ?? null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
