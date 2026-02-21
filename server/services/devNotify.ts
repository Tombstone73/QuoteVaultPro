/**
 * Dev Notification Service
 * 
 * Centralized utility for sending notifications to developers about critical system events.
 * Current implementation logs to console and audit trail, but structured to add Postmark/Slack later.
 */

import { db } from "../db";
import { auditLogs } from "@shared/schema";

export type DevNotifyPriority = 'low' | 'medium' | 'high' | 'critical';

export interface DevNotifyPayload {
  eventName: string;
  priority: DevNotifyPriority;
  organizationId?: string;
  userId?: string;
  message: string;
  metadata?: Record<string, any>;
  timestamp?: Date;
}

/**
 * Send notification to dev team.
 * Current: console.log + audit log
 * Future: Email via Postmark, Slack webhook, PagerDuty, etc.
 */
export async function notifyDev(payload: DevNotifyPayload): Promise<void> {
  const timestamp = payload.timestamp || new Date();
  
  // Console logging with priority-based formatting
  const prefix = `[DEV NOTIFY ${payload.priority.toUpperCase()}]`;
  const message = `${prefix} ${payload.eventName}: ${payload.message}`;
  
  if (payload.priority === 'critical') {
    console.error(message, payload.metadata || {});
  } else if (payload.priority === 'high') {
    console.warn(message, payload.metadata || {});
  } else {
    console.log(message, payload.metadata || {});
  }

  // Write to audit log for permanent record
  try {
    await db.insert(auditLogs).values({
      organizationId: payload.organizationId || 'PLATFORM',
      userId: payload.userId || null,
      actionType: `dev.notify.${payload.eventName}`,
      entityType: 'system',
      entityId: null,
      description: payload.message,
      newValues: {
        priority: payload.priority,
        metadata: payload.metadata,
        timestamp: timestamp.toISOString(),
      },
    });
  } catch (error) {
    console.error('[DEV NOTIFY] Failed to write audit log:', error);
  }

  // Future: Add email/Slack/PagerDuty integrations here
  // if (process.env.SLACK_WEBHOOK_URL && payload.priority === 'critical') {
  //   await sendSlackAlert(payload);
  // }
}

/**
 * Convenience wrapper for high-priority notifications
 */
export async function notifyDevHigh(eventName: string, message: string, metadata?: Record<string, any>): Promise<void> {
  await notifyDev({
    eventName,
    priority: 'high',
    message,
    metadata,
  });
}

/**
 * Convenience wrapper for critical notifications
 */
export async function notifyDevCritical(eventName: string, message: string, metadata?: Record<string, any>): Promise<void> {
  await notifyDev({
    eventName,
    priority: 'critical',
    message,
    metadata,
  });
}
