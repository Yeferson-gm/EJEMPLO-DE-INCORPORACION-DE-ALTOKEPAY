import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { paths } from '#config/paths';
import { mutateJsonFile, readJsonFile, writeJsonFile } from '#lib/jsonFile';

const testPath = `${paths.dataDir}/persistence.test.json`;
afterEach(() => rm(testPath, { force: true }));

describe('JSON persistence', () => {
  test('falls back only on ENOENT and propagates corrupt JSON', async () => {
    await rm(testPath, { force: true });
    expect(await readJsonFile(testPath, { value: 1 })).toEqual({ value: 1 });
    await writeFile(testPath, '{corrupt', 'utf8');
    expect(readJsonFile(testPath, {})).rejects.toBeInstanceOf(SyntaxError);
  });

  test('writes private files atomically with mode 0600', async () => {
    await writeJsonFile(testPath, { token: 'sensitive' });
    await chmod(testPath, 0o644);
    await writeJsonFile(testPath, { token: 'replaced' });
    expect((await stat(testPath)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(testPath, 'utf8'))).toEqual({ token: 'replaced' });
  });

  test('serializes concurrent read-modify-write operations', async () => {
    await Promise.all(
      Array.from({ length: 20 }, () =>
        mutateJsonFile(testPath, { count: 0 }, current => [{ count: current.count + 1 }, undefined] as const),
      ),
    );
    expect(await readJsonFile(testPath, { count: 0 })).toEqual({ count: 20 });
  });
});
