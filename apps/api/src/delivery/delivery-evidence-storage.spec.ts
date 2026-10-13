import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DeliveryEvidenceStorage } from './delivery-evidence-storage.js';

describe('DeliveryEvidenceStorage', () => {
  let directory: string;
  let storage: DeliveryEvidenceStorage;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'delivery-evidence-'));
    storage = new DeliveryEvidenceStorage(directory, randomBytes(32).toString('base64'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('encrypts evidence at rest and returns the original bytes to authorized callers', async () => {
    const content = Buffer.from('private delivery proof');
    const id = await storage.store(content);
    const stored = await readFile(join(directory, `${id}.bin`));

    expect(stored).not.toContain(content);
    await expect(storage.read(id)).resolves.toEqual(content);
  });

  it('rejects modified encrypted evidence', async () => {
    const id = await storage.store(Buffer.from('proof'));
    const path = join(directory, `${id}.bin`);
    const stored = await readFile(path);
    stored[stored.length - 1] ^= 1;
    await import('node:fs/promises').then(({ writeFile }) => writeFile(path, stored));

    await expect(storage.read(id)).rejects.toThrow();
  });

  it('rejects keys that are not 32 bytes', async () => {
    const invalid = new DeliveryEvidenceStorage(directory, 'too-short');
    await expect(invalid.store(Buffer.from('proof'))).rejects.toThrow(
      'DELIVERY_EVIDENCE_ENCRYPTION_KEY must be a base64-encoded 32-byte key',
    );
  });
});
