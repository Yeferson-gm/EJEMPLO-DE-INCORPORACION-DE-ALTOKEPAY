import { describe, expect, test } from 'bun:test';
import { createGracefulShutdown, type GracefulShutdownOptions } from '#services/gracefulShutdown';

const createOptions = (
  exits: number[],
  errors: unknown[] = [],
  clock: { now: number } = { now: 0 },
): GracefulShutdownOptions => ({
  timeoutMs: 50,
  repeatedSignalGraceMs: 25,
  now: () => clock.now,
  exit: code => exits.push(code),
  log: () => undefined,
  logError: (_message, error) => errors.push(error),
});

describe('graceful shutdown', () => {
  test('awaits every resource before exiting successfully', async () => {
    const exits: number[] = [];
    const closed: string[] = [];
    let releaseRealtime: (() => void) | undefined;
    const realtimeClosed = new Promise<void>(resolve => {
      releaseRealtime = resolve;
    });
    const shutdown = createGracefulShutdown(
      [
        async () => {
          closed.push('http');
        },
        async () => {
          closed.push('realtime');
          await realtimeClosed;
        },
      ],
      createOptions(exits),
    );

    const completion = shutdown('SIGINT');
    await Promise.resolve();

    expect(closed).toEqual(['http', 'realtime']);
    expect(exits).toEqual([]);

    releaseRealtime?.();
    await completion;

    expect(exits).toEqual([0]);
  });

  test('ignores the duplicate signal emitted immediately by Bun watch mode', async () => {
    const exits: number[] = [];
    let release: (() => void) | undefined;
    const pendingClose = new Promise<void>(resolve => {
      release = resolve;
    });
    const shutdown = createGracefulShutdown([() => pendingClose], createOptions(exits));

    const completion = shutdown('SIGINT');
    await Promise.resolve();
    await shutdown('SIGINT');

    expect(exits).toEqual([]);

    release?.();
    await completion;

    expect(exits).toEqual([0]);
  });

  test('forces a non-zero exit when a later signal interrupts stalled cleanup', async () => {
    const exits: number[] = [];
    const clock = { now: 0 };
    let release: (() => void) | undefined;
    const pendingClose = new Promise<void>(resolve => {
      release = resolve;
    });
    const shutdown = createGracefulShutdown([() => pendingClose], createOptions(exits, [], clock));

    const completion = shutdown('SIGTERM');
    await Promise.resolve();
    clock.now = 25;
    await shutdown('SIGINT');

    expect(exits).toEqual([1]);

    release?.();
    await completion;

    expect(exits).toEqual([1]);
  });

  test('attempts every resource and exits non-zero when one fails', async () => {
    const exits: number[] = [];
    const errors: unknown[] = [];
    const closed: string[] = [];
    const shutdown = createGracefulShutdown(
      [
        () => {
          closed.push('realtime');
          throw new Error('close failed');
        },
        () => {
          closed.push('http');
        },
      ],
      createOptions(exits, errors),
    );

    await shutdown('SIGQUIT');

    expect(closed).toEqual(['realtime', 'http']);
    expect(exits).toEqual([1]);
    expect(errors).toHaveLength(1);
  });

  test('exits non-zero when the shutdown deadline expires', async () => {
    const exits: number[] = [];
    const errors: unknown[] = [];
    const options = createOptions(exits, errors);
    const shutdown = createGracefulShutdown([() => new Promise<void>(() => undefined)], {
      ...options,
      timeoutMs: 5,
    });

    await shutdown('SIGHUP');

    expect(exits).toEqual([1]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(Error);
    expect((errors[0] as Error).message).toBe('Graceful shutdown exceeded 5ms');
  });
});
