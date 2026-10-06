import { betterAuth, type BetterAuthOptions } from 'better-auth';

export function createAuth(database: BetterAuthOptions['database'], secret: string, baseURL: string) {
  if (!secret || secret.length < 32) throw new Error('T07 requires a private BETTER_AUTH_SECRET of at least 32 characters.');
  const secure = new URL(baseURL).protocol === 'https:';
  return betterAuth({
    database,
    secret,
    baseURL,
    basePath: '/api/auth',
    trustedOrigins: [new URL(baseURL).origin],
    emailAndPassword: { enabled: true },
    session: { expiresIn: 60 * 60 * 24 * 7, disableSessionRefresh: true, cookieCache: { enabled: false } },
    advanced: {
      cookiePrefix: 't07-auth',
      useSecureCookies: secure,
      defaultCookieAttributes: { httpOnly: true, secure, sameSite: 'lax', path: '/' },
    },
    // Never print auth payloads, credentials, cookies or tokens, including on failure.
    logger: { disabled: true },
  });
}
export type Auth = ReturnType<typeof createAuth>;
