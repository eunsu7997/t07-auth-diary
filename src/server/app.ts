import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ZodError, type ZodType } from 'zod';
import { planSchema, planUpdateSchema, taskSchema, taskQuerySchema, requestIdSchema, emptySchema, reviewQuerySchema, copySchema } from '../shared/validation.ts';
import { AppError, Diary } from './services.ts';
import type { Database } from './db.ts';
import type { Auth } from './auth.ts';

export type Bindings = { DB?: D1Database; ASSETS?: Fetcher; BETTER_AUTH_SECRET?: string; BETTER_AUTH_URL?: string };
export type Environment = { Bindings: Bindings; Variables: { diary: Diary; userId: string } };

async function input<T>(request: { json(): Promise<unknown> }, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try { body = await request.json(); } catch { throw new AppError(400, '올바른 JSON 요청이 필요합니다.'); }
  return schema.parse(body);
}

export function createApp(database: Database | ((bindings: Bindings) => Database), authentication?: Auth | ((bindings: Bindings) => Auth)) {
  const app = new Hono<Environment>();
  app.use('/api/*', bodyLimit({ maxSize: 64 * 1024, onError: c => c.json({ error: '입력 크기가 너무 큽니다.' }, 413) }));
  app.use('*', async (c, next) => {
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('Cache-Control', 'no-store');
    // Production UI uses external bundled scripts. Vite development adds its own script handling.
    if (!processEnvironmentIsDev()) c.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    // Do not permit browser writes originating on unrelated sites. No account or password is involved.
    const origin = c.req.header('Origin');
    const configuredBaseURL = origin ? authFor(c.env)?.options.baseURL : undefined;
    const authOrigin = typeof configuredBaseURL === 'string' ? new URL(configuredBaseURL).origin : undefined;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && origin && origin !== new URL(c.req.url).origin && origin !== authOrigin) {
      return c.json({ error: '다른 사이트에서 보낸 변경 요청은 허용하지 않습니다.' }, 403);
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) && c.req.method !== 'DELETE' && !/^application\/json(?:;|$)/i.test(c.req.header('Content-Type') ?? '')) {
      return c.json({ error: 'application/json 형식으로 요청하세요.' }, 415);
    }
    await next();
  });
  const authFor = (bindings: Bindings) => typeof authentication === 'function' ? authentication(bindings) : authentication;
  app.all('/api/auth/*', c => {
    const auth = authFor(c.env);
    if (!auth) return c.json({ error: '인증 설정이 필요합니다.' }, 503);
    return auth.handler(c.req.raw);
  });
  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/health') return next();
    const auth = authFor(c.env);
    if (!auth) return c.json({ error: '인증 설정이 필요합니다.' }, 503);
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: '로그인이 필요합니다.' }, 401);
    c.set('userId', session.user.id);
    c.set('diary', new Diary(typeof database === 'function' ? database(c.env) : database, session.user.id));
    if (['owner_user_id','user_id','owner','userId'].some(key => key in c.req.query())) return c.json({ error: '사용자 지정 쿼리는 허용하지 않습니다.' }, 400);
    if (c.req.header('X-User-ID') || c.req.header('X-Owner-ID')) return c.json({ error: '사용자 지정 헤더는 허용하지 않습니다.' }, 400);
    await next();
  });
  app.get('/api/session', async c => {
    const session = await authFor(c.env)!.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: '로그인이 필요합니다.' }, 401);
    return c.json({ user: { id: session.user.id, name: session.user.name, email: session.user.email }, expiresAt: session.session.expiresAt });
  });
  app.get('/api/health', async c => {
    await (typeof database === 'function' ? database(c.env) : database).all('SELECT 1 AS connected');
    return c.json({ ok: true, stage: 2, storage: c.env?.DB ? 'cloudflare-d1' : 'server-sqlite', timezone: 'Asia/Seoul' });
  });
  app.get('/api/plans', async c => { emptySchema.parse(c.req.query()); return c.json(await c.get('diary').plans()); });
  app.post('/api/plans', async c => c.json(await c.get('diary').createPlan(await input(c.req, planSchema)), 201));
  app.get('/api/plans/:id', async c => c.json(await c.get('diary').plan(c.req.param('id'))));
  app.put('/api/plans/:id', async c => {
    const { expected_version, ...plan } = await input(c.req, planUpdateSchema);
    return c.json(await c.get('diary').updatePlan(c.req.param('id'), plan, expected_version));
  });
  app.get('/api/plans/:id/versions', async c => c.json(await c.get('diary').history(c.req.param('id'))));
  app.get('/api/plans/:id/tasks', async c => c.json(await c.get('diary').tasks(c.req.param('id'), taskQuerySchema.parse(c.req.query()))));
  app.post('/api/plans/:id/tasks', async c => c.json(await c.get('diary').createTask(c.req.param('id'), await input(c.req, taskSchema)), 201));
  app.get('/api/tasks/:id', async c => c.json(await c.get('diary').task(c.req.param('id'))));
  app.put('/api/tasks/:id', async c => c.json(await c.get('diary').updateTask(c.req.param('id'), await input(c.req, taskSchema))));
  app.delete('/api/tasks/:id', async c => { await c.get('diary').deleteTask(c.req.param('id')); return c.body(null, 204); });
  app.get('/api/tasks/:id/executions', async c => c.json(await c.get('diary').executions(c.req.param('id'))));
  app.get('/api/plans/:id/executions', async c => c.json(await c.get('diary').planExecutions(c.req.param('id'))));
  app.post('/api/tasks/:id/start', async c => {
    const body = await input(c.req, requestIdSchema);
    return c.json(await c.get('diary').start(c.req.param('id'), body.request_id));
  });
  app.post('/api/tasks/:id/executions/:logId/finish', async c => {
    const body = await input(c.req, requestIdSchema);
    return c.json(await c.get('diary').finish(c.req.param('id'), c.req.param('logId'), body.request_id));
  });
  app.post('/api/tasks/:id/reopen', async c => {
    await input(c.req, emptySchema);
    return c.json(await c.get('diary').reopen(c.req.param('id')));
  });
  app.get('/api/review', async c => {
    const query = reviewQuerySchema.parse(c.req.query());
    return c.json(await c.get('diary').review(query.plan_id));
  });
  app.post('/api/plans/:id/copy-completed', async c => c.json(await c.get('diary').copyCompleted(c.req.param('id'), await input(c.req, copySchema)), 201));
  app.get('/api/export', async c => {
    emptySchema.parse(c.req.query());
    const data = await c.get('diary').exportAll();
    c.header('Content-Disposition', 'attachment; filename="t07-diary.json"');
    return c.json(data);
  });
  app.notFound(c => c.json({ error: '요청한 경로가 없습니다.' }, 404));
  app.onError((error, c) => {
    if (error instanceof AppError) return c.json({ error: error.message }, error.status);
    if (error instanceof ZodError) return c.json({ error: '입력값을 확인하세요.', details: error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) }, 400);
    if (/task still has an active execution|copy source is no longer completed/.test(error.message)) return c.json({ error: '할 일의 상태가 변경되었습니다. 최신 기록을 확인하세요.' }, 409);
    console.error('T07 database/API operation failed');
    return c.json({ error: '서버 저장에 실패했습니다. 입력 내용을 유지한 채 다시 시도하세요.' }, 500);
  });
  return app;
}

function processEnvironmentIsDev() {
  return typeof process !== 'undefined' && process.env.NODE_ENV === 'development';
}
