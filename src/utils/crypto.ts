import crypto from 'node:crypto';
import { JWT_SECRET } from '../config/config.js';

const algorithm = 'aes-256-cbc';
// Derive a 32-byte key from the JWT_SECRET to ensure compatibility with aes-256-cbc
const key = crypto.createHash('sha256').update(JWT_SECRET || 'fallback_secret_must_be_changed_in_prod_123!').digest();

interface ResetTokenPayload {
  id: string;
  email: string;
  passwordHash: string;
  expiresAt: number;
}

/**
 * Encrypts the password reset payload using AES-256-CBC.
 */
export const encryptResetToken = (payload: ResetTokenPayload): string => {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
};

/**
 * Decrypts and parses the password reset payload from the token string.
 * Returns null if decryption or parsing fails.
 */
export const decryptResetToken = (token: string): ResetTokenPayload | null => {
  try {
    const parts = token.split(':');
    if (parts.length !== 2) return null;
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted) as ResetTokenPayload;
  } catch (error) {
    return null;
  }
};
