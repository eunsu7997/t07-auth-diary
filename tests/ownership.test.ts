import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { LocalDatabase } from '../src/server/local-db.ts';
import { Diary } from '../src/server/services.ts';
import { createApp } from '../src/server/app.ts';
import { account } from './fixtures.ts';
import type { DatabaseExport, PlanInput, TaskInput, Review } from '../src/shared/types.ts';
const planInput: PlanInput={title:'Automated ownership fixture',period_start:'2026-10-01',period_end:'2026-10-09',success_criteria:'Not real usage',estimated_seconds:100};
const taskInput: TaskInput={content:'Automated task fixture',priority:'medium',due_date:'2026-10-01',estimated_seconds:60,tags:['학습']};
let db: LocalDatabase;
async function fixture(n:number) {
 const auth=await account(db); let clock='2026-10-02T00:00:00.000Z'; const diary=new Diary(db,auth.userId,()=>clock);
 const plan=await diary.createPlan({...planInput,estimated_seconds:100*n});
 const completed=await diary.createTask(plan.id,{...taskInput,estimated_seconds:60*n});
 const closedStart=await diary.start(completed.id,crypto.randomUUID()); clock='2026-10-02T00:00:10.000Z';
 const closed=await diary.finish(completed.id,closedStart.id,crypto.randomUUID());
 const active=await diary.createTask(plan.id,{...taskInput,estimated_seconds:120*n}); const open=await diary.start(active.id,crypto.randomUUID());
 const idle=await diary.createTask(plan.id,{...taskInput,estimated_seconds:30*n});
 return {...auth,diary,plan,completed,closed,active,open,idle};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
let pair:Fixture[];
const tables=['plans','plan_versions','tasks','tags','task_tags','execution_logs'];
async function fingerprint() {const data=await Promise.all(tables.map(t=>db.all(`SELECT * FROM ${t} ORDER BY rowid`))); return createHash('sha256').update(JSON.stringify(data)).digest('hex');}
async function api(actor:Fixture,path:string,method='GET',body?:unknown,headers:Record<string,string>={}) {return actor.app.request('/api'+path,{method,headers:{...headers,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
const copy=(f:Fixture)=>({plan:planInput,tasks:[{task_id:f.completed.id,due_date:null}]});
beforeEach(async()=>{db=new LocalDatabase(':memory:');pair=[await fixture(1),await fixture(3)];});
afterEach(()=>db.close());
const cases=['plan GET','plan PUT','versions GET','plan tasks GET','foreign task POST','task GET','task PUT','task DELETE','task executions GET','plan executions GET','start','finish','reopen','selected review','copy','mixed copy','mixed finish','whole review','export','forged identity'] as const;
for(const [label,index] of [['A -> B',0],['B -> A',1]] as const) describe(label,()=>{
 it.each(cases)('%s rejects foreign writes and leaves all business tables unchanged',async(kind)=>{
  const me=pair[index], other=pair[1-index]; const before=await fingerprint(); let response:Response;
  const routes:Record<string,[string,string,unknown?]>={
   'plan GET':[`/plans/${other.plan.id}`,'GET'], 'plan PUT':[`/plans/${other.plan.id}`,'PUT',{...planInput,expected_version:1}],
   'versions GET':[`/plans/${other.plan.id}/versions`,'GET'], 'plan tasks GET':[`/plans/${other.plan.id}/tasks`,'GET'],
   'foreign task POST':[`/plans/${other.plan.id}/tasks`,'POST',taskInput], 'task GET':[`/tasks/${other.active.id}`,'GET'],
   'task PUT':[`/tasks/${other.active.id}`,'PUT',taskInput], 'task DELETE':[`/tasks/${other.idle.id}`,'DELETE'],
   'task executions GET':[`/tasks/${other.active.id}/executions`,'GET'], 'plan executions GET':[`/plans/${other.plan.id}/executions`,'GET'],
   start:[`/tasks/${other.active.id}/start`,'POST',{request_id:crypto.randomUUID()}],
   finish:[`/tasks/${other.active.id}/executions/${other.open.id}/finish`,'POST',{request_id:crypto.randomUUID()}],
   reopen:[`/tasks/${other.completed.id}/reopen`,'POST',{}], 'selected review':[`/review?plan_id=${other.plan.id}`,'GET'],
   copy:[`/plans/${other.plan.id}/copy-completed`,'POST',copy(other)],
   'mixed copy':[`/plans/${me.plan.id}/copy-completed`,'POST',{plan:planInput,tasks:[{task_id:me.completed.id,due_date:null},{task_id:other.completed.id,due_date:null}]}],
   'mixed finish':[`/tasks/${me.active.id}/executions/${other.open.id}/finish`,'POST',{request_id:crypto.randomUUID()}],
  };
  if(kind==='forged identity') {
    for(const field of ['owner_user_id','user_id','owner']) expect((await api(me,'/plans','POST',{...planInput,[field]:other.userId})).status).toBe(400);
    for(const path of ['/plans','/export','/review',`/plans/${me.plan.id}/tasks`]) expect((await api(me,path+`?owner_user_id=${other.userId}`)).status).toBe(400);
    expect((await api(me,'/plans','GET',undefined,{'X-User-ID':other.userId})).status).toBe(400);
    response=await api(me,'/plans');
  } else if(kind==='whole review') {
    response=await api(me,'/review'); const data=await response.clone().json() as Review;
    expect(data.plan_estimated_seconds).toBe(index===0?100:300); expect(data.task_estimated_seconds).toBe(index===0?210:630);
    expect(data.actual_seconds).toBe(10); expect(data.completed_count).toBe(1); expect(data.delayed_count).toBe(3);
  } else if(kind==='export') {
    response=await api(me,'/export');const data=await response.clone().json() as DatabaseExport;
    expect(Object.keys(data).filter(k=>['user','session','account','verification'].includes(k)).length).toBe(0);
    expect(data.plans.every(p=>p.owner_user_id===me.userId)).toBe(true); expect(data.tags.every(t=>t.owner_user_id===me.userId)).toBe(true);
    const p=new Set(data.plans.map(r=>r.id)),t=new Set(data.tasks.map(r=>r.id)),g=new Set(data.tags.map(r=>r.id));
    expect(data.plan_versions.every(r=>p.has(r.plan_id))).toBe(true);expect(data.tasks.every(r=>p.has(r.plan_id)&&(!r.copied_from_task_id||t.has(r.copied_from_task_id)))).toBe(true);
    expect(data.task_tags.every(r=>t.has(r.task_id)&&g.has(r.tag_id))).toBe(true);expect(data.execution_logs.every(r=>t.has(r.task_id))).toBe(true);
    expect(JSON.stringify(data)).not.toMatch(/password|token|credential|secret|verification/i);
  } else {const [path,method,body]=routes[kind];response=await api(me,path,method,body);}
  const expected=['whole review','export','forged identity'].includes(kind)?200:404; expect(response.status).toBe(expected);
  const text=await response.text(); for(const value of [other.plan.id,other.active.id,other.completed.id,other.open.id,other.completed.tags[0].id]) expect(text.includes(value)).toBe(false);
  expect(await fingerprint()===before).toBe(true);
 });
 it('foreign and nonexistent resources have identical status and response body',async()=>{
  const me=pair[index],other=pair[1-index];
  for(const [foreign,missing] of [[`/plans/${other.plan.id}`,'/plans/missing'],[`/tasks/${other.active.id}`,'/tasks/missing'],[`/tasks/${me.active.id}/executions/${other.open.id}/finish`,`/tasks/${me.active.id}/executions/missing/finish`]]) {
   const method=foreign.includes('/finish')?'POST':'GET',body=method==='POST'?{request_id:crypto.randomUUID()}:undefined;
   const a=await api(me,foreign,method,body),b=await api(me,missing,method,body);expect(a.status).toBe(404);expect(b.status).toBe(404);expect(await a.text()).toBe(await b.text());
  }
 });
 it('global start/finish request collision leaks nothing and mutates neither user',async()=>{
  const me=pair[index],other=pair[1-index],before=await fingerprint();
  const start=await api(me,`/tasks/${me.idle.id}/start`,'POST',{request_id:other.open.start_request_id}); expect(start.status).toBe(409);expect((await start.text()).includes(other.open.id)).toBe(false);
  const finish=await api(me,`/tasks/${me.active.id}/executions/${me.open.id}/finish`,'POST',{request_id:other.closed.finish_request_id});expect(finish.status).toBe(409);expect((await finish.text()).includes(other.closed.id)).toBe(false);
  const reverse=await api(me,`/tasks/${other.active.id}/executions/${me.open.id}/finish`,'POST',{request_id:crypto.randomUUID()});expect(reverse.status).toBe(404);
  expect(await fingerprint()===before).toBe(true);
 });
});
it('same-name tags have different IDs and cannot be linked across users in SQL',async()=>{
 const [a,b]=pair;expect(a.completed.tags[0].name).toBe('학습');expect(b.completed.tags[0].name).toBe('학습');expect(a.completed.tags[0].id===b.completed.tags[0].id).toBe(false);
 const before=await fingerprint();expect(()=>db.sqlite.prepare('INSERT INTO task_tags VALUES (?,?)').run(a.active.id,b.completed.tags[0].id)).toThrow('ownership');
 expect(()=>db.sqlite.prepare('UPDATE task_tags SET tag_id=? WHERE task_id=?').run(b.completed.tags[0].id,a.active.id)).toThrow('ownership');
 expect(await fingerprint()===before).toBe(true);
});
it('DB prevents changing plan/tag owners, task parents and foreign copied_from links',async()=>{
 const [a,b]=pair,before=await fingerprint();
 expect(()=>db.sqlite.prepare('UPDATE plans SET owner_user_id=? WHERE id=?').run(b.userId,a.plan.id)).toThrow('immutable');
 expect(()=>db.sqlite.prepare('UPDATE tags SET owner_user_id=? WHERE id=?').run(b.userId,a.completed.tags[0].id)).toThrow('immutable');
 expect(()=>db.sqlite.prepare('UPDATE tasks SET plan_id=? WHERE id=?').run(b.plan.id,a.active.id)).toThrow('immutable');
 expect(()=>db.sqlite.prepare('INSERT INTO tasks(id,plan_id,content,priority,estimated_seconds,copied_from_task_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),a.plan.id,'fixture','low',1,b.completed.id,'now','now')).toThrow('ownership');
 expect(await fingerprint()===before).toBe(true);
});
it('all 18 business routes reject unauthenticated requests without changing business DB',async()=>{
 const a=pair[0],app=createApp(db,a.auth),before=await fingerprint();
 for(const [path,method,body] of [
 ['/plans','GET'],['/plans','POST',planInput],[`/plans/${a.plan.id}`,'GET'],[`/plans/${a.plan.id}`,'PUT',{...planInput,expected_version:1}],
 [`/plans/${a.plan.id}/versions`,'GET'],[`/plans/${a.plan.id}/tasks`,'GET'],[`/plans/${a.plan.id}/tasks`,'POST',taskInput],
 [`/tasks/${a.active.id}`,'GET'],[`/tasks/${a.active.id}`,'PUT',taskInput],[`/tasks/${a.active.id}`,'DELETE'],
 [`/tasks/${a.active.id}/executions`,'GET'],[`/plans/${a.plan.id}/executions`,'GET'],[`/tasks/${a.active.id}/start`,'POST',{request_id:crypto.randomUUID()}],
 [`/tasks/${a.active.id}/executions/${a.open.id}/finish`,'POST',{request_id:crypto.randomUUID()}],[`/tasks/${a.completed.id}/reopen`,'POST',{}],
 ['/review','GET'],[`/review?plan_id=${a.plan.id}`,'GET'],[`/plans/${a.plan.id}/copy-completed`,'POST',copy(a)],['/export','GET']
 ] as [string,string,unknown?][]) {const response=await app.request('/api'+path,{method,headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});expect(response.status).toBe(401);expect(await fingerprint()===before).toBe(true);}
});
it('Diary requires an explicit authenticated user ID',()=>{expect(()=>new Diary(db,undefined as unknown as string)).toThrow('Authenticated');});
