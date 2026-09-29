export function newLineCreateKey() {
  return `${Date.now()}:${crypto.randomUUID()}`;
}

type Intent = { key: string; payload: unknown; pending?: Promise<any>; result?: any; complete?: boolean };

/** One slot represents one UI add or one unsaved line, never matching content. */
export class LineCreateIntentStore {
  private intents = new Map<string, Intent>();

  payloadMatches(slot: string, payload: unknown) {
    const intent = this.intents.get(slot);
    return !intent || JSON.stringify(intent.payload) === JSON.stringify(payload);
  }

  async run<T>(slot: string, payload: unknown, send: (payload: any, key: string) => Promise<T>, retainResult = false): Promise<T> {
    let intent = this.intents.get(slot);
    if (!intent) {
      intent = { key: newLineCreateKey(), payload: JSON.parse(JSON.stringify(payload)) };
      this.intents.set(slot, intent);
    }
    if (intent.complete) return intent.result;
    if (intent.pending) return intent.pending;
    const current = intent;
    // Freeze the original request across transport failures, including a response
    // lost after commit. A later render must not mint another creation identity.
    current.pending = Promise.resolve().then(() => send(current.payload, current.key));
    try {
      const result = await current.pending;
      if (retainResult) { current.result = result; current.complete = true; }
      else this.intents.delete(slot);
      return result;
    } catch (error: any) {
      // These responses confirm rejection before insert. Network/5xx/408/409
      // outcomes keep the key and payload for safe reconciliation.
      const status = error?.status ?? Number(/^([0-9]{3}):/.exec(error?.message ?? "")?.[1]);
      if ([400, 401, 403, 404, 422].includes(status)) this.intents.delete(slot);
      throw error;
    } finally {
      current.pending = undefined;
    }
  }
}

/** React state alone cannot guard two events delivered before the next render. */
export class LineCreateSubmitGuard {
  private busy = false;
  async run<T>(operation: () => Promise<T>): Promise<T | null> {
    if (this.busy) return null;
    this.busy = true;
    try { return await operation(); }
    finally { this.busy = false; }
  }
}
