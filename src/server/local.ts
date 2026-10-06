import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { resolve } from 'node:path';
import { createApp } from './app.ts';
import { LocalDatabase, projectRoot } from './local-db.ts';
import { createAuth } from './auth.ts';

const db = new LocalDatabase(process.env.T07_DB_PATH);
const port = Number(process.env.T07_PORT ?? 3007);
const fixtureProfile = process.env.T07_AUTH_TEST_FIXTURES === '1' ? 'isolated-test' : 'protected';
const auth = createAuth(db.sqlite, process.env.BETTER_AUTH_SECRET ?? '', process.env.BETTER_AUTH_URL ?? `http://127.0.0.1:${port}`, fixtureProfile);
const app = createApp(db, auth);
app.get('*', serveStatic({ root: resolve(projectRoot, 'dist') }));
app.get('*', serveStatic({ path: resolve(projectRoot, 'dist/index.html') }));
const server = serve({ fetch: (request, env) => {
  // Local Node is loopback-only; ignore caller-controlled proxy headers.
  const headers = new Headers(request.headers);
  headers.delete('x-forwarded-for'); headers.delete('x-real-ip');
  headers.set('cf-connecting-ip', env.incoming.socket.remoteAddress ?? '127.0.0.1');
  return app.fetch(new Request(request, { headers }));
}, port, hostname: '127.0.0.1' }, () => console.log(`T07 ready: http://127.0.0.1:${port} (local SQLite; authenticated owner scope)`));
const close = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGINT', close);
process.on('SIGTERM', close);
