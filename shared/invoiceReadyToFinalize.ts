/** Invoice workspace's Ready to Finalize preset: completed job/fulfillment
 * and no successful original customer invoice send. */
export const READY_TO_FINALIZE_JOB_STATUSES = ["job_complete", "fulfillment_complete"] as const;
export const READY_TO_FINALIZE_SEND_STATUS = "never_sent" as const;
