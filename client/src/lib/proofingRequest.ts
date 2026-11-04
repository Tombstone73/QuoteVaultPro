/** A timeout is an unknown server outcome, never proof that a write failed. */
export async function boundedProofingRequest<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs = 120_000): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Proofing request timed out. Refresh the proof history before retrying; the server may still finish this request. Your selected file and notes are retained."));
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
