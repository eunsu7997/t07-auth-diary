import { randomBytes } from 'node:crypto';
import { createAuth } from '../src/server/auth.ts';
import { createApp } from '../src/server/app.ts';
import type { LocalDatabase } from '../src/server/local-db.ts';
export const base = 'http://localhost';
export const random = () => Array.from(randomBytes(40), b => b.toString(16).padStart(2, '0')).join('');
export async function account(db: LocalDatabase) {
  const secret = random();
  const auth = createAuth(db.sqlite, secret, base, 'isolated-test');
  const app = createApp(db, auth);
  const response = await app.request(base + '/api/auth/sign-up/email', { method:'POST', headers:{'Content-Type':'application/json',Origin:base}, body:JSON.stringify({email:crypto.randomUUID()+'@example.invalid',password:random(),name:'Automated fixture only'}) });
  if(!response.ok) throw new Error('Fixture signup failed');
  const userId = ((await response.json()) as {user:{id:string}}).user.id;
  const cookie = response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  // Wrap API requests only in test code. Every request still traverses real session validation.
  const authenticatedApp = (database: LocalDatabase) => {
    const target = createApp(database, createAuth(database.sqlite,secret,base,'isolated-test'));
    const original = target.request.bind(target);
    target.request = ((path: string | Request, options?: RequestInit) => original(path, { ...options, headers:{Cookie:cookie,...Object.fromEntries(new Headers(options?.headers))} })) as typeof target.request;
    return target;
  };
  return {userId,cookie,secret,auth,app:authenticatedApp(db),authenticatedApp};
}

