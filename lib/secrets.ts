/**
 * Secret resolution.
 *
 * Every secret has a development fallback so `npm run dev` works out of the box.
 * Those fallbacks are in version control, so in production they must never be
 * used — `assertSecretsConfigured()` is called from server.js at startup and
 * aborts the boot if any secret is missing. Failing to start is much better
 * than silently signing sessions with a value anyone can read off GitHub.
 */

const DEV_FALLBACK = "dev-only-insecure-secret";

type SecretSpec = {
  /** Env var holding the secret. */
  name: string;
  /** Older env var name still accepted, for deployments not yet updated. */
  legacyName?: string;
};

const SECRETS: SecretSpec[] = [
  { name: "COOKIE_SECRET" },
  { name: "GUEST_TOKEN_SECRET" },
  // Deployed .env files call this RESET_TOKEN_SECRET; keep accepting that name.
  { name: "VERIFY_TOKEN_SECRET", legacyName: "RESET_TOKEN_SECRET" },
];

export function secret(name: string): string {
  const spec = SECRETS.find(s => s.name === name);
  const value =
    process.env[name] ?? (spec?.legacyName ? process.env[spec.legacyName] : undefined);
  return value || `${DEV_FALLBACK}-${name}`;
}

/**
 * Throws if any secret would fall back to its development default.
 * Call once at startup, before the server accepts connections.
 */
export function assertSecretsConfigured(): void {
  const missing = SECRETS.filter(
    s => !process.env[s.name] && !(s.legacyName && process.env[s.legacyName]),
  ).map(s => (s.legacyName ? `${s.name} (or ${s.legacyName})` : s.name));

  if (missing.length > 0) {
    throw new Error(
      `Refusing to start: missing secret(s) ${missing.join(", ")}. ` +
        `Set them in .env.production.local — the built-in fallbacks are public.`,
    );
  }
}
