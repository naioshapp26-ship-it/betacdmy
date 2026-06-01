import crypto from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const PREFIX = Buffer.from('app1');

const deriveKey = (secret) => crypto.createHash('sha256').update(String(secret), 'utf8').digest();

export const encryptField = (plaintext, secret) => {
  if (plaintext == null || plaintext === '') return null;
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([PREFIX, iv, tag, encrypted]);
};

export const decryptField = (data, secret) => {
  if (!data) return null;
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  if (buf.length < PREFIX.length + IV_LEN + TAG_LEN + 1) {
    throw new Error('Invalid encrypted field payload');
  }
  if (!buf.subarray(0, PREFIX.length).equals(PREFIX)) {
    throw new Error('Unsupported encrypted field format (pgcrypto not available on this host)');
  }
  const key = deriveKey(secret);
  const iv = buf.subarray(PREFIX.length, PREFIX.length + IV_LEN);
  const tag = buf.subarray(PREFIX.length + IV_LEN, PREFIX.length + IV_LEN + TAG_LEN);
  const encrypted = buf.subarray(PREFIX.length + IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
};

export const tryDecryptField = (data, secret) => {
  try {
    return decryptField(data, secret);
  } catch {
    return null;
  }
};
