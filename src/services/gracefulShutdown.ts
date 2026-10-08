export interface GracefulShutdownOptions {
  readonly timeoutMs: number;
  readonly repeatedSignalGraceMs: number;
  readonly now: () => number;
  readonly exit: (code: number) => void;
  readonly log: (message: string) => void;
  readonly logError: (message: string, error: unknown) => void;
}

export type ShutdownResource = () => void | Promise<void>;

const closeResources = async (resources: readonly ShutdownResource[]): Promise<void> => {
  const results = await Promise.allSettled(resources.map(async close => close()));
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map(result => result.reason);

  if (failures.length > 0) {
    throw new AggregateError(failures, 'One or more shutdown resources failed to close');
  }
};

const closeWithinTimeout = async (resources: readonly ShutdownResource[], timeoutMs: number): Promise<void> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`Graceful shutdown exceeded ${timeoutMs}ms`)), timeoutMs);
  });

  try {
    await Promise.race([closeResources(resources), deadline]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};

export const createGracefulShutdown = (
  resources: readonly ShutdownResource[],
  options: GracefulShutdownOptions,
): ((signal: string) => Promise<void>) => {
  let shutdownStartedAt: number | undefined;
  let forceExitRequested = false;

  return async signal => {
    if (shutdownStartedAt !== undefined) {
      if (options.now() - shutdownStartedAt < options.repeatedSignalGraceMs) return;
      forceExitRequested = true;
      options.log(`Forcing example ecommerce shutdown after repeated ${signal}`);
      options.exit(1);
      return;
    }

    shutdownStartedAt = options.now();
    options.log(`Shutting down example ecommerce after ${signal}`);

    try {
      await closeWithinTimeout(resources, options.timeoutMs);
      if (!forceExitRequested) {
        options.log('Example ecommerce shutdown complete');
        options.exit(0);
      }
    } catch (error) {
      options.logError('Example ecommerce graceful shutdown failed', error);
      if (!forceExitRequested) options.exit(1);
    }
  };
};
