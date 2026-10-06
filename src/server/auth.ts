import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { APIError } from 'better-auth/api';

export const AUTH_RATE_LIMIT = { window: 60, loginMax: 10, signupMax: 5, otherMax: 100 } as const;
export const MIN_PASSWORD_LENGTH = 12;
// Explicit test-only profile. Worker callers always use the protected default.
export function createAuth(database: BetterAuthOptions['database'], secret: string, baseURL: string, profile: 'protected' | 'isolated-test' = 'protected') {
  if (!secret || secret.length < 32) throw new Error('T07 requires a private BETTER_AUTH_SECRET of at least 32 characters.');
  const url = new URL(baseURL);
  if (profile === 'isolated-test' && (typeof process === 'undefined' || process.env.NODE_ENV !== 'test' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('Isolated fixtures require NODE_ENV=test and loopback URL');
  }
  const secure = url.protocol === 'https:';
  const name = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 100) throw new APIError('BAD_REQUEST', { message: '표시 이름은 공백을 제외하고 1~100자로 입력하세요.' });
    return trimmed;
  };
  return betterAuth({
    database, secret, baseURL, basePath: '/api/auth', trustedOrigins: [url.origin],
    emailAndPassword: { enabled: true, minPasswordLength: MIN_PASSWORD_LENGTH, maxPasswordLength: 128 },
    rateLimit: {
      enabled: profile === 'protected', storage: 'database', window: AUTH_RATE_LIMIT.window, max: AUTH_RATE_LIMIT.otherMax,
      customRules: {
        '/sign-in/email': { window: AUTH_RATE_LIMIT.window, max: AUTH_RATE_LIMIT.loginMax },
        '/sign-up/email': { window: AUTH_RATE_LIMIT.window, max: AUTH_RATE_LIMIT.signupMax },
        '/change-password': { window: AUTH_RATE_LIMIT.window, max: AUTH_RATE_LIMIT.signupMax },
      },
    },
    databaseHooks: { user: {
      create: { before: async user => ({ data: { ...user, name: name(user.name) } }) },
      update: { before: async user => ({ data: { ...user, ...(user.name === undefined ? {} : { name: name(user.name) }) } }) },
    } },
    session: { expiresIn: 60 * 60 * 24 * 7, disableSessionRefresh: true, cookieCache: { enabled: false } },
    advanced: {
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
      cookiePrefix: 't07-auth', useSecureCookies: secure,
      defaultCookieAttributes: { httpOnly: true, secure, sameSite: 'lax', path: '/' },
    },
    logger: { disabled: true },
  });
}
export type Auth = ReturnType<typeof createAuth>;
