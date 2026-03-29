import bcrypt from "bcryptjs";

const SALT_ROUNDS = 10;

/** Hashes a plaintext password. Equivalent to Postgres crypt(pw, gen_salt('bf')). */
export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

/** Verifies a plaintext password against a stored hash. */
export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/** Generates a session token. Equivalent to Postgres uuid_generate_v4(). */
export function generateSessionToken(): string {
  return crypto.randomUUID();
}

/** Returns a SQLite-compatible timestamp for 30 days from now, for use as valid_until. */
export function sessionExpiry(): string {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}
