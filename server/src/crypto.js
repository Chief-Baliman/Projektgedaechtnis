import crypto from 'crypto';

function key() {
  const raw = process.env.ENCRYPTION_KEY || '';
  if (raw.length < 24) throw new Error('ENCRYPTION_KEY fehlt oder ist zu kurz. Bitte in .env setzen.');
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptText(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptText(payload) {
  const [ivB64, tagB64, encB64] = String(payload || '').split(':');
  if (!ivB64 || !tagB64 || !encB64) throw new Error('Ungültiges Secret-Format.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]).toString('utf8');
}
