export class RetryCancelled extends Error {
  constructor() {
    super("retry cancelled");
    this.name = "RetryCancelled";
  }
}

export interface BackoffOptions {
  // Wait before retry n+1; once exhausted the last error is thrown.
  delaysMs: readonly number[];
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (failures: number, error: unknown) => void;
  isCancelled?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function withBackoff<T>(run: () => Promise<T>, options: BackoffOptions): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  for (let failures = 0; ; failures += 1) {
    if (options.isCancelled?.()) throw new RetryCancelled();
    try {
      return await run();
    } catch (error) {
      const delay = options.delaysMs[failures];
      if (delay === undefined || options.shouldRetry?.(error) === false) throw error;
      options.onRetry?.(failures + 1, error);
      await sleep(delay);
    }
  }
}
