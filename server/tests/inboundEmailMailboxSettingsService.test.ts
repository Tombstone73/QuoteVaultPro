import { describe, expect, test } from "@jest/globals";

import { planInboundGmailMailboxConnection } from "../services/inboundEmailMailboxSettingsService";

const authJson = {
  refreshToken: "secret_refresh_token",
  connectedEmail: "orders@example.com",
  connectedAt: "2026-06-17T12:00:00.000Z",
};

const now = new Date("2026-06-17T12:00:00.000Z");

function mailbox(overrides: Record<string, any>) {
  return {
    id: "mailbox_1",
    emailAddress: "orders@example.com",
    enabled: true,
    isDefault: true,
    name: "Orders Inbox",
    ...overrides,
  };
}

describe("inbound Gmail mailbox connection planning", () => {
  test("marks the first connected inbound mailbox enabled and default", () => {
    const plan = planInboundGmailMailboxConnection({
      currentMailboxes: [],
      emailAddress: "Orders@Example.com",
      authJson,
      actorUserId: "user_1",
      now,
    });

    expect(plan).toEqual({
      action: "insert",
      values: {
        provider: "gmail",
        name: "Gmail Inbound: orders@example.com",
        emailAddress: "orders@example.com",
        enabled: true,
        isDefault: true,
        authJson,
        settingsJson: {},
        createdByUserId: "user_1",
      },
    });
  });

  test("does not create a second default when another default exists", () => {
    const plan = planInboundGmailMailboxConnection({
      currentMailboxes: [mailbox({ id: "mailbox_default", emailAddress: "default@example.com", isDefault: true })],
      emailAddress: "new@example.com",
      authJson,
      now,
    });

    expect(plan.action).toBe("insert");
    if (plan.action === "insert") {
      expect(plan.values.enabled).toBe(true);
      expect(plan.values.isDefault).toBe(false);
    }
  });

  test("reconnects an existing mailbox without changing disabled/default state", () => {
    const plan = planInboundGmailMailboxConnection({
      currentMailboxes: [mailbox({ enabled: false, isDefault: false })],
      reconnectMailboxId: "mailbox_1",
      emailAddress: "reconnected@example.com",
      authJson,
      now,
    });

    expect(plan).toMatchObject({
      action: "update",
      mailboxId: "mailbox_1",
      values: {
        provider: "gmail",
        name: "Orders Inbox",
        emailAddress: "reconnected@example.com",
        authJson,
        updatedAt: now,
      },
    });
    expect(JSON.stringify(plan)).not.toContain("enabled");
    expect(JSON.stringify(plan)).not.toContain("isDefault");
  });

  test("updates an existing disabled mailbox by email without enabling it", () => {
    const plan = planInboundGmailMailboxConnection({
      currentMailboxes: [mailbox({ enabled: false, isDefault: true })],
      emailAddress: "orders@example.com",
      authJson,
      now,
    });

    expect(plan).toMatchObject({
      action: "update",
      mailboxId: "mailbox_1",
      values: {
        provider: "gmail",
        authJson,
        updatedAt: now,
      },
    });
    expect(JSON.stringify(plan)).not.toContain("enabled");
  });

  test("blocks reconnecting to an email already used by another inbound mailbox", () => {
    expect(() => planInboundGmailMailboxConnection({
      currentMailboxes: [
        mailbox({ id: "mailbox_1", emailAddress: "orders@example.com" }),
        mailbox({ id: "mailbox_2", emailAddress: "other@example.com" }),
      ],
      reconnectMailboxId: "mailbox_1",
      emailAddress: "other@example.com",
      authJson,
      now,
    })).toThrow("Another inbound mailbox is already connected for that Gmail address");
  });
});
