import crypto from 'crypto';
import { ENCRYPTION_KEY } from './config.js';

function key() {
  return crypto.createHash('sha256').update(String(ENCRYPTION_KEY)).digest();
}

export function encryptText(value) {
  if (value == null || value === '') return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptText(value) {
  if (!value) return '';
  if (!String(value).startsWith('v1:')) return String(value);
  const [, ivB64, tagB64, encB64] = String(value).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]).toString('utf8');
}

export function hashText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}
