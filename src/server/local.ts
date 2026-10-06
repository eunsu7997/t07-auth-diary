import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { resolve } from 'node:path';
import { createApp } from './app.ts';
import { LocalDatabase, projectRoot } from './local-db.ts';
import { createAuth } from './auth.ts';

const db = new LocalDatabase(process.env.T07_DB_PATH);
const port = Number(process.env.T07_PORT ?? 3007);
const auth = createAuth(db.sqlite, process.env.BETTER_AUTH_SECRET ?? '', process.env.BETTER_AUTH_URL ?? `http://127.0.0.1:${port}`);
const app = createApp(db, auth);
app.get('*', serveStatic({ root: resolve(projectRoot, 'dist') }));
app.get('*', serveStatic({ path: resolve(projectRoot, 'dist/index.html') }));
const server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => console.log(`T07 ready: http://127.0.0.1:${port} (local SQLite; authenticated owner scope)`));
const close = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGINT', close);
process.on('SIGTERM', close);
