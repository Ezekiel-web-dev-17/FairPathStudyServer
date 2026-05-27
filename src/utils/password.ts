import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 11;

/**
 * Hash a plaintext password using bcrypt.
 */
export const hashPassword = async (password: string): Promise<string> => {
  return bcrypt.hash(password, SALT_ROUNDS);
};

/**
 * Compare a plaintext password against a bcrypt hash.
 */
export const comparePassword = async (
  password: string,
  hash: string,
): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};
