import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAuth, AUTH_RATE_LIMIT } from '../src/server/auth.ts';
import { createApp } from '../src/server/app.ts';
import { LocalDatabase } from '../src/server/local-db.ts';
import { Diary, REQUEST_CONFLICT } from '../src/server/services.ts';
import { account, random } from './fixtures.ts';
import { redactEvidence } from '../scripts/evidence-redact.mjs';
let db:LocalDatabase, app:ReturnType<typeof createApp>, auth:ReturnType<typeof createAuth>, secret:string, password:string;
const base='http://127.0.0.1:3007',email='security-fixture@example.invalid';
beforeEach(()=>{db=new LocalDatabase(':memory:');secret=random();password=random();auth=createAuth(db.sqlite,secret,base);app=createApp(db,auth);});
afterEach(()=>db.close());
function request(path:string,body:unknown,ip='192.0.2.11',extra:Record<string,string>={}) {return app.request(base+'/api/auth'+path,{method:'POST',headers:{Origin:base,'Content-Type':'application/json','cf-connecting-ip':ip,...extra},body:JSON.stringify(body)});}
async function signup(name='Normal fixture name',pwd=password) {return request('/sign-up/email',{email,name,password:pwd});}
it('explicit protected limits and database storage apply even under NODE_ENV=test',()=>{
 expect(auth.options.rateLimit?.enabled).toBe(true);expect(auth.options.rateLimit?.storage).toBe('database');
 expect(auth.options.advanced?.ipAddress?.ipAddressHeaders).toEqual(['cf-connecting-ip']);
 expect(auth.options.rateLimit?.customRules?.['/sign-in/email']).toEqual({window:60,max:10});
});
it('normal login works; ten failed attempts allowed, eleventh is 429; another IP succeeds',async()=>{
 expect((await signup()).status).toBe(200);
 expect((await request('/sign-in/email',{email,password})).status).toBe(200);
 for(let i=0;i<AUTH_RATE_LIMIT.loginMax;i++) expect((await request('/sign-in/email',{email,password:random()},'192.0.2.22')).status).toBe(401);
 // Recreating auth must not reset rate counters on a request-based Worker factory.
 app=createApp(db,createAuth(db.sqlite,secret,base));
 const blocked=await request('/sign-in/email',{email,password:random()},'192.0.2.22');expect(blocked.status).toBe(429);expect(Number(blocked.headers.get('X-Retry-After'))>0).toBe(true);
 expect((await request('/sign-in/email',{email,password},'192.0.2.33')).status).toBe(200);
 expect((await request('/sign-in/email',{email:'absent@example.invalid',password},'192.0.2.22')).status).toBe(429);
 // Test counter expiry only; this is not an application/day-use record.
 db.sqlite.prepare('UPDATE rateLimit SET lastRequest=?').run(Date.now()-61000);
 expect((await request('/sign-in/email',{email,password},'192.0.2.22')).status).toBe(200);
});
it('concurrent failures cannot pass a stale rate counter',async()=>{
 await signup();const responses=await Promise.all(Array.from({length:25},()=>request('/sign-in/email',{email,password:random()},'192.0.2.44')));
 expect(responses.filter(r=>r.status===401).length).toBe(10);expect(responses.filter(r=>r.status===429).length).toBe(15);
});
it('untrusted forwarded headers cannot bypass the selected Cloudflare client bucket',async()=>{
 await signup();for(let i=0;i<10;i++) await request('/sign-in/email',{email,password:random()},'192.0.2.55',{'x-forwarded-for':`198.51.100.${i+1}`});
 expect((await request('/sign-in/email',{email,password},'192.0.2.55',{'x-forwarded-for':'203.0.113.99','x-real-ip':'203.0.113.98'})).status).toBe(429);
});
it('test profile requires test mode and loopback, while default stays protected',()=>{
 expect(()=>createAuth(db.sqlite,secret,'https://t07.example.invalid','isolated-test')).toThrow('loopback');
 const previous=process.env.NODE_ENV;try{process.env.NODE_ENV='production';expect(()=>createAuth(db.sqlite,secret,base,'isolated-test')).toThrow('NODE_ENV');}finally{process.env.NODE_ENV=previous;}
});
it.each(['','   ','x'.repeat(101)])('server rejects empty/oversized names (case %#)',async(name)=>{
 const response=await signup(name);expect(response.ok).toBe(false);expect(Number(db.sqlite.prepare('SELECT COUNT(*) n FROM user').get()!.n)).toBe(0);
});
it('server trims display names before storage',async()=>{
 const response=await signup('  Normal fixture name  ');expect(response.status).toBe(200);
 expect(db.sqlite.prepare('SELECT name FROM user').get()!.name).toBe('Normal fixture name');
});
it('server refuses 11-character password',async()=>{
 expect((await signup('Name',random().slice(0,11))).ok).toBe(false);expect(Number(db.sqlite.prepare('SELECT COUNT(*) n FROM account').get()!.n)).toBe(0);
});
it('server accepts a 12-character password',async()=>{expect((await signup('Name',random().slice(0,12))).status).toBe(200);});
it('token response stays native, but JSON/HAR evidence removes secrets and export excludes auth data',async()=>{
 const response=await signup();const body=await response.json() as {token:string};expect(typeof body.token==='string').toBe(true);
 const sanitized=JSON.stringify(redactEvidence({body,headers:[{name:'Set-Cookie',value:response.headers.getSetCookie().join(';')}],content:{text:JSON.stringify(body)},password,secret}));
 expect(sanitized.includes(body.token)||sanitized.includes(password)||sanitized.includes(secret)).toBe(false);
 const uid=String(db.sqlite.prepare('SELECT id FROM user').get()!.id);const exported=await new Diary(db,uid).exportAll();
 expect(Object.keys(exported).some(k=>['account','user','session','verification','rateLimit'].includes(k))).toBe(false);
 expect(JSON.stringify(exported).includes(body.token)).toBe(false);
});
const planInput={title:'Security fixture',period_start:'2026-10-01',period_end:'2026-10-09',success_criteria:'Automated fixture',estimated_seconds:10};
const taskInput={content:'Security task',priority:'low' as const,due_date:null,estimated_seconds:10,tags:[]};
it.each([0,1])('same generic request collision response for both directions %#, open/closed states, and no DB changes',async(direction)=>{
 const pair=[await account(db),await account(db)];let clock='2026-10-02T00:00:00.000Z';
 const diaries=pair.map(a=>new Diary(db,a.userId,()=>clock));const resources=[];
 for(const diary of diaries){const plan=await diary.createPlan(planInput);const a=await diary.createTask(plan.id,taskInput),b=await diary.createTask(plan.id,taskInput);const open=await diary.start(a.id,crypto.randomUUID()),closing=await diary.start(b.id,crypto.randomUUID());clock='2026-10-02T00:00:01.000Z';const closed=await diary.finish(b.id,closing.id,crypto.randomUUID());resources.push({plan,a,b,open,closed});}
 const me=resources[direction],other=resources[1-direction],diary=diaries[direction];
 const fingerprint=async()=>JSON.stringify(await Promise.all(['plans','plan_versions','tasks','tags','task_tags','execution_logs'].map(table=>db.all(`SELECT * FROM ${table} ORDER BY rowid`))));
 const snapshot=await fingerprint();
 for(const [task,log,key] of [[me.a.id,me.open.id,other.closed.finish_request_id!],[me.b.id,me.closed.id,other.closed.finish_request_id!],[me.a.id,me.open.id,me.closed.finish_request_id!]]) await expect(diary.finish(task,log,key)).rejects.toMatchObject({status:409,message:REQUEST_CONFLICT});
 for(const [task,key] of [[me.a.id,other.open.start_request_id],[me.a.id,me.closed.start_request_id]]) await expect(diary.start(task,key)).rejects.toMatchObject({status:409,message:REQUEST_CONFLICT});
 expect(await fingerprint()===snapshot).toBe(true);
 expect(await diary.start(me.a.id,me.open.start_request_id)).toEqual(me.open);expect(await diary.finish(me.b.id,me.closed.id,me.closed.finish_request_id!)).toEqual(me.closed);
});
it('archived unfinished task remains in review/export as contracted',async()=>{
 const a=await account(db),diary=new Diary(db,a.userId,()=> '2026-10-02T00:00:00.000Z');const p=await diary.createPlan(planInput),t=await diary.createTask(p.id,{...taskInput,due_date:'2026-10-01'});await diary.deleteTask(t.id);
 expect(await diary.tasks(p.id,{sort:'created_asc'})).toEqual([]);expect((await diary.review()).delayed_count).toBe(1);expect((await diary.exportAll()).tasks[0].deleted_at!==null).toBe(true);
});
