import { aiReviewService } from "./aiReviewService";

interface QueueItem {
  orgId: string;
  reviewId: string;
}

class AiReviewQueue {
  private queue: QueueItem[] = [];
  private running = false;

  enqueue(item: QueueItem): void {
    this.queue.push(item);
    setTimeout(() => {
      void this.drain();
    }, 0);
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift();
        if (!item) continue;
        try {
          await aiReviewService.processReview(item);
        } catch (error) {
          console.error("[AiReviewQueue] Review processing failed:", {
            orgId: item.orgId,
            reviewId: item.reviewId,
            error,
          });
        }
      }
    } finally {
      this.running = false;
    }
  }
}

export const aiReviewQueue = new AiReviewQueue();
