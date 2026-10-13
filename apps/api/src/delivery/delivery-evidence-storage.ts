import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const header = Buffer.from('USDE1');
const ivLength = 12;
const tagLength = 16;

export class DeliveryEvidenceStorage {
  constructor(
    private readonly directory = resolve(
      process.env.DELIVERY_EVIDENCE_DIR ?? '.private/delivery-evidence',
    ),
    private readonly encryptionKey = process.env.DELIVERY_EVIDENCE_ENCRYPTION_KEY ?? '',
  ) {}

  async store(content: Uint8Array) {
    const id = randomUUID();
    const iv = randomBytes(ivLength);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const encrypted = Buffer.concat([cipher.update(content), cipher.final()]);
    const payload = Buffer.concat([header, iv, cipher.getAuthTag(), encrypted]);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temporaryPath = resolve(this.directory, `${id}.tmp`);
    const evidencePath = resolve(this.directory, `${id}.bin`);
    await writeFile(temporaryPath, payload, { flag: 'wx', mode: 0o600 });
    await rename(temporaryPath, evidencePath);
    return id;
  }

  async read(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error('Evidence reference is invalid');
    }
    const payload = await readFile(resolve(this.directory, `${id}.bin`));
    if (
      payload.length < header.length + ivLength + tagLength ||
      !payload.subarray(0, header.length).equals(header)
    ) {
      throw new Error('Evidence payload is invalid');
    }
    const ivStart = header.length;
    const tagStart = ivStart + ivLength;
    const contentStart = tagStart + tagLength;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key(),
      payload.subarray(ivStart, tagStart),
    );
    decipher.setAuthTag(payload.subarray(tagStart, contentStart));
    return Buffer.concat([decipher.update(payload.subarray(contentStart)), decipher.final()]);
  }

  async remove(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw new Error('Evidence reference is invalid');
    }
    await rm(resolve(this.directory, `${id}.bin`), { force: true });
  }

  private key() {
    const decoded = Buffer.from(this.encryptionKey, 'base64');
    if (!/^[A-Za-z0-9+/]{43}=$/.test(this.encryptionKey) || decoded.length !== 32) {
      throw new Error('DELIVERY_EVIDENCE_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    }
    return decoded;
  }
}
