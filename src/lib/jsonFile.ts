import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const queues = new Map<string, Promise<void>>();

export const readJsonFile = async <T>(filePath: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return fallback;
    throw error;
  }
};

export const writeJsonFile = async (filePath: string, value: unknown, mode = 0o600): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporaryPath, 'wx', mode);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temporaryPath, filePath);
    await fs.chmod(filePath, mode);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
};

export const mutateJsonFile = <T, Result>(
  filePath: string,
  fallback: T,
  mutation: (current: T) => Promise<readonly [T, Result]> | readonly [T, Result],
  mode = 0o600,
): Promise<Result> => {
  const previous = queues.get(filePath) ?? Promise.resolve();
  let resolveResult: (value: Result | PromiseLike<Result>) => void = () => undefined;
  let rejectResult: (reason?: unknown) => void = () => undefined;
  const result = new Promise<Result>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const operation = previous.then(async () => {
    try {
      const [next, output] = await mutation(await readJsonFile(filePath, fallback));
      await writeJsonFile(filePath, next, mode);
      resolveResult(output);
    } catch (error) {
      rejectResult(error);
    }
  });
  queues.set(filePath, operation);
  void operation.finally(() => {
    if (queues.get(filePath) === operation) queues.delete(filePath);
  });
  return result;
};
