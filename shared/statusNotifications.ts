import { z } from "zod";

export const statusNotificationKinds = ["customer_email", "customer_portal", "staff_email"] as const;
export type StatusNotificationKind = typeof statusNotificationKinds[number];

const rule = <T extends string>(templates: [T, ...T[]]) => z.object({
  enabled: z.boolean().default(false),
  delaySeconds: z.number().int().min(0).max(604800).default(60),
  template: z.enum(templates),
}).strict();

const customerRule = rule(["order_update", "order_activity"]);
const staffRule = rule(["staff_status", "staff_review"]).extend({
  recipients: z.enum(["administrators", "order_creator"]).default("administrators"),
});

export const statusNotificationRulesSchema = z.object({
  customer_email: customerRule.default({ template: "order_update" }),
  customer_portal: customerRule.default({ template: "order_update" }),
  staff_email: staffRule.default({ template: "staff_status" }),
}).strict();
export type StatusNotificationRules = z.output<typeof statusNotificationRulesSchema>;

export const statusNotificationLabels = {
  customer_email: "Customer email",
  customer_portal: "Customer portal",
  staff_email: "Internal staff email",
} satisfies Record<StatusNotificationKind, string>;

export const statusNotificationTemplateLabels = {
  order_update: "Order update",
  order_activity: "Order activity",
  staff_status: "Status changed",
  staff_review: "Review order status",
};

export function renderStatusNotification(
  template: keyof typeof statusNotificationTemplateLabels,
  orderNumber: string,
  statusLabel: string,
) {
  const order = `Order #${orderNumber.replace(/[\r\n]/g, " ")}`;
  switch (template) {
    case "order_update":
      return { subject: `${order} update`, body: `The status of your order has changed.` };
    case "order_activity":
      return { subject: `New activity on ${order}`, body: `There is a new status update on your order.` };
    case "staff_status":
      return { subject: `${order} status changed`, body: `${order} entered ${statusLabel}.` };
    case "staff_review":
      return { subject: `Review ${order}`, body: `${order} entered ${statusLabel}. Review the order for any follow-up.` };
  }
}
