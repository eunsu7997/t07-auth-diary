import { createApp } from './app.ts';
import { D1Adapter } from './db.ts';
import { createAuth } from './auth.ts';

const app = createApp(bindings => {
  if (!bindings.DB) throw new Error('T07 D1 DB binding is missing');
  return new D1Adapter(bindings.DB);
}, bindings => {
  if (!bindings.DB || !bindings.BETTER_AUTH_URL?.startsWith('https://')) throw new Error('T07 requires D1 and an HTTPS auth URL');
  return createAuth(bindings.DB, bindings.BETTER_AUTH_SECRET ?? '', bindings.BETTER_AUTH_URL);
});
app.get('*', c => {
  if (!c.env.ASSETS) return c.json({ error: '화면 파일이 배포되지 않았습니다.' }, 503);
  return c.env.ASSETS.fetch(c.req.raw);
});
export default app;
