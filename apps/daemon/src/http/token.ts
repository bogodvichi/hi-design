import * as crypto from 'crypto';

const AES_KEY = Buffer.from('WSs5a2hJVlVGWVpWQVBQeg==', 'base64');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789=+';

export function generateToken(username: string): string {
  const timestamp = Date.now();
  const n = 24 - username.length - 2;
  let randomStr = '';
  for (let i = 0; i < n; i++) {
    randomStr += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
  }
  const b64User = Buffer.from(username, 'utf8').toString('base64');
  const plaintext = `${randomStr.slice(0, 5)}.${b64User}.${randomStr.slice(5)}&${timestamp}`;
  const cipher = crypto.createCipheriv('aes-128-ecb', AES_KEY, null);
  return Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]).toString('base64');
}
