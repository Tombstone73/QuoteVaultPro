import { aiTriageBriefService } from "./aiTriageBriefService";

interface QueueItem {
  orgId: string;
  briefId: string;
}

class AiTriageBriefQueue {
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
          await aiTriageBriefService.processBrief(item);
        } catch (error) {
          console.error("[AiTriageBriefQueue] Brief processing failed:", {
            orgId: item.orgId,
            briefId: item.briefId,
            error,
          });
        }
      }
    } finally {
      this.running = false;
    }
  }
}

export const aiTriageBriefQueue = new AiTriageBriefQueue();
