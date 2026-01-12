export type TimelineEntityType = "order" | "line_item" | "file" | (string & {});

export type StructuredTimelineEvent = {
  eventType:
    | "order.field_changed"
    | "line_item.field_changed"
    | "file.attached"
    | "file.removed"
    | "file.relinked"
    | (string & {});
  entityType: TimelineEntityType;
  entityId: string;
  displayLabel: string;
  fieldKey?: string;
  fromValue?: string | number | boolean | Record<string, any> | null;
  toValue?: string | number | boolean | Record<string, any> | null;
  actorUserId?: string | null;
  createdAt: string;
  metadata?: Record<string, any>;
};
