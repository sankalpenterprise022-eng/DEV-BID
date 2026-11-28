import bcrypt from "bcryptjs";

const ROUNDS = 10;

/** bcrypt hashes look like $2a$10$... / $2b$ / $2y$ and are always 60 chars. */
export function isHashed(value: unknown): boolean {
  return typeof value === "string" && value.length === 60 && /^\$2[aby]\$\d{2}\$/.test(value);
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

/**
 * Compare a login password with the stored value. A stored plain-text password
 * (user not migrated yet by scripts/hash-passwords.mjs) is still accepted once;
 * the caller then replaces it with a hash (`needsRehash`).
 */
export async function verifyPassword(plain: string, stored: unknown): Promise<{ ok: boolean; needsRehash: boolean }> {
  if (typeof stored !== "string" || !stored) return { ok: false, needsRehash: false };
  if (isHashed(stored)) return { ok: await bcrypt.compare(plain, stored), needsRehash: false };
  return { ok: plain === stored, needsRehash: plain === stored };
}

// Hash of a random string, used so a login for an unknown username takes as
// long as a real one (no username guessing by response time).
let dummyHash: Promise<string> | null = null;
export async function burnCompareTime(plain: string) {
  dummyHash ??= bcrypt.hash("dummy-password-for-timing", ROUNDS);
  await bcrypt.compare(plain, await dummyHash).catch(() => false);
}
